import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  dropboxListEntryToExportCandidate,
  importDropboxExports,
  parseAcmpExportFilename,
  readAcmpWorkbook,
  sortDropboxExportCandidates,
  validateAcmpExportHeaders,
  validateAcmpExportRows,
  type DropboxExportCandidate,
  type DropboxImportRuntime,
  type DropboxListFolderEntry,
} from "../lib/acmp-import/dropbox";
import {
  analyzeImportRows,
  findMissingClosedWorkOrderIds,
} from "../lib/acmp-import/analyze";
import { applyExistingOrderUpdates } from "../lib/acmp-import/apply";
import type { AcmpImportResult } from "../lib/acmp-import/run";
import { createRowsSignature } from "../lib/acmp-import/signature";
import { isProcessedRowsSignatureDuplicate } from "../lib/acmp-import/import-files";
import { zonedDateTimeToUtcIso } from "../lib/time-zone";
import { RFQ_AWAITING_APPROVAL_REASON } from "../lib/rfq-workflow";
import { isBlocked } from "../lib/work-order-rules";

const SUCCESS_RESULT: AcmpImportResult = {
  processed: 1,
  updated: 1,
  deleted: 0,
  closedRemoved: 0,
  closedSkipped: 0,
  missingClosed: 0,
  tooOld: 0,
  skipped: 0,
  pendingNewWorkOrders: 0,
  pendingRfqApprovedInactive: 0,
};

function makeDropboxEntry(
  name: string,
  overrides: Partial<DropboxListFolderEntry> = {},
): DropboxListFolderEntry {
  return {
    ".tag": "file",
    name,
    path_lower: `/work order planning app/import/${name.toLowerCase()}`,
    rev: `rev-${name.toLowerCase()}`,
    content_hash: `hash-${name.toLowerCase()}`,
    server_modified: "2026-05-04T10:00:00Z",
    ...overrides,
  };
}

function makeCandidate(
  name: string,
  serverModified: string,
  pathLower?: string,
): DropboxExportCandidate {
  const candidate = dropboxListEntryToExportCandidate(
    makeDropboxEntry(name, {
      path_lower: pathLower ?? `/work order planning app/import/${name.toLowerCase()}`,
      server_modified: serverModified,
    }),
  );
  assert.ok(candidate);
  return candidate;
}

function workbookBuffer(headers: string[], values: unknown[] = []): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([headers, values]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Export");
  const buffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  }) as Buffer;
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

function createMockDropboxRuntime({
  candidates,
  buffer = workbookBuffer(
    [
      "Work Order",
      "Customer",
      "RFQ State",
      "CreatedOn",
      "LastUpdatedOn",
      "Close Date",
      "Comp. Type",
      "Description",
      "Comp. Pn",
    ],
    ["100", "ACMP", "RFQ Send - Continue", "2026-05-01", "2026-05-04", "", "Repair", "Wheel", "PN-1"],
  ),
  duplicateRowsSignature = false,
  importResult = { result: SUCCESS_RESULT, error: null },
}: {
  candidates: DropboxExportCandidate[];
  buffer?: ArrayBuffer;
  duplicateRowsSignature?: boolean;
  importResult?: Awaited<ReturnType<DropboxImportRuntime["runImportFromRows"]>>;
}) {
  const deletedPaths: string[] = [];
  const movedFiles: { pathLower: string; filename: string }[] = [];
  const failedRecords: Parameters<DropboxImportRuntime["recordFailedImport"]>[0][] =
    [];
  const ignoredRecords: Parameters<
    DropboxImportRuntime["recordIgnoredImport"]
  >[0][] = [];
  const importCalls: unknown[] = [];

  const runtime: DropboxImportRuntime = {
    scanCandidates: async () => candidates,
    downloadFile: async () => buffer,
    deleteFile: async (pathLower) => {
      deletedPaths.push(pathLower);
    },
    moveFileToFailed: async (pathLower, filename) => {
      movedFiles.push({ pathLower, filename });
    },
    createBufferSha256: async () => "file-sha",
    createRowsSignature: async () => "rows-signature",
    hasProcessedRowsSignature: async () => duplicateRowsSignature,
    recordFailedImport: async (args) => {
      failedRecords.push(args);
    },
    recordIgnoredImport: async (args) => {
      ignoredRecords.push(args);
    },
    readWorkbook: readAcmpWorkbook,
    runImportFromRows: async (args) => {
      importCalls.push(args);
      return importResult;
    },
  };

  return {
    runtime,
    deletedPaths,
    movedFiles,
    failedRecords,
    ignoredRecords,
    importCalls,
  };
}

