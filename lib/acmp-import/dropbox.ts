import * as XLSX from "xlsx";
import { createBufferSha256, createRowsSignature } from "@/lib/acmp-import/signature";
import {
  createProcessingImportRecord,
  hasProcessedRowsSignature,
  markImportFailed,
  markImportIgnored,
} from "@/lib/acmp-import/import-files";
import {
  type AcmpImportResult,
  type RunAcmpImportFromRowsArgs,
  type RunAcmpImportFromRowsResponse,
  runAcmpImportFromRows,
} from "@/lib/acmp-import/run";

const LEGACY_ACMP_EXPORT_NAME_RE =
  /^werkorders_(\d{2})(\d{2})(\d{2})(?: \((\d+)\))?\.xlsx$/i;
const INVALID_ACMP_EXPORT_MESSAGE =
  "Invalid AcMP export: required columns missing.";
const REQUIRED_ACMP_EXPORT_COLUMNS = ["Work Order"];
const EXPECTED_ACMP_EXPORT_COLUMNS = [
  "Customer",
  "RFQ State",
  "CreatedOn",
  "LastUpdatedOn",
  "Close Date",
  "Comp. Type",
  "Description",
  "Comp. Pn",
];

const DROPBOX_API = "https://api.dropboxapi.com/2";
const DROPBOX_CONTENT_API = "https://content.dropboxapi.com/2";
const DEFAULT_DROPBOX_IMPORT_PATH = "/Work Order Planning App/import";
const DEFAULT_DROPBOX_FAILED_PATH = "/Work Order Planning App/failed";
const DROPBOX_IMPORT_PATH =
  process.env.ACMP_DROPBOX_IMPORT_PATH || DEFAULT_DROPBOX_IMPORT_PATH;
const DROPBOX_FAILED_PATH =
  process.env.ACMP_DROPBOX_FAILED_PATH || DEFAULT_DROPBOX_FAILED_PATH;

export type ParsedAcmpExportFilename = {
  filename: string;
  exportDate: string | null;
  exportSequence: number;
};

export type DropboxExportCandidate = ParsedAcmpExportFilename & {
  pathLower: string;
  rev: string;
  contentHash: string | null;
  serverModified: string | null;
};

export type DropboxImportFileSummary = {
  filename: string;
  pathLower: string;
  status: "processed" | "ignored" | "failed";
  duplicate?: boolean;
  ignoreReason?: string;
  result: AcmpImportResult | null;
  error: string | null;
};

export type DropboxImportSummary = {
  candidatesFound: number;
  processed: number;
  ignored: number;
  failed: number;
  deletedSuperseded: number;
  processedFiles: number;
  ignoredDuplicateFiles: number;
  failedFiles: number;
  results: DropboxImportFileSummary[];
  totals: AcmpImportResult;
};

export type DropboxListFolderEntry = {
  ".tag": string;
  name: string;
  path_lower?: string;
  rev?: string;
  content_hash?: string;
  server_modified?: string;
};

type DropboxListFolderResponse = {
  entries: DropboxListFolderEntry[];
  cursor: string;
  has_more: boolean;
};

export type AcmpExportValidation = {
  ok: boolean;
  missingRequired: string[];
  missingExpected: string[];
};

export type ParsedAcmpWorkbook = {
  rows: Record<string, unknown>[];
  headers: string[];
};

export type DropboxImportRuntime = {
  scanCandidates: () => Promise<DropboxExportCandidate[]>;
  downloadFile: (pathLower: string) => Promise<ArrayBuffer>;
  deleteFile: (pathLower: string) => Promise<void>;
  moveFileToFailed: (pathLower: string, filename: string) => Promise<void>;
  createBufferSha256: (buffer: ArrayBuffer) => Promise<string>;
  createRowsSignature: (rows: Record<string, unknown>[]) => Promise<string>;
  hasProcessedRowsSignature: (rowsSignature: string) => Promise<boolean>;
  recordFailedImport: (args: {
    candidate: DropboxExportCandidate;
    fileSha256: string | null;
    rowsSignature: string;
    errorMessage: string;
  }) => Promise<void>;
  recordIgnoredImport: (args: {
    candidate: DropboxExportCandidate;
    fileSha256: string | null;
    rowsSignature: string;
    ignoreReason: string;
  }) => Promise<void>;
  readWorkbook: (buffer: ArrayBuffer) => ParsedAcmpWorkbook;
  runImportFromRows: (
    args: RunAcmpImportFromRowsArgs,
  ) => RunAcmpImportFromRowsResponse;
};

