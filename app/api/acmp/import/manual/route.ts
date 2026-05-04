import { runAcmpImportFromRows } from "@/lib/acmp-import/run";
import { requireOfficeUser } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireOfficeUser(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as {
    rows?: Record<string, unknown>[];
    filename?: string;
    fileSha256?: string | null;
  };

  if (!Array.isArray(body.rows) || !body.filename) {
    return Response.json(
      { error: { message: "Rows and filename are required." } },
      { status: 400 },
    );
  }

  const result = await runAcmpImportFromRows({
    rows: body.rows,
    filename: body.filename,
    sourceType: "manual",
    fileSha256: body.fileSha256 ?? null,
  });

  return Response.json(result, { status: result.error ? 500 : 200 });
}
