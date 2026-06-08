import { listDropboxExportCandidates } from "@/lib/acmp-import/dropbox";
import { requireOfficeUser } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireOfficeUser(request);
  if (!auth.ok) return auth.response;

  try {
    const candidates = await listDropboxExportCandidates();

    return Response.json({
      candidates: candidates.map((candidate) => ({
        filename: candidate.filename,
        exportDate: candidate.exportDate,
        exportSequence: candidate.exportSequence,
        serverModified: candidate.serverModified,
        pathLower: candidate.pathLower,
      })),
    });
  } catch (error) {
    return Response.json(
      {
        error: {
          message:
            error instanceof Error ? error.message : "Dropbox check failed.",
        },
      },
      { status: 500 },
    );
  }
}
// noah was hier
