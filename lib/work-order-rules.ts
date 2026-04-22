import { canPerformStep } from "@/lib/restrictions";

type BlockableOrder = {
  hold_reason?: string | null;
  rfq_state?: string | null;
};

type SortableOrder = BlockableOrder & {
  priority?: string | null;
  due_date?: string | null;
};

type CorrectiveActionOrder = {
  required_next_action?: string | null;
  action_owner?: string | null;
};

type QualifiableOrder = BlockableOrder & {
  current_process_step: string | null;
};

type QualifiableEngineer = {
  id: number;
  restrictions: string[] | null;
};

type DatedAbsence = {
  engineer_id: number;
  absence_date: string;
};

type BlockReasonOptions = {
  rfqSentLabel?: string;
};

export const DEFAULT_ASSIGNED_PERSON_TEAM = "Shop";
export const NO_QUALIFIED_ENGINEER_REASON = "No Qualified Engineer Present";

export type PriorityTag = "AOG" | "PRIO";

export function priorityTag(
  priority: string | null | undefined,
): PriorityTag | null {
  const p = (priority || "").trim().toLowerCase();
  if (p === "aog") return "AOG";
  if (p === "yes" || p === "prio" || p === "priority") return "PRIO";
  return null;
}

export function localDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeAssignedPersonTeam(
  assignedPersonTeam: string | null | undefined,
): string {
  return assignedPersonTeam?.trim() || DEFAULT_ASSIGNED_PERSON_TEAM;
}

export function normalizeRfqState(state: string | null | undefined): string {
  return (state || "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function isRfqBlockedState(state: string | null | undefined): boolean {
  const rfq = normalizeRfqState(state);
  return rfq === "rfq send" || rfq === "rfq rejected";
}

export function isBlocked(order: BlockableOrder): boolean {
  if (order.hold_reason) return true;
  if (isRfqBlockedState(order.rfq_state)) return true;
  return false;
}

function dueDateTime(dateStr: string | null | undefined): number {
  if (!dateStr) return Number.POSITIVE_INFINITY;

  const normalizedDate = /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
    ? `${dateStr}T00:00:00Z`
    : dateStr;
  const time = new Date(normalizedDate).getTime();

  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

export function sortOrders<T extends SortableOrder>(orders: T[]): T[] {
  return [...orders].sort((a, b) => dueDateTime(a.due_date) - dueDateTime(b.due_date));
}

export function latestUpdate(system: string | null, manual: string | null): string | null {
  if (!system && !manual) return null;
  if (!system) return manual;
  if (!manual) return system;
  return new Date(system) > new Date(manual) ? system : manual;
}

export function getCorrectiveActionContext(order: CorrectiveActionOrder): {
  action: string | null;
  owner: string | null;
  summary: string | null;
} {
  const action = order.required_next_action?.trim() || null;

  if (!action) {
    return {
      action: null,
      owner: null,
      summary: null,
    };
  }

  const owner = order.action_owner?.trim() || null;

  return {
    action,
    owner,
    summary: owner ? `Action: ${action} · Owner: ${owner}` : `Action: ${action}`,
  };
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return "–";
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function isStale(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  return new Date(dateStr) < twoWeeksAgo;
}

export function applyTodayQualificationBlocks<T extends QualifiableOrder>(
  orders: T[],
  engineers: QualifiableEngineer[],
  absences: DatedAbsence[],
  today: string,
): T[] {
  const absentEngineerIds = new Set(
    absences
      .filter((a) => a.absence_date === today)
      .map((a) => a.engineer_id),
  );
  const presentEngineers = engineers.filter(
    (e) => !absentEngineerIds.has(e.id),
  );

  return orders.map((order) => {
    if (isBlocked(order) || !order.current_process_step) return order;

    const hasQualifiedEngineer = presentEngineers.some((e) =>
      canPerformStep(e.restrictions, order.current_process_step!),
    );

    if (hasQualifiedEngineer) return order;

    return {
      ...order,
      hold_reason: NO_QUALIFIED_ENGINEER_REASON,
    };
  });
}

export function blockReason(
  order: BlockableOrder,
  options: BlockReasonOptions = {},
): string {
  if (order.hold_reason) return order.hold_reason;
  const rfq = normalizeRfqState(order.rfq_state);
  if (rfq === "rfq send") return options.rfqSentLabel || "RFQ sent";
  if (rfq === "rfq rejected") return "RFQ rejected";
  return "–";
}

export function rfqDisplay(rfqState: string | null): { label: string; color: string } {
  const rfq = normalizeRfqState(rfqState);
  if (!rfq || rfq === "undefined") return { label: "No RFQ", color: "#999" };
  if (rfq === "rfq send") return { label: "RFQ Send", color: "#dc2626" };
  if (rfq === "rfq rejected") return { label: "RFQ Rejected", color: "#dc2626" };
  if (rfq === "rfq send - continue") return { label: "RFQ Send - Continue", color: "#16a34a" };
  return { label: rfqState || "", color: "#666" };
}
