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

function normalizeRfq(state: string | null | undefined): string {
  return (state || "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function isBlocked(order: BlockableOrder): boolean {
  if (order.hold_reason) return true;
  const rfq = normalizeRfq(order.rfq_state);
  if (rfq === "rfq send" || rfq === "rfq rejected") return true;
  return false;
}

export function sortOrders<T extends SortableOrder>(orders: T[]): T[] {
  return [...orders].sort((a, b) => {
    const rank = (order: T) => {
      if (isBlocked(order)) return 5;
      if (order.priority === "AOG") return 1;
      if (order.priority === "Yes") return 2;
      if (order.due_date) return 3;
      return 4;
    };

    const ra = rank(a);
    const rb = rank(b);

    if (ra !== rb) return ra - rb;
    if (ra === 3 && a.due_date && b.due_date) {
      return a.due_date.localeCompare(b.due_date);
    }

    return 0;
  });
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
  const rfq = normalizeRfq(order.rfq_state);
  if (rfq === "rfq send") return options.rfqSentLabel || "RFQ sent";
  if (rfq === "rfq rejected") return "RFQ rejected";
  return "–";
}

export function rfqDisplay(rfqState: string | null): { label: string; color: string } {
  const rfq = normalizeRfq(rfqState);
  if (!rfq || rfq === "undefined") return { label: "No RFQ", color: "#999" };
  if (rfq === "rfq send") return { label: "RFQ Send", color: "#dc2626" };
  if (rfq === "rfq rejected") return { label: "RFQ Rejected", color: "#dc2626" };
  if (rfq === "rfq send - continue") return { label: "RFQ Send - Continue", color: "#16a34a" };
  return { label: rfqState || "", color: "#666" };
}