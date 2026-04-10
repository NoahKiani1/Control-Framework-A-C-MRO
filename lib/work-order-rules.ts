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

export function isBlocked(order: BlockableOrder): boolean {
  if (order.hold_reason) return true;
  if (order.rfq_state === "RFQ Send" || order.rfq_state === "RFQ Rejected") return true;
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
  return date.toLocaleDateString("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function blockReason(
  order: BlockableOrder,
  options: BlockReasonOptions = {},
): string {
  if (order.hold_reason) return order.hold_reason;
  if (order.rfq_state === "RFQ Send") return options.rfqSentLabel || "RFQ verstuurd";
  if (order.rfq_state === "RFQ Rejected") return "RFQ afgewezen";
  return "–";
}
