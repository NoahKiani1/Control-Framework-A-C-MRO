import type { SupabaseClient } from "@supabase/supabase-js";
import { getAbsentEngineerIdSetForDateKey } from "@/lib/engineers";
import { getInitialProcessStepForOrder } from "@/lib/process-steps";
import { supabase } from "@/lib/supabase";
import {
  startWorkOrderDataTracking,
  syncWorkOrderDataBlockState,
} from "@/lib/work-order-data";

export type AbsenceLike = {
  engineer_id: number;
  absence_date: string;
};

export type StaffMemberLike = {
  id: number;
  name: string;
};

export type AbsentInactiveWorkOrder = {
  work_order_id: string;
  customer: string | null;
  part_number: string | null;
  work_order_type: string | null;
  current_process_step: string | null;
  included_process_steps: string[] | null;
  data_tracking_enabled?: boolean | null;
  hold_reason?: string | null;
  rfq_state?: string | null;
  rfq_manual_approved_at?: string | null;
  required_next_action?: string | null;
  action_owner?: string | null;
  action_status?: string | null;
  action_closed?: boolean | null;
  inactive_absent_engineer_id: number | null;
  inactive_absent_engineer_name: string | null;
  inactive_note: string | null;
};

export const ABSENT_TODAY_SUFFIX = " (absent today)";

const AUTO_REACTIVATE_SELECT =
  "work_order_id, customer, part_number, work_order_type, current_process_step, included_process_steps, data_tracking_enabled, hold_reason, rfq_state, rfq_manual_approved_at, required_next_action, action_owner, action_status, action_closed, inactive_absent_engineer_id, inactive_absent_engineer_name, inactive_note";

export function formatStaffOptionLabel<T extends StaffMemberLike>(
  staffMember: T,
  absentEngineerIds: Set<number>,
): string {
  return `${staffMember.name}${
    absentEngineerIds.has(staffMember.id) ? ABSENT_TODAY_SUFFIX : ""
  }`;
}

export function getAbsentStaffMemberByName<T extends StaffMemberLike>(
  staff: T[],
  absentEngineerIds: Set<number>,
  name: string | null | undefined,
): T | null {
  const normalizedName = name?.trim();
  if (!normalizedName) return null;

  return (
    staff.find(
      (staffMember) =>
        staffMember.name === normalizedName &&
        absentEngineerIds.has(staffMember.id),
    ) || null
  );
}

export function buildAbsentAssigneeInactiveNote(engineerName: string): string {
  return `${engineerName} is absent today. Automatically reactivates when ${engineerName} is present again.`;
}

export function buildAbsentAssigneeInactiveFields(
  staffMember: StaffMemberLike,
  today: string,
) {
  return {
    inactive_note: buildAbsentAssigneeInactiveNote(staffMember.name),
    inactive_absent_engineer_id: staffMember.id,
    inactive_absent_engineer_name: staffMember.name,
    inactive_absence_date: today,
  };
}

export function buildAbsentAssigneeInactivePayload(
  staffMember: StaffMemberLike,
  today: string,
  timestamp = new Date().toISOString(),
) {
  return {
    is_active: false,
    ...buildAbsentAssigneeInactiveFields(staffMember, today),
    last_manual_update: timestamp,
  };
}

export function buildClearAbsentAssigneeInactivePayload(
  timestamp = new Date().toISOString(),
) {
  return {
    is_active: true,
    inactive_note: null,
    inactive_absent_engineer_id: null,
    inactive_absent_engineer_name: null,
    inactive_absence_date: null,
    last_system_update: timestamp,
  };
}

export async function reactivateReturnedAbsentAssigneeWorkOrders<
  T extends AbsentInactiveWorkOrder = AbsentInactiveWorkOrder,
>({
  today,
  absences,
  client = supabase,
  select = AUTO_REACTIVATE_SELECT,
}: {
  today: string;
  absences: AbsenceLike[];
  client?: SupabaseClient;
  select?: string;
}): Promise<{
  reactivated: number;
  data: T[];
  error: { message: string } | null;
}> {
  const absentEngineerIds = getAbsentEngineerIdSetForDateKey(absences, today);
  const { data, error } = await client
    .from("work_orders")
    .select(select)
    .eq("is_open", true)
    .eq("is_active", false)
    .not("inactive_absent_engineer_id", "is", null);

  if (error) {
    return { reactivated: 0, data: [], error: { message: error.message } };
  }

  const inactiveOrders = ((data || []) as unknown as T[]).filter((order) => {
    const engineerId = Number(order.inactive_absent_engineer_id);
    return Number.isFinite(engineerId) && !absentEngineerIds.has(engineerId);
  });

  const reactivatedOrders: T[] = [];
  const timestamp = new Date().toISOString();

  for (const order of inactiveOrders) {
    const nextProcessStep =
      order.current_process_step ||
      getInitialProcessStepForOrder(
        order.work_order_type,
        order.included_process_steps,
      );
    const payload = {
      ...buildClearAbsentAssigneeInactivePayload(timestamp),
      current_process_step: nextProcessStep,
    };

    const { data: savedOrder, error: updateError } = await client
      .from("work_orders")
      .update(payload)
      .eq("work_order_id", order.work_order_id)
      .select(select)
      .maybeSingle();

    if (updateError) {
      return {
        reactivated: reactivatedOrders.length,
        data: reactivatedOrders,
        error: { message: updateError.message },
      };
    }

    if (!savedOrder) continue;

    const typedSavedOrder = savedOrder as unknown as T;
    if (typedSavedOrder.data_tracking_enabled === false) {
      const trackingResult = await startWorkOrderDataTracking(
        {
          work_order_id: typedSavedOrder.work_order_id,
          customer: typedSavedOrder.customer,
          part_number: typedSavedOrder.part_number,
          work_order_type: typedSavedOrder.work_order_type,
          current_process_step: typedSavedOrder.current_process_step,
          included_process_steps: typedSavedOrder.included_process_steps,
        },
        timestamp,
        client,
      );

      if (trackingResult.error) {
        return {
          reactivated: reactivatedOrders.length,
          data: reactivatedOrders,
          error: trackingResult.error,
        };
      }
    } else {
      const blockResult = await syncWorkOrderDataBlockState(
        typedSavedOrder,
        timestamp,
        client,
      );

      if (blockResult.error) {
        return {
          reactivated: reactivatedOrders.length,
          data: reactivatedOrders,
          error: blockResult.error,
        };
      }
    }

    reactivatedOrders.push(typedSavedOrder);
  }

  return {
    reactivated: reactivatedOrders.length,
    data: reactivatedOrders,
    error: null,
  };
}
