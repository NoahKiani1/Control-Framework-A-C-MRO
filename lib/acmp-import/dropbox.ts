import * as XLSX from "xlsx";
import { createBufferSha256, createRowsSignature } from "@/lib/acmp-import/signature";
import {
  createProcessingImportRecord,
  hasProcessedDropboxRevision,
  markImportFailed,
} from "@/lib/acmp-import/import-files";
import {
  type AcmpImportResult,
  runAcmpImportFromRows,
} from "@/lib/acmp-import/run";

export const ACMP_EXPORT_NAME_RE =
  /^werkorders_(\d{2})(\d{2})(\d{2})(?: \((\d+)\))?\.xlsx$/i;

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
  exportDate: string;
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
  result: AcmpImportResult | null;
  error: string | null;
};

export type DropboxImportSummary = {
  processedFiles: number;
  ignoredDuplicateFiles: number;
  failedFiles: number;
  results: DropboxImportFileSummary[];
  totals: AcmpImportResult;
};

type DropboxListFolderEntry = {
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

function emptyTotals(): AcmpImportResult {
  return {
    processed: 0,
    updated: 0,
    deleted: 0,
    closedRemoved: 0,
    closedSkipped: 0,
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
  if (filename.startsWith("~$")) return null;

  const match = filename.match(ACMP_EXPORT_NAME_RE);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = 2000 + Number(match[3]);
  if (!isValidDateParts(day, month, year)) return null;

  const exportDate = `${year}-${String(month).padStart(2, "0")}-${String(
    day,
  ).padStart(2, "0")}`;
  const exportSequence = match[4] ? Number(match[4]) : 0;

  return { filename, exportDate, exportSequence };
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
    .map((entry) => {
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
    })
    .filter((entry): entry is DropboxExportCandidate => Boolean(entry));

  return candidates.sort((a, b) => {
    return (
      a.exportDate.localeCompare(b.exportDate) ||
      (a.serverModified ?? "").localeCompare(b.serverModified ?? "") ||
      a.exportSequence - b.exportSequence ||
      a.pathLower.localeCompare(b.pathLower)
    );
  });
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

export async function importDropboxExports({
  mode,
}: {
  mode: "auto" | "manual-trigger";
}): Promise<DropboxImportSummary> {
  void mode;
  const candidates = await scanDropboxExports();
  const results: DropboxImportFileSummary[] = [];
  let totals = emptyTotals();

  for (const candidate of candidates) {
    let fileSha256: string | null = null;
    try {
      if (
        await hasProcessedDropboxRevision(candidate.pathLower, candidate.rev)
      ) {
        await deleteDropboxFile(candidate.pathLower);
        results.push({
          filename: candidate.filename,
          pathLower: candidate.pathLower,
          status: "ignored",
          duplicate: true,
          result: null,
          error: null,
        });
        continue;
      }

      const buffer = await downloadDropboxFile(candidate.pathLower);
      fileSha256 = await createBufferSha256(buffer);
      const workbook = XLSX.read(buffer);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet);

      const importResult = await runAcmpImportFromRows({
        rows,
        filename: candidate.filename,
        sourceType: "dropbox",
        fileSha256,
        dropboxMetadata: {
          pathLower: candidate.pathLower,
          rev: candidate.rev,
          contentHash: candidate.contentHash,
          serverModified: candidate.serverModified,
          exportDate: candidate.exportDate,
          exportSequence: candidate.exportSequence,
        },
      });

      if (importResult.error) {
        await moveDropboxFileToFailed(candidate.pathLower, candidate.filename);
        results.push({
          filename: candidate.filename,
          pathLower: candidate.pathLower,
          status: "failed",
          result: null,
          error: importResult.error.message,
        });
        continue;
      }

      await deleteDropboxFile(candidate.pathLower);
      totals = addTotals(totals, importResult.result);
      results.push({
        filename: candidate.filename,
        pathLower: candidate.pathLower,
        status: importResult.duplicate ? "ignored" : "processed",
        duplicate: importResult.duplicate,
        result: importResult.result,
        error: null,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown Dropbox import error.";

      try {
        const rowsSignature = await createRowsSignature([
          {
            dropbox_path_lower: candidate.pathLower,
            dropbox_rev: candidate.rev,
            failure: message,
          },
        ]);
        await recordFailedDropboxImport({
          candidate,
          fileSha256,
          rowsSignature,
          errorMessage: message,
        });
      } catch (metadataError) {
        console.error("Failed to record Dropbox import failure", metadataError);
      }

      try {
        await moveDropboxFileToFailed(candidate.pathLower, candidate.filename);
      } catch (moveError) {
        console.error("Failed to move Dropbox file to failed folder", moveError);
      }

      results.push({
        filename: candidate.filename,
        pathLower: candidate.pathLower,
        status: "failed",
        result: null,
        error: message,
      });
    }
  }

  return {
    processedFiles: results.filter((result) => result.status === "processed")
      .length,
    ignoredDuplicateFiles: results.filter(
      (result) => result.status === "ignored",
    ).length,
    failedFiles: results.filter((result) => result.status === "failed").length,
    results,
    totals,
  };
}
