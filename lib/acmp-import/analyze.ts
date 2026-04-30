import {
  isOlderThanOneYear,
  mapWorkOrderType,
  normalizeImportedRfqState,
  parseExcelDate,
} from "@/lib/import-normalize";
import { getExistingWorkOrderIds, getWorkOrders } from "@/lib/work-orders";
import {
  ExistingOrderSnapshot,
  ImportAnalysis,
  ParsedRow,
  RfqActivationCandidate,
} from "./types";

export function normalizeRfqForComparison(state: string | null | undefined): string {
  return (state || "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function isRfqApprovedState(state: string | null | undefined): boolean {
  const rfq = normalizeRfqForComparison(state);
  return (
    rfq === "rfq send - continue" ||
    rfq === "rfq approved" ||
    rfq === "rfq accepted"
  );
}

const EXISTING_ORDER_SELECT =
  "work_order_id, customer, rfq_state, last_system_update, is_open, work_order_type, part_number, is_active, current_process_step, assigned_person_team, included_process_steps";

export async function analyzeImportRows(
  rows: Record<string, unknown>[],
): Promise<ImportAnalysis> {
  let skipCount = 0;
  let oldCount = 0;
  let closedCount = 0;
  const oldIds: string[] = [];
  const closedIds: string[] = [];
  const closedWorkOrders: { work_order_id: string; close_date: string | null }[] = [];
  const parsed: ParsedRow[] = [];
  const rawByWorkOrderId: Record<string, Record<string, unknown>> = {};

  for (const row of rows) {
    const workOrderId = String(row["Work Order"] || "").trim();
    if (!workOrderId) {
      skipCount++;
      continue;
    }

    if (isOlderThanOneYear(row["CreatedOn"])) {
      oldIds.push(workOrderId);
      oldCount++;
      continue;
    }

    const closeDate = parseExcelDate(row["Close Date"]);
    if (closeDate) {
      closedIds.push(workOrderId);
      closedWorkOrders.push({ work_order_id: workOrderId, close_date: closeDate });
      closedCount++;
      continue;
    }

    const customer = String(row["Customer"] || "").trim();
    const rfqState = String(row["RFQ State"] || "").trim();
    const compType = String(row["Comp. Type"] || "").trim();
    const description = String(row["Description"] || "").trim();
    const partNumber = String(row["Comp. Pn"] || "").trim();

    const parsedRow: ParsedRow = {
      work_order_id: workOrderId,
      customer: customer || null,
      rfq_state: normalizeImportedRfqState(rfqState),
      last_system_update: parseExcelDate(row["LastUpdatedOn"]),
      is_open: true,
      work_order_type: mapWorkOrderType(compType, description),
      part_number: partNumber || null,
    };
    parsed.push(parsedRow);
    rawByWorkOrderId[workOrderId] = row;
  }

  const ids = parsed.map((r) => r.work_order_id);
  const existingIdList = await getExistingWorkOrderIds(ids);
  const existingIds = new Set(existingIdList);

  const newOrders = parsed.filter((r) => !existingIds.has(r.work_order_id));
  const existingOrders = parsed.filter((r) => existingIds.has(r.work_order_id));

  const existingSnapshots = existingOrders.length
    ? await getWorkOrders<ExistingOrderSnapshot>({
        select: EXISTING_ORDER_SELECT,
        workOrderIds: existingOrders.map((r) => r.work_order_id),
      })
    : [];

  const existingSnapshotMap = new Map(
    existingSnapshots.map((order) => [order.work_order_id, order]),
  );
  const rfqActivationCandidates = existingOrders
    .map((order) => {
      const current = existingSnapshotMap.get(order.work_order_id);
      if (!current || current.is_active) return null;
      if (!isRfqApprovedState(order.rfq_state)) return null;
      if (isRfqApprovedState(current.rfq_state)) return null;

      return {
        ...order,
        previous_rfq_state: current.rfq_state,
        current_process_step: current.current_process_step,
        assigned_person_team: current.assigned_person_team,
      };
    })
    .filter(Boolean) as RfqActivationCandidate[];

  return {
    parsed,
    newOrders,
    existingOrders,
    rfqActivationCandidates,
    oldIds,
    closedIds,
    closedWorkOrders,
    tooOld: oldCount,
    closedSkipped: closedCount,
    skipped: skipCount,
    existingSnapshots,
    rawByWorkOrderId,
  };
}

export { EXISTING_ORDER_SELECT };
