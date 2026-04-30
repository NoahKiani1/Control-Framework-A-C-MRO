import {
  INTAKE_STEP,
  getActiveStepsForType,
  getInitialProcessStepForOrder,
  getProcessStepsForType,
} from "@/lib/process-steps";
import {
  normalizeAssignedPersonTeam,
  normalizePriorityValue,
} from "@/lib/work-order-rules";
import {
  clearImportRuns,
  createImportRun,
  deleteWorkOrdersByIds,
  getWorkOrders,
  insertWorkOrders,
  updateWorkOrder,
  upsertWorkOrders,
} from "@/lib/work-orders";
import {
  createClosedWorkOrderReportFromWorkOrder,
  startWorkOrderDataTracking,
  syncWorkOrderDataBlockState,
} from "@/lib/work-order-data";
import { EXISTING_ORDER_SELECT } from "./analyze";
import {
  ExistingOrderSnapshot,
  NewOrderSetup,
  ParsedRow,
} from "./types";

const BATCH_SIZE = 500;

export function defaultIncludedStepsForType(
  workOrderType: string | null,
): string[] {
  return getActiveStepsForType(workOrderType, false);
}

export function normalizeIncludedSteps(
  workOrderType: string | null,
  selected: string[],
): string[] {
  const template = getProcessStepsForType(workOrderType);
  if (template.length === 0) return [];

  const selectedSet = new Set(selected);
  return template.filter(
    (step) => selectedSet.has(step) || step === INTAKE_STEP,
  );
}

type ExistingUpdateResult = {
  updated: number;
  error: { message: string } | null;
};

/**
 * Sync AcMP system fields onto work_orders for every existing order in the
 * import. This does NOT activate inactive orders whose RFQ state just became
 * approved/continue — those go to the AcMP Review queue instead so Office can
 * decide. Active orders keep their auto-updates (RFQ, customer, part number,
 * default assignee when missing).
 */
export async function applyExistingOrderUpdates({
  existingOrders,
  importTimestamp,
}: {
  existingOrders: ParsedRow[];
  importTimestamp: string;
}): Promise<ExistingUpdateResult> {
  if (existingOrders.length === 0) {
    return { updated: 0, error: null };
  }

  const existingIds = existingOrders.map((r) => r.work_order_id);
  const currentData = await getWorkOrders<ExistingOrderSnapshot>({
    select: EXISTING_ORDER_SELECT,
    workOrderIds: existingIds,
  });
  const currentMap = new Map(currentData.map((r) => [r.work_order_id, r]));

  let updated = 0;

  for (let i = 0; i < existingOrders.length; i += BATCH_SIZE) {
    const batch = existingOrders.slice(i, i + BATCH_SIZE).map((r) => {
      const current = currentMap.get(r.work_order_id);
      const shouldDefaultAssigned =
        Boolean(current?.is_active) &&
        !current?.assigned_person_team?.trim();
      const changed =
        !current ||
        current.customer !== r.customer ||
        current.rfq_state !== r.rfq_state ||
        current.work_order_type !== r.work_order_type ||
        current.part_number !== r.part_number ||
        shouldDefaultAssigned;

      return {
        ...r,
        ...(shouldDefaultAssigned
          ? {
              assigned_person_team: normalizeAssignedPersonTeam(
                current?.assigned_person_team,
              ),
            }
          : {}),
        last_system_update: changed ? importTimestamp : r.last_system_update,
      };
    });

    const { error } = await upsertWorkOrders(batch);
    if (error) {
      return { updated, error };
    }

    for (const row of batch) {
      const current = currentMap.get(row.work_order_id);
      if (!current?.data_tracking_enabled) continue;

      const blockResult = await syncWorkOrderDataBlockState(
        {
          ...current,
          ...row,
          data_tracking_enabled: current.data_tracking_enabled,
          hold_reason: current.hold_reason,
          required_next_action: current.required_next_action,
          action_owner: current.action_owner,
          action_status: current.action_status,
          action_closed: current.action_closed,
        },
        row.last_system_update ?? importTimestamp,
      );

      if (blockResult.error) {
        console.error(
          `Failed to sync Work Order Data block state for ${row.work_order_id}: ${blockResult.error.message}`,
        );
      }
    }

    updated += batch.length;
  }

  return { updated, error: null };
}

export function findMissingDueDateOrder(
  newOrders: ParsedRow[],
  newOrderSetup: Record<string, NewOrderSetup>,
): ParsedRow | null {
  const missing = newOrders.find((order) => {
    const setup = newOrderSetup[order.work_order_id];
    return (
      setup?.is_active &&
      (setup.priority === "Yes" || setup.priority === "AOG") &&
      !setup.due_date
    );
  });
  return missing ?? null;
}

