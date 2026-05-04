import assert from "node:assert/strict";
import { parseAcmpExportFilename } from "../lib/acmp-import/dropbox";
import { createRowsSignature } from "../lib/acmp-import/signature";
import { isProcessedRowsSignatureDuplicate } from "../lib/acmp-import/import-files";
import { zonedDateTimeToUtcIso } from "../lib/time-zone";

async function main() {
  assert.deepEqual(parseAcmpExportFilename("werkorders_040526.xlsx"), {
    filename: "werkorders_040526.xlsx",
    exportDate: "2026-05-04",
    exportSequence: 0,
  });
  assert.deepEqual(parseAcmpExportFilename("werkorders_040526 (1).xlsx"), {
    filename: "werkorders_040526 (1).xlsx",
    exportDate: "2026-05-04",
    exportSequence: 1,
  });
  assert.deepEqual(parseAcmpExportFilename("werkorders_040526 (2).xlsx"), {
    filename: "werkorders_040526 (2).xlsx",
    exportDate: "2026-05-04",
    exportSequence: 2,
  });
  assert.equal(parseAcmpExportFilename("werkorders_04-05-26.xlsx"), null);
  assert.equal(parseAcmpExportFilename("werkorders_04052026.xlsx"), null);
  assert.equal(parseAcmpExportFilename("~$werkorders_040526.xlsx"), null);
  assert.equal(parseAcmpExportFilename("werkorders_040526.xls"), null);
  assert.equal(parseAcmpExportFilename("planning_040526.xlsx"), null);

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