function emptyTotals(): AcmpImportResult {
  return {
    processed: 0,
    updated: 0,
    deleted: 0,
    closedRemoved: 0,
    closedSkipped: 0,
    missingClosed: 0,
    tooOld: 0,
    skipped: 0,
    pendingNewWorkOrders: 0,
    pendingRfqApprovedInactive: 0,
  };
}

function addTotals(
  totals: AcmpImportResult,
  result: AcmpImportResult | null,
): AcmpImportResult {
  if (!result) return totals;
  return {
    processed: totals.processed + result.processed,
    updated: totals.updated + result.updated,
    deleted: totals.deleted + result.deleted,
    closedRemoved: totals.closedRemoved + result.closedRemoved,
    closedSkipped: totals.closedSkipped + result.closedSkipped,
    missingClosed: totals.missingClosed + result.missingClosed,
    tooOld: totals.tooOld + result.tooOld,
    skipped: totals.skipped + result.skipped,
    pendingNewWorkOrders:
      totals.pendingNewWorkOrders + result.pendingNewWorkOrders,
    pendingRfqApprovedInactive:
      totals.pendingRfqApprovedInactive +
      result.pendingRfqApprovedInactive,
  };
}

function isValidDateParts(day: number, month: number, year: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function parseAcmpExportFilename(
  filename: string,
): ParsedAcmpExportFilename | null {
  if (!isDropboxExcelImportFilename(filename)) return null;

  const match = filename.match(LEGACY_ACMP_EXPORT_NAME_RE);
  if (!match) return { filename, exportDate: null, exportSequence: 0 };

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = 2000 + Number(match[3]);
  if (!isValidDateParts(day, month, year)) {
    return { filename, exportDate: null, exportSequence: 0 };
  }

  const exportDate = `${year}-${String(month).padStart(2, "0")}-${String(
    day,
  ).padStart(2, "0")}`;
  const exportSequence = match[4] ? Number(match[4]) : 0;

  return { filename, exportDate, exportSequence };
}

export function isDropboxExcelImportFilename(filename: string): boolean {
  return !filename.startsWith("~$") && filename.toLowerCase().endsWith(".xlsx");
}

export function dropboxListEntryToExportCandidate(
  entry: DropboxListFolderEntry,
): DropboxExportCandidate | null {
  if (entry[".tag"] !== "file" || !entry.path_lower || !entry.rev) return null;

  const parsed = parseAcmpExportFilename(entry.name);
  if (!parsed) return null;

  return {
    ...parsed,
    pathLower: entry.path_lower,
    rev: entry.rev,
    contentHash: entry.content_hash ?? null,
    serverModified: entry.server_modified ?? null,
  };
}

export function sortDropboxExportCandidates(
  candidates: DropboxExportCandidate[],
): DropboxExportCandidate[] {
  return [...candidates].sort((a, b) => {
    return (
      (b.serverModified ?? "").localeCompare(a.serverModified ?? "") ||
      b.pathLower.localeCompare(a.pathLower)
    );
  });
}

export function selectNewestDropboxExportCandidate(
  candidates: DropboxExportCandidate[],
): DropboxExportCandidate | null {
  return sortDropboxExportCandidates(candidates)[0] ?? null;
}

export function validateAcmpExportHeaders(
  headers: string[],
): AcmpExportValidation {
  const headerSet = new Set(headers.map((header) => header.trim()));
  const missingRequired = REQUIRED_ACMP_EXPORT_COLUMNS.filter(
    (column) => !headerSet.has(column),
  );
  const missingExpected = EXPECTED_ACMP_EXPORT_COLUMNS.filter(
    (column) => !headerSet.has(column),
  );

  return {
    ok: missingRequired.length === 0,
    missingRequired,
    missingExpected,
  };
}

export function validateAcmpExportRows(
  rows: Record<string, unknown>[],
): AcmpExportValidation {
  const headers = Array.from(
    new Set(rows.flatMap((row) => Object.keys(row))),
  );
  return validateAcmpExportHeaders(headers);
}

export function readAcmpWorkbook(buffer: ArrayBuffer): ParsedAcmpWorkbook {
  const workbook = XLSX.read(buffer);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { rows: [], headers: [] };

  const sheet = workbook.Sheets[sheetName];
  const headerRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
  });
  const firstHeaderRow = headerRows[0] ?? [];
  const headers = firstHeaderRow
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet);

  return { rows, headers };
}

