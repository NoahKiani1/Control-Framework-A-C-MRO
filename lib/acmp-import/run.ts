export type AcmpImportResult = {
  processed: number;
  updated: number;
  deleted: number;
  closedRemoved: number;
  closedSkipped: number;
  missingClosed: number;
  tooOld: number;
  skipped: number;
  pendingNewWorkOrders: number;
  pendingRfqApprovedInactive: number;
};

export type RunAcmpImportFromRowsArgs = {
  rows: Record<string, unknown>[];
  filename: string;
  sourceType: "manual" | "dropbox";
  importTimestamp?: string;
  fileSha256?: string | null;
  dropboxMetadata?: {
    pathLower: string;
    rev: string;
    contentHash?: string | null;
    serverModified?: string | null;
    exportDate?: string | null;
    exportSequence?: number;
  } | null;
};

export type RunAcmpImportFromRowsResponse = Promise<{
  result: AcmpImportResult | null;
  error: { message: string } | null;
  duplicate?: boolean;
}>;

export async function runAcmpImportFromRows(
  args: RunAcmpImportFromRowsArgs,
): RunAcmpImportFromRowsResponse {
  if (typeof window !== "undefined") {
    const { supabase } = await import("@/lib/supabase");
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const response = await fetch("/api/acmp/import/manual", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {}),
      },
      body: JSON.stringify(args),
    });
    const payload = (await response.json()) as Awaited<RunAcmpImportFromRowsResponse>;
    if (!response.ok) {
      return {
        result: null,
        error: payload.error ?? { message: "Import failed." },
        duplicate: payload.duplicate,
      };
    }
    return payload;
  }

  const { runAcmpImportFromRowsOnServer } = await import("./run-server");
  return runAcmpImportFromRowsOnServer(args);
}
// noah was hier