function createWorkOrderIdClient(workOrderIds: string[]) {
  return {
    from(table: string) {
      assert.equal(table, "work_orders");
      let idsFilter: string[] | null = null;
      const query = {
        select() {
          return query;
        },
        in(column: string, values: string[]) {
          assert.equal(column, "work_order_id");
          idsFilter = values;
          return query;
        },
        then<TResult1 = unknown, TResult2 = never>(
          onfulfilled?:
            | ((
                value: {
                  data: { work_order_id: string }[];
                  error: null;
                },
              ) => TResult1 | PromiseLike<TResult1>)
            | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ) {
          const ids = idsFilter
            ? workOrderIds.filter((id) => idsFilter?.includes(id))
            : workOrderIds;
          return Promise.resolve({
            data: ids.map((work_order_id) => ({ work_order_id })),
            error: null,
          }).then(onfulfilled, onrejected);
        },
      };
      return query;
    },
  } as never;
}

function createExistingOrderUpdateClient(
  initialRows: Record<string, unknown>[],
) {
  const rows = new Map(
    initialRows.map((row) => [String(row.work_order_id), { ...row }]),
  );
  const upsertedRows: Record<string, unknown>[] = [];

  const client = {
    from(table: string) {
      assert.equal(table, "work_orders");
      let idsFilter: string[] | null = null;
      const query = {
        select() {
          return query;
        },
        in(column: string, values: string[]) {
          assert.equal(column, "work_order_id");
          idsFilter = values;
          return query;
        },
        upsert(payload: Record<string, unknown>[]) {
          upsertedRows.push(...payload);
          for (const row of payload) {
            const id = String(row.work_order_id);
            rows.set(id, { ...(rows.get(id) || {}), ...row });
          }
          return Promise.resolve({ error: null });
        },
        then<TResult1 = unknown, TResult2 = never>(
          onfulfilled?:
            | ((value: { data: Record<string, unknown>[]; error: null }) => TResult1 | PromiseLike<TResult1>)
            | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ) {
          const data = Array.from(rows.values()).filter((row) =>
            idsFilter ? idsFilter.includes(String(row.work_order_id)) : true,
          );
          return Promise.resolve({ data, error: null }).then(
            onfulfilled,
            onrejected,
          );
        },
      };
      return query;
    },
  } as never;

  return {
    client,
    rows,
    upsertedRows,
  };
}

