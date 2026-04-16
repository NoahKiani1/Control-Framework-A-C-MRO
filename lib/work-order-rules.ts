type BlockableOrder = {
  hold_reason?: string | null;
  rfq_state?: string | null;
};

type SortableOrder = BlockableOrder & {
  priority?: string | null;
  due_date?: string | null;
};

type BlockReasonOptions = {
  rfqSentLabel?: string;
};

export const DEFAULT_ASSIGNED_PERSON_TEAM = "Shop";

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