async function getDropboxAccessToken(): Promise<string> {
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
  const appKey = process.env.DROPBOX_APP_KEY;
  const appSecret = process.env.DROPBOX_APP_SECRET;
  if (refreshToken && appKey && appSecret) {
    const credentials = Buffer.from(`${appKey}:${appSecret}`).toString("base64");
    const response = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      throw new Error(`Dropbox token refresh failed with ${response.status}.`);
    }

    const payload = (await response.json()) as { access_token?: string };
    if (!payload.access_token) {
      throw new Error("Dropbox token refresh did not return an access token.");
    }
    return payload.access_token;
  }

  if (process.env.DROPBOX_ACCESS_TOKEN) {
    return process.env.DROPBOX_ACCESS_TOKEN;
  }

  throw new Error(
    "Dropbox is not configured. Set DROPBOX_APP_KEY, DROPBOX_APP_SECRET, and DROPBOX_REFRESH_TOKEN for production, or DROPBOX_ACCESS_TOKEN as a local-only fallback.",
  );
}

async function dropboxFetch(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const token = await getDropboxAccessToken();
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  return response;
}

async function dropboxJson<T>(endpoint: string, body: unknown): Promise<T> {
  const response = await dropboxFetch(`${DROPBOX_API}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Dropbox ${endpoint} failed with ${response.status}: ${text}`);
  }

  return (await response.json()) as T;
}

