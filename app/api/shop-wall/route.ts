import { getSupabaseServiceClient } from "@/lib/supabase-service";
import { requireAppRole } from "@/lib/server-auth";
import { sortSharedPlanningOrders } from "@/lib/work-order-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ShopWallWorkOrder = {
  work_order_id: string;
  customer: string | null;
  part_number: string | null;
  work_order_type: string | null;
  due_date: string | null;
  priority: string | null;
  assigned_person_team: string | null;
  current_process_step: string | null;
  hold_reason: string | null;
  rfq_state: string | null;
  required_next_action: string | null;
  action_owner: string | null;
  action_status: string | null;
  action_closed: boolean | null;
  last_manual_update: string | null;
  last_system_update: string | null;
  included_process_steps: string[] | null;
  shared_planning_rank: number | null;
};

type ShopWallEngineer = {
  id: number;
  name: string;
  photo_path: string | null;
  restrictions: string[] | null;
  employment_start_date?: string | null;
};

type ShopWallAbsence = {
  engineer_id: number;
  absence_date: string;
};

type ShopWallExtraAction = {
  id: number;
  description: string;
  responsible_person_team: string;
  due_date: string | null;
  created_at?: string | null;
};

function isDateKey(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function isEngineerStartedOnDateKey(
  engineer: ShopWallEngineer,
  dateKey: string,
): boolean {
  const employmentStartDate = engineer.employment_start_date?.trim();
  return !employmentStartDate || employmentStartDate <= dateKey;
}

function noStoreJson(payload: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store, max-age=0");
  return Response.json(payload, { ...init, headers });
}

export async function GET(request: Request) {
  const auth = await requireAppRole(request, ["office", "wall"]);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const todayParam = url.searchParams.get("today");
  const today = isDateKey(todayParam)
    ? todayParam
    : new Date().toISOString().slice(0, 10);

  const supabase = getSupabaseServiceClient();

  const [ordersResult, engineersResult, absencesResult, extrasResult] =
    await Promise.all([
      supabase
        .from("work_orders")
        .select(
          "work_order_id, customer, part_number, work_order_type, due_date, priority, assigned_person_team, current_process_step, hold_reason, rfq_state, required_next_action, action_owner, action_status, action_closed, last_manual_update, last_system_update, included_process_steps, shared_planning_rank",
        )
        .eq("is_open", true)
        .eq("is_active", true),
      supabase
        .from("engineers")
        .select(
          "id, name, photo_path, restrictions, employment_start_date",
        )
        .eq("is_active", true)
        .eq("role", "shop"),
      supabase
        .from("engineer_absences")
        .select("engineer_id, absence_date")
        .gte("absence_date", today),
      supabase
        .from("extra_actions")
        .select("id, description, responsible_person_team, due_date, created_at"),
    ]);

  const errors = [
    ordersResult.error && `work_orders: ${ordersResult.error.message}`,
    engineersResult.error && `engineers: ${engineersResult.error.message}`,
    absencesResult.error && `engineer_absences: ${absencesResult.error.message}`,
    extrasResult.error && `extra_actions: ${extrasResult.error.message}`,
  ].filter(Boolean);

  if (errors.length > 0) {
    return noStoreJson(
      { error: { message: errors.join("; ") } },
      { status: 500 },
    );
  }

  const engineers = ((engineersResult.data || []) as ShopWallEngineer[]).filter(
    (engineer) => isEngineerStartedOnDateKey(engineer, today),
  );

  return noStoreJson({
    today,
    orders: sortSharedPlanningOrders(
      (ordersResult.data || []) as ShopWallWorkOrder[],
    ),
    engineers,
    absences: (absencesResult.data || []) as ShopWallAbsence[],
    extraActions: (extrasResult.data || []) as ShopWallExtraAction[],
  });
}
