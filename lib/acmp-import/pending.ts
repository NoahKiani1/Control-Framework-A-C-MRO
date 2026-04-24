import { supabase } from "@/lib/supabase";
import { getExistingWorkOrderIds } from "@/lib/work-orders";
import {
  PendingAcmpReviewType,
  PendingAcmpWorkOrder,
} from "./types";

const PENDING_TABLE = "pending_acmp_work_orders";

export type PendingAcmpInsertRow = {
  work_order_id: string;
  customer: string | null;
  rfq_state: string | null;
  last_system_update: string | null;
  is_open: boolean;
  work_order_type: string | null;
  part_number: string | null;
  source_filename: string | null;
  raw_payload: Record<string, unknown> | null;
  review_type: PendingAcmpReviewType;
  previous_rfq_state: string | null;
  current_process_step: string | null;
  assigned_person_team: string | null;
};

export type PendingAcmpReviewSummary = {
  total: number;
  newWorkOrders: number;
  rfqApprovedInactive: number;
};

export async function getPendingAcmpWorkOrders(): Promise<PendingAcmpWorkOrder[]> {
  const { data, error } = await supabase
    .from(PENDING_TABLE)
    .select("*")
    .eq("status", "pending")
    .order("detected_at", { ascending: true });

  if (error) {
    console.error("Failed to load pending AcMP work orders", error);
    return [];
  }

  return (data as PendingAcmpWorkOrder[]) || [];
}

export async function getPendingAcmpWorkOrderCount(): Promise<number> {
  const { count, error } = await supabase
    .from(PENDING_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  if (error) {
    console.error("Failed to count pending AcMP work orders", error);
    return 0;
  }

  return count ?? 0;
}

export async function getPendingAcmpReviewSummary(): Promise<PendingAcmpReviewSummary> {
  const { data, error } = await supabase
    .from(PENDING_TABLE)
    .select("review_type")
    .eq("status", "pending");

  if (error) {
    console.error("Failed to load pending AcMP review summary", error);
    return { total: 0, newWorkOrders: 0, rfqApprovedInactive: 0 };
  }

  const rows = (data as { review_type: string | null }[]) || [];
  let newWorkOrders = 0;
  let rfqApprovedInactive = 0;
  for (const row of rows) {
    if (row.review_type === "rfq_approved_inactive") {
      rfqApprovedInactive += 1;
    } else {
      newWorkOrders += 1;
    }
  }

  return {
    total: newWorkOrders + rfqApprovedInactive,
    newWorkOrders,
    rfqApprovedInactive,
  };
}

export async function upsertPendingAcmpWorkOrders(rows: PendingAcmpInsertRow[]) {
  if (rows.length === 0) return { error: null };

  const payload = rows.map((row) => ({
    ...row,
    status: "pending",
    processed_at: null,
  }));

  return supabase
    .from(PENDING_TABLE)
    .upsert(payload, {
      onConflict: "work_order_id",
      ignoreDuplicates: false,
    });
}

export async function deletePendingAcmpWorkOrdersByIds(workOrderIds: string[]) {
  if (workOrderIds.length === 0) return { error: null };

  return supabase
    .from(PENDING_TABLE)
    .delete()
    .in("work_order_id", workOrderIds);
}

/**
 * Clears stale new_work_order pending rows whose work_order_id already exists
 * in `work_orders` — these would otherwise nag Office about orders that were
 * inserted elsewhere. rfq_approved_inactive rows are skipped because by
 * definition their work_order_id already exists in `work_orders`.
 */
export async function pruneStalePendingAcmpWorkOrders(
  workOrderIds: string[],
): Promise<number> {
  if (workOrderIds.length === 0) return 0;
  const existing = await getExistingWorkOrderIds(workOrderIds);
  if (existing.length === 0) return 0;
  const { error } = await supabase
    .from(PENDING_TABLE)
    .delete()
    .eq("review_type", "new_work_order")
    .in("work_order_id", existing);
  if (error) {
    console.error("Failed to prune stale pending AcMP work orders", error);
    return 0;
  }
  return existing.length;
}