async function main() {
  assert.deepEqual(parseAcmpExportFilename("werkorders_130326.xlsx"), {
    filename: "werkorders_130326.xlsx",
    exportDate: "2026-03-13",
    exportSequence: 0,
  });
  assert.deepEqual(parseAcmpExportFilename("export.xlsx"), {
    filename: "export.xlsx",
    exportDate: null,
    exportSequence: 0,
  });
  assert.deepEqual(parseAcmpExportFilename("AcMP export.xlsx"), {
    filename: "AcMP export.xlsx",
    exportDate: null,
    exportSequence: 0,
  });
  assert.deepEqual(parseAcmpExportFilename("random valid name.xlsx"), {
    filename: "random valid name.xlsx",
    exportDate: null,
    exportSequence: 0,
  });
  assert.equal(parseAcmpExportFilename("~$werkorders_130326.xlsx"), null);
  assert.equal(parseAcmpExportFilename("file.pdf"), null);
  assert.equal(parseAcmpExportFilename("file.xls"), null);
  assert.equal(
    dropboxListEntryToExportCandidate(
      makeDropboxEntry("folder.xlsx", {
        ".tag": "folder",
        path_lower: undefined,
        rev: undefined,
      }),
    ),
    null,
  );

  const newest = makeCandidate("newest.xlsx", "2026-05-04T12:00:00Z");
  const older = makeCandidate("older.xlsx", "2026-05-04T11:00:00Z");
  assert.equal(sortDropboxExportCandidates([older, newest])[0], newest);

  const tieA = makeCandidate(
    "a.xlsx",
    "2026-05-04T12:00:00Z",
    "/work order planning app/import/a.xlsx",
  );
  const tieZ = makeCandidate(
    "z.xlsx",
    "2026-05-04T12:00:00Z",
    "/work order planning app/import/z.xlsx",
  );
  assert.equal(sortDropboxExportCandidates([tieA, tieZ])[0], tieZ);

  assert.equal(
    validateAcmpExportHeaders(["Work Order", "Customer", "RFQ State"]).ok,
    true,
  );
  assert.equal(
    validateAcmpExportRows([{ "Work Order": "100", Customer: "ACMP" }]).ok,
    true,
  );
  const missingWorkOrder = validateAcmpExportRows([{ Customer: "ACMP" }]);
  assert.equal(missingWorkOrder.ok, false);
  assert.deepEqual(missingWorkOrder.missingRequired, ["Work Order"]);

  assert.deepEqual(
    findMissingClosedWorkOrderIds(
      ["100", "101", "102"],
      new Set(["101", "102"]),
    ),
    ["100"],
  );
  assert.deepEqual(findMissingClosedWorkOrderIds(["100"], new Set()), []);

  const openExportAnalysis = await analyzeImportRows(
    [
      {
        "Work Order": "102",
        Customer: "ACMP",
        "RFQ State": "RFQ Send",
        CreatedOn: "2026-05-01",
      },
    ],
    createWorkOrderIdClient(["100", "101"]),
  );
  assert.deepEqual(openExportAnalysis.missingClosedIds, ["100", "101"]);
  assert.deepEqual(openExportAnalysis.closedIds, ["100", "101"]);
  assert.equal(openExportAnalysis.missingClosed, 2);

  const invalidExportAnalysis = await analyzeImportRows(
    [{ Customer: "ACMP" }],
    createWorkOrderIdClient(["100"]),
  );
  assert.equal(invalidExportAnalysis.missingClosed, 0);

  {
    const { client, rows, upsertedRows } = createExistingOrderUpdateClient([
      {
        work_order_id: "200",
        customer: "ACMP",
        rfq_state: null,
        rfq_manual_approved_at: null,
        last_system_update: "2026-05-10T10:00:00.000Z",
        is_open: true,
        work_order_type: "Wheel Repair",
        part_number: "PN-200",
        is_active: true,
        current_process_step: "Assembly",
        assigned_person_team: "Shop",
        included_process_steps: null,
        hold_reason: RFQ_AWAITING_APPROVAL_REASON,
        required_next_action: null,
        action_owner: null,
        action_status: "Done",
        action_closed: true,
        data_tracking_enabled: false,
      },
    ]);

    const result = await applyExistingOrderUpdates({
      existingOrders: [
        {
          work_order_id: "200",
          customer: "ACMP",
          rfq_state: null,
          last_system_update: "2026-05-11T10:00:00.000Z",
          is_open: true,
          work_order_type: "Wheel Repair",
          part_number: "PN-200",
        },
      ],
      importTimestamp: "2026-05-11T10:00:00.000Z",
      client,
    });

    assert.equal(result.error, null);
    assert.equal(upsertedRows.length, 1);
    assert.equal(upsertedRows[0].hold_reason, RFQ_AWAITING_APPROVAL_REASON);
    assert.equal(
      rows.get("200")?.hold_reason,
      RFQ_AWAITING_APPROVAL_REASON,
    );
    assert.equal(
      isBlocked({
        hold_reason: rows.get("200")?.hold_reason as string | null,
        rfq_state: rows.get("200")?.rfq_state as string | null,
        rfq_manual_approved_at: rows.get("200")
          ?.rfq_manual_approved_at as string | null,
      }),
      true,
    );
  }

  {
    const { client, rows, upsertedRows } = createExistingOrderUpdateClient([
      {
        work_order_id: "210",
        customer: "ACMP",
        rfq_state: "RFQ Send",
        rfq_manual_approved_at: null,
        last_system_update: "2026-05-10T10:00:00.000Z",
        is_open: true,
        work_order_type: "Wheel Repair",
        part_number: "PN-210",
        is_active: true,
        current_process_step: "Assembly",
        assigned_person_team: "Shop",
        included_process_steps: null,
        hold_reason: RFQ_AWAITING_APPROVAL_REASON,
        required_next_action: null,
        action_owner: null,
        action_status: "Done",
        action_closed: true,
        action_created_at: null,
        action_closed_at: "2026-05-10T10:00:00.000Z",
        data_tracking_enabled: false,
      },
      {
        work_order_id: "211",
        customer: "ACMP",
        rfq_state: null,
        rfq_manual_approved_at: null,
        last_system_update: "2026-05-10T10:00:00.000Z",
        is_open: true,
        work_order_type: "Wheel Repair",
        part_number: "PN-211",
        is_active: true,
        current_process_step: "Assembly",
        assigned_person_team: "Shop",
        included_process_steps: null,
        hold_reason: "RFQ must be sent",
        required_next_action: "RFQ must be sent",
        action_owner: null,
        action_status: "Open",
        action_closed: false,
        action_created_at: "2026-05-10T10:00:00.000Z",
        action_closed_at: null,
        data_tracking_enabled: false,
      },
    ]);

    const result = await applyExistingOrderUpdates({
      existingOrders: [
        {
          work_order_id: "210",
          customer: "ACMP",
          rfq_state: null,
          last_system_update: "2026-05-11T10:00:00.000Z",
          is_open: true,
          work_order_type: "Wheel Repair",
          part_number: "PN-210",
        },
        {
          work_order_id: "211",
          customer: "ACMP",
          rfq_state: "RFQ Send",
          last_system_update: "2026-05-11T10:00:00.000Z",
          is_open: true,
          work_order_type: "Wheel Repair",
          part_number: "PN-211",
        },
      ],
      importTimestamp: "2026-05-11T10:00:00.000Z",
      client,
    });

    assert.equal(result.error, null);
    assert.equal(upsertedRows.length, 2);
    assert.equal(upsertedRows[0].hold_reason, RFQ_AWAITING_APPROVAL_REASON);
    assert.equal(rows.get("210")?.hold_reason, RFQ_AWAITING_APPROVAL_REASON);
    assert.equal(rows.get("210")?.rfq_state, null);
    assert.equal(rows.get("211")?.hold_reason, RFQ_AWAITING_APPROVAL_REASON);
  }

  {
    const { client, rows } = createExistingOrderUpdateClient([
      {
        work_order_id: "220",
        customer: "ACMP",
        rfq_state: null,
        rfq_manual_approved_at: null,
        last_system_update: "2026-05-10T10:00:00.000Z",
        is_open: true,
        work_order_type: "Wheel Repair",
        part_number: "PN-220",
        is_active: true,
        current_process_step: "Assembly",
        assigned_person_team: "Shop",
        included_process_steps: null,
        hold_reason: RFQ_AWAITING_APPROVAL_REASON,
        required_next_action: null,
        action_owner: null,
        action_status: "Done",
        action_closed: true,
        action_created_at: null,
        action_closed_at: "2026-05-10T10:00:00.000Z",
        data_tracking_enabled: false,
      },
    ]);

    const result = await applyExistingOrderUpdates({
      existingOrders: [
        {
          work_order_id: "220",
          customer: "ACMP",
          rfq_state: "RFQ Send - Continue",
          last_system_update: "2026-05-11T10:00:00.000Z",
          is_open: true,
          work_order_type: "Wheel Repair",
          part_number: "PN-220",
        },
      ],
      importTimestamp: "2026-05-11T10:00:00.000Z",
      client,
    });

    assert.equal(result.error, null);
    assert.equal(rows.get("220")?.hold_reason, null);
    assert.equal(
      isBlocked({
        hold_reason: rows.get("220")?.hold_reason as string | null,
        rfq_state: rows.get("220")?.rfq_state as string | null,
        rfq_manual_approved_at: rows.get("220")
          ?.rfq_manual_approved_at as string | null,
      }),
      false,
    );
  }

  {
    const pdfPath = "/work order planning app/import/notes.pdf";
    const candidates = [
      dropboxListEntryToExportCandidate(makeDropboxEntry("notes.pdf")),
      older,
      newest,
    ].filter((candidate): candidate is DropboxExportCandidate =>
      Boolean(candidate),
    );
    const { runtime, deletedPaths, movedFiles, importCalls } =
      createMockDropboxRuntime({ candidates });
    const summary = await importDropboxExports({ mode: "auto", runtime });

    assert.equal(summary.candidatesFound, 2);
    assert.equal(summary.processedFiles, 1);
    assert.equal(summary.deletedSuperseded, 1);
    assert.deepEqual(deletedPaths, [newest.pathLower, older.pathLower]);
    assert.equal(deletedPaths.includes(pdfPath), false);
    assert.deepEqual(movedFiles, []);
    assert.equal(importCalls.length, 1);
  }

  {
    const { runtime, deletedPaths, ignoredRecords, importCalls } =
      createMockDropboxRuntime({
        candidates: [older, newest],
        duplicateRowsSignature: true,
      });
    const summary = await importDropboxExports({
      mode: "manual-trigger",
      runtime,
    });

    assert.equal(summary.ignoredDuplicateFiles, 1);
    assert.equal(summary.deletedSuperseded, 1);
    assert.deepEqual(deletedPaths, [newest.pathLower, older.pathLower]);
    assert.equal(importCalls.length, 0);
    assert.equal(ignoredRecords.length, 1);
    assert.equal(ignoredRecords[0].ignoreReason, "duplicate_rows_signature");
  }

  {
    const { runtime, deletedPaths, movedFiles } = createMockDropboxRuntime({
      candidates: [older, newest],
      importResult: {
        result: null,
        error: { message: "Import failed during apply." },
      },
    });
    const summary = await importDropboxExports({ mode: "auto", runtime });

    assert.equal(summary.failedFiles, 1);
    assert.deepEqual(deletedPaths, []);
    assert.deepEqual(movedFiles, [
      { pathLower: newest.pathLower, filename: newest.filename },
    ]);
  }

  {
    const { runtime, deletedPaths, movedFiles, failedRecords, importCalls } =
      createMockDropboxRuntime({
        candidates: [older, newest],
        buffer: workbookBuffer(["Customer", "RFQ State"], ["ACMP", "RFQ Send"]),
      });
    const summary = await importDropboxExports({
      mode: "manual-trigger",
      runtime,
    });

    assert.equal(summary.failedFiles, 1);
    assert.equal(summary.results[0].error, "Invalid AcMP export: required columns missing.");
    assert.deepEqual(deletedPaths, []);
    assert.deepEqual(movedFiles, [
      { pathLower: newest.pathLower, filename: newest.filename },
    ]);
    assert.equal(failedRecords.length, 1);
    assert.equal(
      failedRecords[0].errorMessage,
      "Invalid AcMP export: required columns missing.",
    );
    assert.equal(importCalls.length, 0);
  }

  assert.equal(
    zonedDateTimeToUtcIso({
      year: 2026,
      month: 5,
      day: 4,
      hour: 16,
      minute: 30,
      timeZone: "Europe/Amsterdam",
    }),
    "2026-05-04T14:30:00.000Z",
  );
  assert.equal(
    zonedDateTimeToUtcIso({
      year: 2026,
      month: 1,
      day: 4,
      hour: 16,
      minute: 30,
      timeZone: "Europe/Amsterdam",
    }),
    "2026-01-04T15:30:00.000Z",
  );

  const rowsA = [{ "Work Order": "100", Customer: "ACMP", nested: { b: 2, a: 1 } }];
  const rowsB = [{ nested: { a: 1, b: 2 }, Customer: "ACMP", "Work Order": "100" }];
  const rowsC = [{ "Work Order": "101", Customer: "ACMP", nested: { b: 2, a: 1 } }];

  const signatureA = await createRowsSignature(rowsA);
  const signatureB = await createRowsSignature(rowsB);
  const signatureC = await createRowsSignature(rowsC);

  assert.equal(signatureA, signatureB);
  assert.notEqual(signatureA, signatureC);

  assert.equal(
    isProcessedRowsSignatureDuplicate(signatureA, [
      {
        rows_signature: signatureA,
        status: "processed",
        source_type: "manual",
      },
    ]),
    true,
  );
  assert.equal(
    isProcessedRowsSignatureDuplicate(signatureA, [
      {
        rows_signature: signatureA,
        status: "processed",
        source_type: "dropbox",
      },
    ]),
    true,
  );
  assert.equal(
    isProcessedRowsSignatureDuplicate(signatureA, [
      {
        rows_signature: signatureA,
        status: "failed",
        source_type: "dropbox",
      },
    ]),
    false,
  );

  console.log("AcMP import utility tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
