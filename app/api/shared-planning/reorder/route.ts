import { getSupabaseServiceClient } from "@/lib/supabase-service";
import { requireOfficeUser } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number): Response {
  return Response.json({ error: { message } }, { status });
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export async function POST(request: Request) {
  const auth = await requireOfficeUser(request);
  if (!auth.ok) return auth.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const workOrderIds =
    payload &&
    typeof payload === "object" &&
    "workOrderIds" in payload
      ? (payload as { workOrderIds: unknown }).workOrderIds
      : null;

  if (!isStringArray(workOrderIds)) {
    return jsonError("workOrderIds must be an array of work order ids.", 400);
  }

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.rpc("set_shared_planning_order", {
    work_order_ids: workOrderIds,
  });

  if (error) {
    return jsonError(error.message, 500);
  }

  return Response.json({ ok: true });
}