async function listDropboxFolder(path: string): Promise<DropboxListFolderEntry[]> {
  const entries: DropboxListFolderEntry[] = [];
  let response: DropboxListFolderResponse;

  try {
    response = await dropboxJson<DropboxListFolderResponse>("/files/list_folder", {
      path,
      recursive: false,
      include_deleted: false,
      include_mounted_folders: true,
      include_non_downloadable_files: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("not_found")) return [];
    throw error;
  }

  entries.push(...response.entries);
  while (response.has_more) {
    response = await dropboxJson<DropboxListFolderResponse>(
      "/files/list_folder/continue",
      { cursor: response.cursor },
    );
    entries.push(...response.entries);
  }

  return entries;
}

export async function listDropboxExportCandidates(): Promise<
  DropboxExportCandidate[]
> {
  const entries = await listDropboxFolder(DROPBOX_IMPORT_PATH);
  const candidates = entries
    .map(dropboxListEntryToExportCandidate)
    .filter((entry): entry is DropboxExportCandidate => Boolean(entry));

  return sortDropboxExportCandidates(candidates);
}

export async function downloadDropboxFile(pathLower: string): Promise<ArrayBuffer> {
  const response = await dropboxFetch(`${DROPBOX_CONTENT_API}/files/download`, {
    method: "POST",
    headers: {
      "Dropbox-API-Arg": JSON.stringify({ path: pathLower }),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Dropbox download failed with ${response.status}: ${text}`);
  }

  return response.arrayBuffer();
}

export async function deleteDropboxFile(pathLower: string): Promise<void> {
  await dropboxJson("/files/delete_v2", { path: pathLower });
}

async function ensureDropboxFolder(path: string): Promise<void> {
  try {
    await dropboxJson("/files/create_folder_v2", { path, autorename: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("conflict")) throw error;
  }
}

export async function moveDropboxFileToFailed(
  pathLower: string,
  filename: string,
): Promise<void> {
  await ensureDropboxFolder(DROPBOX_FAILED_PATH);
  await dropboxJson("/files/move_v2", {
    from_path: pathLower,
    to_path: `${DROPBOX_FAILED_PATH}/${filename}`,
    autorename: true,
    allow_ownership_transfer: false,
  });
}

export async function scanDropboxExports(): Promise<DropboxExportCandidate[]> {
  return listDropboxExportCandidates();
}

async function recordFailedDropboxImport({
  candidate,
  fileSha256,
  rowsSignature,
  errorMessage,
}: {
  candidate: DropboxExportCandidate;
  fileSha256: string | null;
  rowsSignature: string;
  errorMessage: string;
}): Promise<void> {
  const record = await createProcessingImportRecord({
    sourceType: "dropbox",
    originalFilename: candidate.filename,
    rowsSignature,
    fileSha256,
    dropboxPathLower: candidate.pathLower,
    dropboxRev: candidate.rev,
    dropboxContentHash: candidate.contentHash,
    exportDate: candidate.exportDate,
    exportSequence: candidate.exportSequence,
    serverModified: candidate.serverModified,
  });

  if (record.record) {
    await markImportFailed({
      id: record.record.id,
      errorMessage,
    });
  }
}

async function recordIgnoredDropboxImport({
  candidate,
  fileSha256,
  rowsSignature,
  ignoreReason,
}: {
  candidate: DropboxExportCandidate;
  fileSha256: string | null;
  rowsSignature: string;
  ignoreReason: string;
}): Promise<void> {
  const record = await createProcessingImportRecord({
    sourceType: "dropbox",
    originalFilename: candidate.filename,
    rowsSignature,
    fileSha256,
    dropboxPathLower: candidate.pathLower,
    dropboxRev: candidate.rev,
    dropboxContentHash: candidate.contentHash,
    exportDate: candidate.exportDate,
    exportSequence: candidate.exportSequence,
    serverModified: candidate.serverModified,
  });

  if (record.record) {
    const ignored = await markImportIgnored({
      id: record.record.id,
      ignoreReason,
    });
    if (ignored.error) {
      console.error("Failed to mark Dropbox import ignored", ignored.error);
    }
  } else if (record.error) {
    console.error("Failed to record ignored Dropbox import", record.error);
  }
}

function createDefaultDropboxImportRuntime(): DropboxImportRuntime {
  return {
    scanCandidates: scanDropboxExports,
    downloadFile: downloadDropboxFile,
    deleteFile: deleteDropboxFile,
    moveFileToFailed: moveDropboxFileToFailed,
    createBufferSha256,
    createRowsSignature,
    hasProcessedRowsSignature,
    recordFailedImport: recordFailedDropboxImport,
    recordIgnoredImport: recordIgnoredDropboxImport,
    readWorkbook: readAcmpWorkbook,
    runImportFromRows: runAcmpImportFromRows,
  };
}

function dropboxMetadataForImport(candidate: DropboxExportCandidate) {
  return {
    pathLower: candidate.pathLower,
    rev: candidate.rev,
    contentHash: candidate.contentHash,
    serverModified: candidate.serverModified,
    exportDate: candidate.exportDate,
    exportSequence: candidate.exportSequence,
  };
}

async function markDropboxCandidateFailed({
  runtime,
  candidate,
  fileSha256,
  errorMessage,
  signatureRows,
}: {
  runtime: DropboxImportRuntime;
  candidate: DropboxExportCandidate;
  fileSha256: string | null;
  errorMessage: string;
  signatureRows: Record<string, unknown>[];
}): Promise<void> {
  try {
    const rowsSignature = await runtime.createRowsSignature(signatureRows);
    await runtime.recordFailedImport({
      candidate,
      fileSha256,
      rowsSignature,
      errorMessage,
    });
  } catch (metadataError) {
    console.error("Failed to record Dropbox import failure", metadataError);
  }

  try {
    await runtime.moveFileToFailed(candidate.pathLower, candidate.filename);
  } catch (moveError) {
    console.error("Failed to move Dropbox file to failed folder", moveError);
  }
}

async function deleteAcceptedDropboxCandidates(
  runtime: DropboxImportRuntime,
  candidates: DropboxExportCandidate[],
): Promise<number> {
  let deletedSuperseded = 0;

  for (const [index, candidate] of candidates.entries()) {
    try {
      await runtime.deleteFile(candidate.pathLower);
      if (index > 0) deletedSuperseded++;
    } catch (error) {
      console.error("Failed to delete Dropbox import candidate", {
        pathLower: candidate.pathLower,
        error,
      });
    }
  }

  if (deletedSuperseded > 0) {
    console.info(
      `Deleted ${deletedSuperseded} older Dropbox Excel export candidate${
        deletedSuperseded === 1 ? "" : "s"
      } as superseded_by_newer_export.`,
    );
  }

  return deletedSuperseded;
}

function buildDropboxImportSummary({
  candidatesFound,
  deletedSuperseded,
  results,
  totals,
}: {
  candidatesFound: number;
  deletedSuperseded: number;
  results: DropboxImportFileSummary[];
  totals: AcmpImportResult;
}): DropboxImportSummary {
  const processed = results.filter((result) => result.status === "processed")
    .length;
  const ignored = results.filter((result) => result.status === "ignored").length;
  const failed = results.filter((result) => result.status === "failed").length;

  return {
    candidatesFound,
    processed,
    ignored,
    failed,
    deletedSuperseded,
    processedFiles: processed,
    ignoredDuplicateFiles: ignored,
    failedFiles: failed,
    results,
    totals,
  };
}

export async function importDropboxExports({
  mode,
  runtime = createDefaultDropboxImportRuntime(),
}: {
  mode: "auto" | "manual-trigger";
  runtime?: DropboxImportRuntime;
}): Promise<DropboxImportSummary> {
  void mode;
  const candidates = sortDropboxExportCandidates(await runtime.scanCandidates());
  const results: DropboxImportFileSummary[] = [];
  let totals = emptyTotals();
  let deletedSuperseded = 0;

  const candidate = candidates[0] ?? null;
  if (!candidate) {
    return buildDropboxImportSummary({
      candidatesFound: 0,
      deletedSuperseded,
      results,
      totals,
    });
  }

  let fileSha256: string | null = null;
  try {
    const buffer = await runtime.downloadFile(candidate.pathLower);
    fileSha256 = await runtime.createBufferSha256(buffer);
    const parsedWorkbook = runtime.readWorkbook(buffer);
    const validation = validateAcmpExportHeaders(parsedWorkbook.headers);

    if (!validation.ok) {
      await markDropboxCandidateFailed({
        runtime,
        candidate,
        fileSha256,
        errorMessage: INVALID_ACMP_EXPORT_MESSAGE,
        signatureRows:
          parsedWorkbook.rows.length > 0
            ? parsedWorkbook.rows
            : [
                {
                  dropbox_path_lower: candidate.pathLower,
                  dropbox_rev: candidate.rev,
                  headers: parsedWorkbook.headers,
                  failure: INVALID_ACMP_EXPORT_MESSAGE,
                },
              ],
      });
      results.push({
        filename: candidate.filename,
        pathLower: candidate.pathLower,
        status: "failed",
        result: null,
        error: INVALID_ACMP_EXPORT_MESSAGE,
      });
      return buildDropboxImportSummary({
        candidatesFound: candidates.length,
        deletedSuperseded,
        results,
        totals,
      });
    }

    const rowsSignature = await runtime.createRowsSignature(parsedWorkbook.rows);
    if (await runtime.hasProcessedRowsSignature(rowsSignature)) {
      await runtime.recordIgnoredImport({
        candidate,
        fileSha256,
        rowsSignature,
        ignoreReason: "duplicate_rows_signature",
      });
      deletedSuperseded = await deleteAcceptedDropboxCandidates(
        runtime,
        candidates,
      );
      results.push({
        filename: candidate.filename,
        pathLower: candidate.pathLower,
        status: "ignored",
        duplicate: true,
        ignoreReason: "duplicate_rows_signature",
        result: null,
        error: null,
      });
      return buildDropboxImportSummary({
        candidatesFound: candidates.length,
        deletedSuperseded,
        results,
        totals,
      });
    }

    const importResult = await runtime.runImportFromRows({
      rows: parsedWorkbook.rows,
      filename: candidate.filename,
      sourceType: "dropbox",
      fileSha256,
      dropboxMetadata: dropboxMetadataForImport(candidate),
    });

    if (importResult.error) {
      try {
        await runtime.moveFileToFailed(candidate.pathLower, candidate.filename);
      } catch (moveError) {
        console.error("Failed to move Dropbox file to failed folder", moveError);
      }
      results.push({
        filename: candidate.filename,
        pathLower: candidate.pathLower,
        status: "failed",
        result: null,
        error: importResult.error.message,
      });
      return buildDropboxImportSummary({
        candidatesFound: candidates.length,
        deletedSuperseded,
        results,
        totals,
      });
    }

    deletedSuperseded = await deleteAcceptedDropboxCandidates(runtime, candidates);
    totals = addTotals(totals, importResult.result);
    results.push({
      filename: candidate.filename,
      pathLower: candidate.pathLower,
      status: importResult.duplicate ? "ignored" : "processed",
      duplicate: importResult.duplicate,
      ignoreReason: importResult.duplicate
        ? "duplicate_rows_signature"
        : undefined,
      result: importResult.result,
      error: null,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown Dropbox import error.";

    await markDropboxCandidateFailed({
      runtime,
      candidate,
      fileSha256,
      errorMessage: message,
      signatureRows: [
        {
          dropbox_path_lower: candidate.pathLower,
          dropbox_rev: candidate.rev,
          failure: message,
        },
      ],
    });

    results.push({
      filename: candidate.filename,
      pathLower: candidate.pathLower,
      status: "failed",
      result: null,
      error: message,
    });
  }

  return buildDropboxImportSummary({
    candidatesFound: candidates.length,
    deletedSuperseded,
    results,
    totals,
  });
}
// noah was hier
