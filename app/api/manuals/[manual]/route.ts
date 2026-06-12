import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireAppRole } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const manualFiles = {
  "application-manual": {
    fileName: "Application Manual.pdf",
  },
  "instructions-for-code-changes": {
    fileName: "Instructions for Code Changes.pdf",
  },
  "technical-manual": {
    fileName: "Technical Manual.pdf",
  },
} as const;

type ManualKey = keyof typeof manualFiles;

function jsonError(message: string, status: number): Response {
  return Response.json(
    { error: { message } },
    {
      status,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ manual: string }> },
) {
  const auth = await requireAppRole(request, ["office", "developer"]);
  if (!auth.ok) return auth.response;

  const { manual } = await params;
  const config = manualFiles[manual as ManualKey];

  if (!config) {
    return jsonError("Manual not found.", 404);
  }

  try {
    const file = await readFile(path.join(process.cwd(), "docs", config.fileName));

    return new Response(file, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Content-Disposition": `inline; filename="${config.fileName}"`,
        "Content-Type": "application/pdf",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Unable to read manual.",
      500,
    );
  }
}
// noah was hier