export async function applyNewOrderInserts({
  newOrders,
  newOrderSetup,
  importTimestamp,
}: {
  newOrders: ParsedRow[];
  newOrderSetup: Record<string, NewOrderSetup>;
  importTimestamp: string;
}): Promise<{ inserted: number; error: { message: string } | null }> {
  let inserted = 0;

  for (let i = 0; i < newOrders.length; i += BATCH_SIZE) {
    const batch = newOrders.slice(i, i + BATCH_SIZE).map((r) => {
      const setup = newOrderSetup[r.work_order_id];
      const isActive = setup?.is_active || false;
      const includedSteps =
        setup?.included_steps &&
        normalizeIncludedSteps(r.work_order_type, setup.included_steps);
      return {
        ...r,
        is_active: isActive,
        priority: normalizePriorityValue(setup?.priority),
        due_date: setup?.due_date || null,
        assigned_person_team:
          (setup?.assigned_person_team || "").trim() ||
          (isActive ? normalizeAssignedPersonTeam(null) : null),
        included_process_steps:
          includedSteps && includedSteps.length > 0 ? includedSteps : null,
        current_process_step: isActive
          ? getInitialProcessStepForOrder(
              r.work_order_type,
              includedSteps ?? null,
            )
          : null,
        last_system_update: importTimestamp,
      };
    });

    const { error } = await insertWorkOrders(batch);
    if (error) {
      return { inserted, error };
    }

    const activeTrackedRows = batch.filter((row) => row.is_active);
    for (const row of activeTrackedRows) {
      const trackingResult = await startWorkOrderDataTracking(
        {
          work_order_id: row.work_order_id,
          customer: row.customer,
          part_number: row.part_number,
          work_order_type: row.work_order_type,
          current_process_step: row.current_process_step,
          included_process_steps: row.included_process_steps,
        },
        importTimestamp,
      );
      if (trackingResult.error) {
        console.error(
          `Failed to start Work Order Data tracking for ${row.work_order_id}: ${trackingResult.error.message}`,
        );
        continue;
      }

      const blockResult = await syncWorkOrderDataBlockState(
        {
          ...row,
          data_tracking_enabled: true,
        },
        row.last_system_update ?? importTimestamp,
      );
      if (blockResult.error) {
        console.error(
          `Failed to sync Work Order Data block state for ${row.work_order_id}: ${blockResult.error.message}`,
        );
      }
    }

    inserted += batch.length;
  }

  return { inserted, error: null };
}

/**
 * Activate an existing inactive work order after Office approved the RFQ
 * review. Keeps the work order's current process step / assignee if they are
 * already set, otherwise falls back to the standard defaults. Work Order Data
 * tracking intentionally stays off because the order has been inactive.
 */
export async function activateRfqApprovedWorkOrder({
  workOrderId,
  activationTimestamp,
}: {
  workOrderId: string;
  activationTimestamp: string;
}): Promise<{ error: { message: string } | null }> {
  const [current] = await getWorkOrders<ExistingOrderSnapshot>({
    select: EXISTING_ORDER_SELECT,
    workOrderIds: [workOrderId],
  });

  if (!current) {
    return {
      error: { message: `Work order ${workOrderId} no longer exists.` },
    };
  }

  const nextStep =
    current.current_process_step ||
    getInitialProcessStepForOrder(
      current.work_order_type,
      current.included_process_steps,
    );

  const nextAssigned = normalizeAssignedPersonTeam(
    current.assigned_person_team,
  );

  const { error } = await updateWorkOrder(workOrderId, {
    is_active: true,
    current_process_step: nextStep,
    assigned_person_team: nextAssigned,
    last_system_update: activationTimestamp,
  });

  return { error: error ?? null };
}

export async function finalizeClosedWorkOrderReports({
  closedWorkOrders,
}: {
  closedWorkOrders: { work_order_id: string; close_date: string | null }[];
}): Promise<void> {
  for (const closed of closedWorkOrders) {
    const result = await createClosedWorkOrderReportFromWorkOrder({
      workOrderId: closed.work_order_id,
      closeDate: closed.close_date,
    });
    if (result.error) {
      console.error(
        `Failed to finalize Work Order Data report for ${closed.work_order_id}: ${result.error.message}`,
      );
    }
  }
}

export async function applyDeletions({
  oldIds,
  closedIds,
}: {
  oldIds: string[];
  closedIds: string[];
}): Promise<{ deleted: number; closedRemoved: number }> {
  let deleted = 0;
  for (let i = 0; i < oldIds.length; i += BATCH_SIZE) {
    const batch = oldIds.slice(i, i + BATCH_SIZE);
    await deleteWorkOrdersByIds(batch);
    deleted += batch.length;
  }

  let closedRemoved = 0;
  for (let i = 0; i < closedIds.length; i += BATCH_SIZE) {
    const batch = closedIds.slice(i, i + BATCH_SIZE);
    const { count } = await deleteWorkOrdersByIds(batch, { withCount: true });
    closedRemoved += count || 0;
  }

  return { deleted, closedRemoved };
}

export async function recordImportRun({
  filename,
  rowsProcessed,
  rowsInserted,
  rowsUpdated,
  status = "done",
}: {
  filename: string;
  rowsProcessed: number;
  rowsInserted: number;
  rowsUpdated: number;
  status?: string;
}) {
  await clearImportRuns();
  await createImportRun({
    filename,
    rows_processed: rowsProcessed,
    rows_inserted: rowsInserted,
    rows_updated: rowsUpdated,
    status,
  });
}
