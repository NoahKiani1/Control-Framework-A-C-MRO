import { importDropboxExports } from "@/lib/acmp-import/dropbox";
import { requireOfficeUser } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireOfficeUser(request);
  if (!auth.ok) return auth.response;

  try {
    const summary = await importDropboxExports({ mode: "manual-trigger" });
    return Response.json(summary);
  } catch (error) {
    return Response.json(
      {
        error: {
          message:
            error instanceof Error ? error.message : "Dropbox import failed.",
        },
      },
      { status: 500 },
    );
  }
}
// noah was hier
