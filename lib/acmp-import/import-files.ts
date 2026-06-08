import { getSupabaseServiceClient } from "@/lib/supabase-service";

export type AcmpImportFileStatus =
  | "processing"
  | "processed"
  | "failed"
  | "ignored";

export type AcmpImportFileRecord = {
  id: number;
  source_type: "manual" | "dropbox";
  original_filename: string;
  rows_signature: string;
  file_sha256: string | null;
  dropbox_path_lower: string | null;
  dropbox_rev: string | null;
  dropbox_content_hash: string | null;
  export_date: string | null;
  export_sequence: number;
  server_modified: string | null;
  status: AcmpImportFileStatus;
  ignore_reason: string | null;
  rows_processed: number | null;
  rows_updated: number | null;
  pending_new_work_orders: number | null;
  pending_rfq_approved_inactive: number | null;
  closed_removed: number | null;
  skipped: number | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

export type CreateProcessingImportRecordArgs = {
  sourceType: "manual" | "dropbox";
  originalFilename: string;
  rowsSignature: string;
  fileSha256?: string | null;
  dropboxPathLower?: string | null;
  dropboxRev?: string | null;
  dropboxContentHash?: string | null;
  exportDate?: string | null;
  exportSequence?: number;
  serverModified?: string | null;
  startedAt?: string;
};

export type RowsSignatureStatusRow = {
  rows_signature: string;
  status: AcmpImportFileStatus;
  source_type?: "manual" | "dropbox";
};

export type MarkImportProcessedArgs = {
  id: number;
  rowsProcessed: number;
  rowsUpdated: number;
  pendingNewWorkOrders: number;
  pendingRfqApprovedInactive: number;
  closedRemoved: number;
  skipped: number;
  finishedAt?: string;
};

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

export function isProcessedRowsSignatureDuplicate(
  rowsSignature: string,
  rows: RowsSignatureStatusRow[],
): boolean {
  return rows.some(
    (row) =>
      row.rows_signature === rowsSignature && row.status === "processed",
  );
}

export async function hasProcessedRowsSignature(
  rowsSignature: string,
): Promise<boolean> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("acmp_import_files")
    .select("id")
    .eq("rows_signature", rowsSignature)
    .eq("status", "processed")
    .limit(1);

  if (error) throw new Error(error.message);
  return Boolean(data?.length);
}

export async function hasProcessedDropboxRevision(
  pathLower: string,
  rev: string,
): Promise<boolean> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("acmp_import_files")
    .select("id")
    .eq("dropbox_path_lower", pathLower)
    .eq("dropbox_rev", rev)
    .in("status", ["processed", "ignored"])
    .limit(1);

  if (error) throw new Error(error.message);
  return Boolean(data?.length);
}

export async function createProcessingImportRecord(
  args: CreateProcessingImportRecordArgs,
): Promise<{
  record: AcmpImportFileRecord | null;
  error: { message: string } | null;
  conflict: boolean;
}> {
  const supabase = getSupabaseServiceClient();
  const startedAt = args.startedAt ?? new Date().toISOString();
  const { data, error } = await supabase
    .from("acmp_import_files")
    .insert({
      source_type: args.sourceType,
      original_filename: args.originalFilename,
      rows_signature: args.rowsSignature,
      file_sha256: args.fileSha256 ?? null,
      dropbox_path_lower: args.dropboxPathLower ?? null,
      dropbox_rev: args.dropboxRev ?? null,
      dropbox_content_hash: args.dropboxContentHash ?? null,
      export_date: args.exportDate ?? null,
      export_sequence: args.exportSequence ?? 0,
      server_modified: args.serverModified ?? null,
      status: "processing",
      started_at: startedAt,
    })
    .select("*")
    .single();

  if (error) {
    return {
      record: null,
      error: { message: error.message },
      conflict: isUniqueViolation(error),
    };
  }

  return {
    record: data as AcmpImportFileRecord,
    error: null,
    conflict: false,
  };
}

export async function markImportProcessed(
  args: MarkImportProcessedArgs,
): Promise<{ error: { message: string } | null; conflict: boolean }> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("acmp_import_files")
    .update({
      status: "processed",
      rows_processed: args.rowsProcessed,
      rows_updated: args.rowsUpdated,
      pending_new_work_orders: args.pendingNewWorkOrders,
      pending_rfq_approved_inactive: args.pendingRfqApprovedInactive,
      closed_removed: args.closedRemoved,
      skipped: args.skipped,
      error_message: null,
      finished_at: args.finishedAt ?? new Date().toISOString(),
    })
    .eq("id", args.id);

  if (error) {
    return {
      error: { message: error.message },
      conflict: isUniqueViolation(error),
    };
  }

  return { error: null, conflict: false };
}

export async function markImportFailed({
  id,
  errorMessage,
  finishedAt = new Date().toISOString(),
}: {
  id: number;
  errorMessage: string;
  finishedAt?: string;
}): Promise<{ error: { message: string } | null }> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("acmp_import_files")
    .update({
      status: "failed",
      error_message: errorMessage,
      finished_at: finishedAt,
    })
    .eq("id", id);

  return { error: error ? { message: error.message } : null };
}

export async function markImportIgnored({
  id,
  ignoreReason,
  finishedAt = new Date().toISOString(),
}: {
  id: number;
  ignoreReason: string;
  finishedAt?: string;
}): Promise<{ error: { message: string } | null }> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("acmp_import_files")
    .update({
      status: "ignored",
      ignore_reason: ignoreReason,
      finished_at: finishedAt,
    })
    .eq("id", id);

  return { error: error ? { message: error.message } : null };
}

export async function cleanupAcmpImportFiles(): Promise<{
  error: { message: string } | null;
}> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.rpc("cleanup_acmp_import_files");
  return { error: error ? { message: error.message } : null };
}
// noah was hier
