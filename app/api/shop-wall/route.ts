import { getSupabaseServiceClient } from "@/lib/supabase-service";
import { requireAppRole } from "@/lib/server-auth";
import { sortSharedPlanningOrders } from "@/lib/work-order-rules";
import {
  RENS_OFFICE_ASSIGNEE_NAME,
  getRensOfficeStaff,
} from "@/lib/manual-office-assignees";
import { reactivateReturnedAbsentAssigneeWorkOrders } from "@/lib/absent-assignment";
import { getShopWallSettings } from "@/lib/shop-wall-settings";

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
  rfq_manual_approved_at: string | null;
  required_next_action: string | null;
  action_owner: string | null;
  action_status: string | null;
  action_closed: boolean | null;
  last_manual_update: string | null;
  last_system_update: string | null;
  included_process_steps: string[] | null;
  completed_ndt_steps: string[] | null;
  shared_planning_rank: number | null;
};

type ShopWallEngineer = {
  id: number;
  name: string;
  photo_path: string | null;
  restrictions: string[] | null;
  role?: string | null;
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

const SHOP_WALL_WORK_ORDER_SELECT =
  "work_order_id, customer, part_number, work_order_type, due_date, priority, assigned_person_team, current_process_step, hold_reason, rfq_state, rfq_manual_approved_at, required_next_action, action_owner, action_status, action_closed, last_manual_update, last_system_update, included_process_steps, completed_ndt_steps, shared_planning_rank";

function isDateKey(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function isMissingCompletedNdtStepsColumnError(error: {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}): boolean {
  const errorText = [
    error.code,
    error.message,
    error.details,
    error.hint,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    errorText.includes("completed_ndt_steps") &&
    (errorText.includes("could not find") ||
      errorText.includes("schema cache") ||
      errorText.includes("column") ||
      error.code === "42703")
  );
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

  const [
    engineersResult,
    rensOfficeResult,
    absencesResult,
    extrasResult,
    wallSettings,
  ] =
    await Promise.all([
      supabase
        .from("engineers")
        .select(
          "id, name, photo_path, restrictions, employment_start_date",
        )
        .eq("is_active", true)
        .eq("role", "shop"),
      supabase
        .from("engineers")
        .select(
          "id, name, role, photo_path, restrictions, employment_start_date",
        )
        .eq("is_active", true)
        .eq("role", "office")
        .eq("name", RENS_OFFICE_ASSIGNEE_NAME),
      supabase
        .from("engineer_absences")
        .select("engineer_id, absence_date")
        .gte("absence_date", today),
      supabase
        .from("extra_actions")
        .select("id, description, responsible_person_team, due_date, created_at"),
      getShopWallSettings(supabase),
    ]);

  const errors = [
    engineersResult.error && `engineers: ${engineersResult.error.message}`,
    rensOfficeResult.error && `rens: ${rensOfficeResult.error.message}`,
    absencesResult.error && `engineer_absences: ${absencesResult.error.message}`,
    extrasResult.error && `extra_actions: ${extrasResult.error.message}`,
  ].filter(Boolean);

  if (errors.length > 0) {
    return noStoreJson(
      { error: { message: errors.join("; ") } },
      { status: 500 },
    );
  }

  const reactivationResult =
    await reactivateReturnedAbsentAssigneeWorkOrders({
      today,
      absences: (absencesResult.data || []) as ShopWallAbsence[],
      client: supabase,
    });
  if (reactivationResult.error) {
    console.error(
      `Failed to reactivate returned absent-assignee work orders: ${reactivationResult.error.message}`,
    );
  }

  const loadOrders = (select: string) =>
    supabase
      .from("work_orders")
      .select(select)
      .eq("is_open", true)
      .eq("is_active", true);

  const ordersResult = await loadOrders(SHOP_WALL_WORK_ORDER_SELECT);
  let ordersData = ordersResult.data as unknown as ShopWallWorkOrder[] | null;
  let ordersError = ordersResult.error;

  if (
    ordersError &&
    isMissingCompletedNdtStepsColumnError(ordersError)
  ) {
    const fallbackResult = await loadOrders(
      SHOP_WALL_WORK_ORDER_SELECT.replace(", completed_ndt_steps", ""),
    );

    if (!fallbackResult.error) {
      console.warn(
        "work_orders.completed_ndt_steps is not available yet; shop wall loads without partial NDT progress.",
      );
      ordersData = (
        (fallbackResult.data || []) as unknown as Record<string, unknown>[]
      ).map((row) => ({
        ...row,
        completed_ndt_steps: null,
      })) as ShopWallWorkOrder[];
      ordersError = null;
    }
  }

  if (ordersError) {
    return noStoreJson(
      { error: { message: `work_orders: ${ordersError.message}` } },
      { status: 500 },
    );
  }

  const engineers = ((engineersResult.data || []) as ShopWallEngineer[]).filter(
    (engineer) => isEngineerStartedOnDateKey(engineer, today),
  );
  const rensOfficeStaff = getRensOfficeStaff(
    ((rensOfficeResult.data || []) as ShopWallEngineer[]).filter((staffMember) =>
      isEngineerStartedOnDateKey(staffMember, today),
    ),
  );

  return noStoreJson({
    today,
    orders: sortSharedPlanningOrders(ordersData || []),
    engineers,
    assigneeStaff: [...engineers, ...rensOfficeStaff],
    absences: (absencesResult.data || []) as ShopWallAbsence[],
    extraActions: (extrasResult.data || []) as ShopWallExtraAction[],
    wallSettings,
  });
}
