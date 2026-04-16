"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  formatDate,
  isBlocked,
  isStale,
  latestUpdate,
  normalizeAssignedPersonTeam,
  sortOrders,
} from "@/lib/work-order-rules";
import { getWorkOrders, updateWorkOrder } from "@/lib/work-orders";
import {
  getEngineers,
  getEngineerAbsences,
  deletePastEngineerAbsences,
} from "@/lib/engineers";
import { calculateWeekCapacity } from "@/lib/capacity";
import { RESTRICTION_BLOCKED_STEPS } from "@/lib/restrictions";
import { getProcessStepsForType, READY_TO_CLOSE_STEP } from "@/lib/process-steps";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WorkOrder = {
  work_order_id: string;
  customer: string | null;
  part_number: string | null;
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
  work_order_type: string | null;
  is_open: boolean;
  is_active: boolean;
};

type Engineer = {
  id: number;
  name: string;
  is_active: boolean;
  restrictions: string[] | null;
};

type Absence = {
  id: number;
  engineer_id: number;
  absence_date: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isDueThisWeek(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayOfWeek = today.getDay();
  const daysUntilFriday = dayOfWeek <= 5 ? 5 - dayOfWeek : 0;
  const friday = new Date(today);
  friday.setDate(friday.getDate() + daysUntilFriday);
  friday.setHours(23, 59, 59, 999);

  const due = new Date(dateStr);
  due.setHours(0, 0, 0, 0);
  return due >= today && due <= friday;
}

function isOverdue(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dateStr);
  due.setHours(0, 0, 0, 0);
  return due < today;
}

function hasOpenAction(o: WorkOrder): boolean {
  return !!(o.hold_reason || o.required_next_action) && o.action_status !== "Done";
}

function engineerCanDoRestriction(eng: Engineer, restriction: string): boolean {
  if (!eng.restrictions || eng.restrictions.length === 0) return true;
  return !eng.restrictions.includes(restriction);
}

function blockedReason(order: WorkOrder): string {
  if (order.hold_reason) return order.hold_reason;
  if (order.rfq_state === "RFQ Rejected") return "RFQ Rejected";
  if (order.rfq_state === "RFQ Send") return "Waiting for RFQ Approval";
  return "Blocked";
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const cellStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderBottom: "1px solid #eee",
  fontSize: "13px",
  whiteSpace: "normal",
  overflowWrap: "anywhere",
  verticalAlign: "top",
  textAlign: "left",
};

const headerStyle: React.CSSProperties = {
  ...cellStyle,
  fontWeight: "bold",
  backgroundColor: "#f5f5f5",
  position: "sticky" as const,
  top: 0,
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

type CardProps = {
  label: string;
  value: number;
  color: string;
  bgColor: string;
  active: boolean;
  onClick?: () => void;
  subtitle?: string;
};

function formatAnimatedNumber(value: number, decimals: number): string {
  if (decimals === 0) return String(Math.round(value));

  const rounded = Number(value.toFixed(decimals));
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(decimals);
}

function AnimatedNumber({
  value,
  decimals = 0,
}: {
  value: number;
  decimals?: number;
}) {
  const [displayValue, setDisplayValue] = useState(0);
  const displayValueRef = useRef(0);
  const animationKey = `${value}:${decimals}`;

  useEffect(() => {
    const [targetValue, decimalCount] = animationKey.split(":").map(Number);
    const startValue = displayValueRef.current;
    const difference = targetValue - startValue;
    const duration = 550;
    let animationFrame = 0;
    let startTime: number | null = null;

    function tick(timestamp: number) {
      if (startTime === null) startTime = timestamp;

      const progress = Math.min((timestamp - startTime) / duration, 1);
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      const multiplier = 10 ** decimalCount;
      const nextValue =
        Math.round((startValue + difference * easedProgress) * multiplier) /
        multiplier;

      displayValueRef.current = nextValue;
      setDisplayValue(nextValue);

      if (progress < 1) {
        animationFrame = requestAnimationFrame(tick);
      }
    }

    animationFrame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(animationFrame);
  }, [animationKey]);

  return <>{formatAnimatedNumber(displayValue, decimals)}</>;
}

function AnimatedProgressBar({
  value,
  color,
}: {
  value: number;
  color: string;
}) {
  const [displayValue, setDisplayValue] = useState(0);
  const displayValueRef = useRef(0);
  const animationKey = String(value);

  useEffect(() => {
    const targetValue = Number(animationKey);
    const startValue = displayValueRef.current;
    const difference = targetValue - startValue;
    const duration = 550;
    let animationFrame = 0;
    let startTime: number | null = null;

    function tick(timestamp: number) {
      if (startTime === null) startTime = timestamp;

      const progress = Math.min((timestamp - startTime) / duration, 1);
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      const nextValue = startValue + difference * easedProgress;

      displayValueRef.current = nextValue;
      setDisplayValue(nextValue);

      if (progress < 1) {
        animationFrame = requestAnimationFrame(tick);
      }
    }

    animationFrame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(animationFrame);
  }, [animationKey]);

  return (
    <div
      style={{
        height: "100%",
        width: `${Math.min(displayValue, 100)}%`,
        backgroundColor: color,
        borderRadius: "3px",
      }}
    />
  );
}

function ProcessStepDisplay({ order }: { order: WorkOrder }) {
  if (isBlocked(order)) {
    return (
      <span
        className="blocked-step-tooltip"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "5px",
          color: "#dc2626",
          fontWeight: 700,
          cursor: "help",
        }}
      >
        <span aria-hidden="true">▲</span>
        <span>Blocked</span>
        <span className="blocked-step-tooltip-text">
          {blockedReason(order)}
        </span>
      </span>
    );
  }

  return <>{order.current_process_step || "–"}</>;
}

function KpiCard({ label, value, color, bgColor, active, onClick, subtitle }: CardProps) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: "1 1 0",
        minWidth: "140px",
        padding: "16px 18px",
        backgroundColor: active ? color : bgColor,
        border: active ? `2px solid ${color}` : "1px solid #e5e7eb",
        borderRadius: "10px",
        cursor: onClick ? "pointer" : "default",
        textAlign: "left",
        transition: "all 0.15s ease",
        boxShadow: active ? `0 2px 8px ${color}33` : "0 1px 3px rgba(0,0,0,0.06)",
      }}
    >
      <div
        style={{
          fontSize: "28px",
          fontWeight: "700",
          color: active ? "white" : color,
          lineHeight: 1,
        }}
      >
        <AnimatedNumber value={value} />
      </div>
      <div
        style={{
          fontSize: "13px",
          color: active ? "rgba(255,255,255,0.85)" : "#555",
          marginTop: "6px",
          fontWeight: 500,
        }}
      >
        {label}
      </div>
      {subtitle && (
        <div
          style={{
            fontSize: "11px",
            color: active ? "rgba(255,255,255,0.7)" : "#999",
            marginTop: "2px",
          }}
        >
          {subtitle}
        </div>
      )}
    </button>
  );
}

type AbsenceDayImpact = {
  dateLabel: string;
  date: Date;
  absentEngineers: { name: string; restrictions: string[] | null }[];
  unavailableSteps: string[];
  affectedOrders: {
    work_order_id: string;
    customer: string | null;
    current_step: string;
    blocked_remaining_steps: string[];
  }[];
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type DetailPanel = "due" | "overdue" | "actions" | "ready" | "aog" | "stale" | null;

export default function DashboardPage() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [engineers, setEngineers] = useState<Engineer[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [loading, setLoading] = useState(true);
  const [activePanel, setActivePanel] = useState<DetailPanel>(null);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function load() {
      const today = new Date().toISOString().split("T")[0];
      await deletePastEngineerAbsences(today);

      const [wo, eng, abs] = await Promise.all([
        getWorkOrders<WorkOrder>({
          select: "*",
          isOpen: true,
          isActive: true,
        }),
        getEngineers<Engineer>({
          select: "*",
          isActive: true,
          role: "shop",
          orderBy: { column: "name" },
        }),
        getEngineerAbsences<Absence>({
          select: "id, engineer_id, absence_date",
          fromDate: today,
        }),
      ]);

      setOrders(sortOrders(wo));

      const shopIds = new Set(eng.map((e) => e.id));
      setEngineers(eng);
      setAbsences(abs.filter((a) => shopIds.has(a.engineer_id)));
      setLoading(false);
    }

    load();
  }, []);

  if (loading) return <p style={{ padding: "2rem" }}>Loading...</p>;

  // -----------------------------------------------------------------------
  // Derived data
  // -----------------------------------------------------------------------

  const activeOrders = orders.filter(
    (o) => o.current_process_step !== READY_TO_CLOSE_STEP,
  );
  const readyToClose = orders.filter(
    (o) => o.current_process_step === READY_TO_CLOSE_STEP,
  );

  const dueThisWeek = activeOrders.filter(
    (o) => isDueThisWeek(o.due_date),
  );
  const overdueOrders = activeOrders.filter(
    (o) => isOverdue(o.due_date) && !isBlocked(o),
  );
  const openActions = activeOrders.filter(hasOpenAction);
  const aogOrders = activeOrders.filter(
    (o) => o.priority === "AOG" || o.priority === "Yes",
  );
  const staleOrders = activeOrders.filter((o) => {
    const last = latestUpdate(o.last_system_update, o.last_manual_update);
    return isStale(last);
  });

  // Capacity this week
  const todayStr = new Date().toISOString().split("T")[0];
  const absenceDates = absences
    .filter((a) => a.absence_date >= todayStr)
    .map((a) => {
      const d = new Date(a.absence_date + "T00:00:00");
      d.setHours(0, 0, 0, 0);
      return d;
    });

  const { weeks } = calculateWeekCapacity(
    activeOrders.map((o) => ({
      work_order_id: o.work_order_id,
      customer: o.customer,
      work_order_type: o.work_order_type,
      part_number: o.part_number,
      current_process_step: o.current_process_step,
      due_date: o.due_date,
      hold_reason: o.hold_reason,
      rfq_state: o.rfq_state,
    })),
    engineers.length,
    absenceDates,
  );

  const thisWeek = weeks[0];
  const capacityColor =
    thisWeek?.status === "red"
      ? "#dc2626"
      : thisWeek?.status === "orange"
        ? "#ea580c"
        : "#16a34a";

  // Absence impact this week
  const engineerMap = new Map(engineers.map((e) => [e.id, e]));

  // Get remaining work days this week (today through Friday)
  const todayDate = new Date();
  todayDate.setHours(0, 0, 0, 0);
  const dayOfWeek = todayDate.getDay();
  const daysUntilFriday = dayOfWeek <= 5 ? 5 - dayOfWeek : 0;

  const remainingWorkDays: Date[] = [];
  for (let i = 0; i <= daysUntilFriday; i++) {
    const d = new Date(todayDate);
    d.setDate(d.getDate() + i);
    if (d.getDay() >= 1 && d.getDay() <= 5) {
      remainingWorkDays.push(d);
    }
  }

  // Helper: get the remaining steps for a specific order (current step + all after)
  // based on the order's type and its position in the step sequence
  function getRemainingStepsForOrder(order: WorkOrder): string[] {
    if (!order.work_order_type || !order.current_process_step) return [];
    const steps = getProcessStepsForType(order.work_order_type);
    const currentIdx = steps.indexOf(order.current_process_step);
    if (currentIdx === -1) return [];
    return steps.slice(currentIdx); // current step + everything after
  }

  const allRestrictedSteps = Object.entries(RESTRICTION_BLOCKED_STEPS);
  const nonBlockedActive = activeOrders.filter((o) => !isBlocked(o));

  const absenceDayImpacts: AbsenceDayImpact[] = remainingWorkDays
    .map((day) => {
      const dayStr = day.toISOString().split("T")[0];

      // Engineers absent this day
      const absentIds = new Set(
        absences
          .filter((a) => a.absence_date === dayStr)
          .map((a) => a.engineer_id),
      );

      if (absentIds.size === 0) return null;

      const absentEngineers = [...absentIds]
        .map((id) => engineerMap.get(id))
        .filter(Boolean)
        .map((e) => ({ name: e!.name, restrictions: e!.restrictions }));

      // For each restriction type, check if all qualified engineers are absent
      const unavailableSteps: string[] = [];
      for (const [restriction, steps] of allRestrictedSteps) {
        const qualifiedEngineers = engineers.filter((e) =>
          engineerCanDoRestriction(e, restriction),
        );
        const availableQualified = qualifiedEngineers.filter(
          (e) => !absentIds.has(e.id),
        );
        if (availableQualified.length === 0 && qualifiedEngineers.length > 0) {
          unavailableSteps.push(...steps);
        }
      }

      // Per order: check which REMAINING steps (based on type + position) are blocked
      const affectedOrders =
        unavailableSteps.length > 0
          ? nonBlockedActive
              .map((o) => {
                const remaining = getRemainingStepsForOrder(o);
                const blockedRemaining = remaining.filter((s) =>
                  unavailableSteps.includes(s),
                );
                if (blockedRemaining.length === 0) return null;
                return {
                  work_order_id: o.work_order_id,
                  customer: o.customer,
                  current_step: o.current_process_step || "–",
                  blocked_remaining_steps: blockedRemaining,
                };
              })
              .filter(Boolean) as AbsenceDayImpact["affectedOrders"]
          : [];

      return {
        dateLabel: day.toLocaleDateString("en-GB", {
          weekday: "short",
          day: "numeric",
          month: "short",
        }),
        date: day,
        absentEngineers,
        unavailableSteps,
        affectedOrders,
      } as AbsenceDayImpact;
    })
    .filter(Boolean) as AbsenceDayImpact[];

  const totalAffectedOrders = new Set(
    absenceDayImpacts.flatMap((d) =>
      d.affectedOrders.map((o) => o.work_order_id),
    ),
  ).size;
  const hasAbsences = absenceDayImpacts.length > 0;

  // -----------------------------------------------------------------------
  // Panel toggle
  // -----------------------------------------------------------------------

  function togglePanel(panel: DetailPanel) {
    setActivePanel((prev) => (prev === panel ? null : panel));
  }

  async function closeAction(order: WorkOrder) {
    const confirmed = window.confirm(
      `Close action for ${order.work_order_id}?\n\n` +
        `This will clear the hold reason and unblock the work order.\n` +
        `This action cannot be undone.`,
    );

    if (!confirmed) return;

    const payload = {
      action_status: "Done",
      action_closed: true,
      hold_reason: null,
      required_next_action: null,
      action_owner: null,
      last_manual_update: new Date().toISOString(),
    };

    const { error } = await updateWorkOrder(order.work_order_id, payload);

    if (error) {
      window.alert(`Error: ${error.message}`);
      return;
    }

    setOrders((prev) =>
      prev.map((o) =>
        o.work_order_id === order.work_order_id
          ? {
              ...o,
              ...payload,
            }
          : o,
      ),
    );
  }

  // -----------------------------------------------------------------------
  // Detail table renderers
  // -----------------------------------------------------------------------

  const woLinkStyle: React.CSSProperties = {
    color: "#2563eb",
    textDecoration: "none",
    fontWeight: 600,
  };

  function renderDueTable(list: WorkOrder[]) {
    const sorted = [...list].sort((a, b) =>
      (a.due_date || "").localeCompare(b.due_date || ""),
    );
    return (
      <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
        <thead>
          <tr>
            <th style={headerStyle}>WO</th>
            <th style={headerStyle}>Customer</th>
            <th style={headerStyle}>Type</th>
            <th style={headerStyle}>Due Date</th>
            <th style={headerStyle}>Prio</th>
            <th style={headerStyle}>Assigned</th>
            <th style={headerStyle}>Next Process Step</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((o) => (
            <tr
              key={o.work_order_id}
              style={{
                backgroundColor:
                  o.priority === "AOG"
                    ? "#fff0f0"
                    : o.priority === "Yes"
                      ? "#fff8e0"
                      : "white",
              }}
            >
              <td style={{ ...cellStyle, fontWeight: 600 }}>
                <Link href={`/office-update?wo=${o.work_order_id}`} style={woLinkStyle}>
                  {o.work_order_id}
                </Link>
              </td>
              <td style={cellStyle}>{o.customer || "–"}</td>
              <td style={cellStyle}>{o.work_order_type || "–"}</td>
              <td style={cellStyle}>{formatDate(o.due_date)}</td>
              <td style={cellStyle}>{o.priority || "No"}</td>
              <td style={cellStyle}>
                {normalizeAssignedPersonTeam(o.assigned_person_team)}
              </td>
              <td style={cellStyle}>
                <ProcessStepDisplay order={o} />
              </td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td
                colSpan={7}
                style={{ ...cellStyle, textAlign: "center", color: "#999" }}
              >
                No orders found
              </td>
            </tr>
          )}
        </tbody>
      </table>
    );
  }

  function renderActionsTable(list: WorkOrder[]) {
    return (
      <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
        <thead>
          <tr>
            <th style={headerStyle}>WO</th>
            <th style={headerStyle}>Customer</th>
            <th style={headerStyle}>Hold Reason</th>
            <th style={headerStyle}>Action Required</th>
            <th style={headerStyle}>Action Owner</th>
            <th style={headerStyle}>Action Status</th>
            <th style={headerStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {list.map((o) => {
            const isDone = o.action_status === "Done";

            return (
              <tr
                key={o.work_order_id}
                style={{ backgroundColor: o.hold_reason ? "#fff0f0" : "white" }}
              >
                <td style={{ ...cellStyle, fontWeight: 600 }}>
                  <Link href={`/office-update?wo=${o.work_order_id}`} style={woLinkStyle}>
                    {o.work_order_id}
                  </Link>
                </td>
                <td style={cellStyle}>{o.customer || "–"}</td>
                <td
                  style={{
                    ...cellStyle,
                    fontWeight: o.hold_reason ? "bold" : "normal",
                  }}
                >
                  {o.hold_reason || "–"}
                </td>
                <td style={cellStyle}>{o.required_next_action || "–"}</td>
                <td style={cellStyle}>{o.action_owner || "–"}</td>
                <td style={cellStyle}>
                  <span
                    style={{
                      padding: "3px 8px",
                      fontSize: "12px",
                      fontWeight: 600,
                      borderRadius: "4px",
                      backgroundColor: isDone ? "#dcfce7" : "#fef3c7",
                      color: isDone ? "#16a34a" : "#92400e",
                      display: "inline-block",
                    }}
                  >
                    {isDone ? "Closed" : "Open"}
                  </span>
                </td>
                <td style={cellStyle}>
                  {!isDone && (
                    <button
                      onClick={() => void closeAction(o)}
                      style={{
                        padding: "4px 10px",
                        fontSize: "12px",
                        fontWeight: 600,
                        border: "1px solid #dc2626",
                        borderRadius: "4px",
                        cursor: "pointer",
                        backgroundColor: "white",
                        color: "#dc2626",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Close action
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
          {list.length === 0 && (
            <tr>
              <td
                colSpan={7}
                style={{ ...cellStyle, textAlign: "center", color: "#999" }}
              >
                No open actions
              </td>
            </tr>
          )}
        </tbody>
      </table>
    );
  }

  function renderReadyTable(list: WorkOrder[]) {
    return (
      <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
        <thead>
          <tr>
            <th style={headerStyle}>WO</th>
            <th style={headerStyle}>Customer</th>
            <th style={headerStyle}>Type</th>
          </tr>
        </thead>
        <tbody>
          {list.map((o) => (
            <tr key={o.work_order_id} style={{ backgroundColor: "#f0fdf4" }}>
              <td style={{ ...cellStyle, fontWeight: 600 }}>
                <Link href={`/office-update?wo=${o.work_order_id}`} style={woLinkStyle}>
                  {o.work_order_id}
                </Link>
              </td>
              <td style={cellStyle}>{o.customer || "–"}</td>
              <td style={cellStyle}>{o.work_order_type || "–"}</td>
            </tr>
          ))}
          {list.length === 0 && (
            <tr>
              <td
                colSpan={3}
                style={{ ...cellStyle, textAlign: "center", color: "#999" }}
              >
                No orders ready to close
              </td>
            </tr>
          )}
        </tbody>
      </table>
    );
  }

  function renderStaleTable(list: WorkOrder[]) {
    return (
      <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
        <thead>
          <tr>
            <th style={headerStyle}>WO</th>
            <th style={headerStyle}>Customer</th>
            <th style={headerStyle}>Assigned</th>
            <th style={headerStyle}>Next Process Step</th>
            <th style={headerStyle}>Last Update</th>
          </tr>
        </thead>
        <tbody>
          {list.map((o) => {
            const last = latestUpdate(
              o.last_system_update,
              o.last_manual_update,
            );
            return (
              <tr
                key={o.work_order_id}
                style={{ backgroundColor: "#fffbeb" }}
              >
                <td style={{ ...cellStyle, fontWeight: 600 }}>
                  <Link href={`/office-update?wo=${o.work_order_id}`} style={woLinkStyle}>
                    {o.work_order_id}
                  </Link>
                </td>
                <td style={cellStyle}>{o.customer || "–"}</td>
                <td style={cellStyle}>
                  {normalizeAssignedPersonTeam(o.assigned_person_team)}
                </td>
                <td style={cellStyle}>{o.current_process_step || "–"}</td>
                <td style={cellStyle}>{formatDate(last)}</td>
              </tr>
            );
          })}
          {list.length === 0 && (
            <tr>
              <td
                colSpan={5}
                style={{ ...cellStyle, textAlign: "center", color: "#999" }}
              >
                All orders recently updated
              </td>
            </tr>
          )}
        </tbody>
      </table>
    );
  }

  // -----------------------------------------------------------------------
  // Panel config
  // -----------------------------------------------------------------------

  const panelConfig: Record<
    Exclude<DetailPanel, null>,
    {
      title: string;
      data: WorkOrder[];
      render: (list: WorkOrder[]) => React.ReactNode;
    }
  > = {
    due: {
      title: `Due this week (${dueThisWeek.length})`,
      data: dueThisWeek,
      render: renderDueTable,
    },
    overdue: {
      title: `Overdue (${overdueOrders.length})`,
      data: overdueOrders,
      render: renderDueTable,
    },
    actions: {
      title: `Open actions (${openActions.length})`,
      data: openActions,
      render: renderActionsTable,
    },
    ready: {
      title: `Ready to close in AcMP (${readyToClose.length})`,
      data: readyToClose,
      render: renderReadyTable,
    },
    aog: {
      title: `AOG / Priority (${aogOrders.length})`,
      data: aogOrders,
      render: renderDueTable,
    },
    stale: {
      title: `No update in 2+ weeks (${staleOrders.length})`,
      data: staleOrders,
      render: renderStaleTable,
    },
  };

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <main
      style={{
        padding: "1.5rem",
        fontFamily: "sans-serif",
        maxWidth: "1200px",
        margin: "0 auto",
      }}
    >
      <div style={{ maxWidth: "1280px", margin: "0 auto" }}>
      {/* Header */}
      <section
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <div
            style={{
              display: "none",
              fontSize: "11px",
              fontWeight: 800,
              letterSpacing: 0,
              color: "#68747b",
              textTransform: "uppercase",
              marginBottom: "6px",
            }}
          >
            AcMP Control Board
          </div>
          <h1 style={{ margin: 0, fontSize: "22px" }}>
            Office Dashboard
          </h1>
          <p style={{ display: "none" }}>
            <AnimatedNumber value={activeOrders.length} /> active work orders ·{" "}
            <AnimatedNumber value={engineers.length} /> shop engineers
          </p>
          <p style={{ margin: "4px 0 0", color: "#888", fontSize: "13px" }}>
            <AnimatedNumber value={activeOrders.length} /> active work orders |{" "}
            <AnimatedNumber value={engineers.length} /> shop engineers
          </p>
        </div>
        <div
          style={{
            display: "none",
            flexWrap: "wrap",
            gap: "8px",
            justifyContent: "flex-end",
          }}
        >
          <span
            style={{
              padding: "7px 10px",
              borderRadius: "999px",
              backgroundColor: `${capacityColor}14`,
              color: capacityColor,
              border: `1px solid ${capacityColor}33`,
              fontSize: "12px",
              fontWeight: 800,
            }}
          >
            Capacity <AnimatedNumber value={thisWeek?.percentage ?? 0} />%
          </span>
          <span
            style={{
              padding: "7px 10px",
              borderRadius: "999px",
              backgroundColor: "#fff7ed",
              color: "#9a3412",
              border: "1px solid #fed7aa",
              fontSize: "12px",
              fontWeight: 800,
            }}
          >
            <AnimatedNumber value={openActions.length} /> open actions
          </span>
          <span
            style={{
              padding: "7px 10px",
              borderRadius: "999px",
              backgroundColor: "#ecfdf5",
              color: "#047857",
              border: "1px solid #a7f3d0",
              fontSize: "12px",
              fontWeight: 800,
            }}
          >
            <AnimatedNumber value={readyToClose.length} /> ready to close
          </span>
        </div>
      </section>

      {/* Row 1: KPI Cards */}
      <section
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "12px",
          marginTop: "20px",
        }}
      >
        <KpiCard
          label="Due this week"
          value={dueThisWeek.length}
          color="#2563eb"
          bgColor="#eff6ff"
          active={activePanel === "due"}
          onClick={() => togglePanel("due")}
        />
        <KpiCard
          label="Overdue"
          value={overdueOrders.length}
          color="#dc2626"
          bgColor="#fef2f2"
          active={activePanel === "overdue"}
          onClick={() => togglePanel("overdue")}
        />
        <KpiCard
          label="Open actions"
          value={openActions.length}
          color="#ea580c"
          bgColor="#fff7ed"
          active={activePanel === "actions"}
          onClick={() => togglePanel("actions")}
        />
        <KpiCard
          label="Ready to close"
          value={readyToClose.length}
          color="#16a34a"
          bgColor="#f0fdf4"
          active={activePanel === "ready"}
          onClick={() => togglePanel("ready")}
        />
        <KpiCard
          label="AOG / Priority"
          value={aogOrders.length}
          color="#7c3aed"
          bgColor="#f5f3ff"
          active={activePanel === "aog"}
          onClick={() => togglePanel("aog")}
        />
        <KpiCard
          label="No update in 2+ weeks"
          value={staleOrders.length}
          color="#b45309"
          bgColor="#fffbeb"
          active={activePanel === "stale"}
          onClick={() => togglePanel("stale")}
        />
      </section>

      {/* Detail panel */}
      {activePanel && panelConfig[activePanel] && (
        <div
          style={{
            marginTop: "16px",
            padding: "16px",
            backgroundColor: "white",
            border: "1px solid #e5e7eb",
            borderRadius: "10px",
            boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "12px",
            }}
          >
            <h3 style={{ margin: 0, fontSize: "15px" }}>
              {panelConfig[activePanel].title}
            </h3>
            <button
              onClick={() => setActivePanel(null)}
              style={{
                background: "none",
                border: "none",
                fontSize: "18px",
                cursor: "pointer",
                color: "#999",
                padding: "2px 6px",
              }}
            >
              ✕
            </button>
          </div>
          <div style={{ overflowX: "auto" }}>
            {panelConfig[activePanel].render(panelConfig[activePanel].data)}
          </div>
        </div>
      )}

      {/* Row 2: Capacity & Absences */}
      <section style={{ marginTop: "24px" }}>
        <h2 style={{ fontSize: "16px", margin: "0 0 12px", color: "#333" }}>
          Capacity &amp; Absence Impact
        </h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "flex-start" }}>
          {/* Capacity this week */}
          <div
            style={{
              flex: "1 1 280px",
              padding: "16px 18px",
              backgroundColor:
                thisWeek?.status === "red"
                  ? "#fef2f2"
                  : thisWeek?.status === "orange"
                    ? "#fff7ed"
                    : "#f0fdf4",
              border: `1px solid ${capacityColor}33`,
              borderRadius: "10px",
              borderLeft: `4px solid ${capacityColor}`,
            }}
          >
            <div
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "#333",
                marginBottom: "8px",
              }}
            >
              Week Capacity
            </div>
            <div
              style={{
                display: "flex",
                gap: "16px",
                fontSize: "12px",
                color: "#555",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: "20px",
                    fontWeight: 700,
                    color: capacityColor,
                  }}
                >
                  <AnimatedNumber value={thisWeek?.percentage ?? 0} />%
                </div>
                <div>utilization</div>
              </div>
              <div>
                <div style={{ fontSize: "20px", fontWeight: 700, color: "#333" }}>
                  <AnimatedNumber value={thisWeek?.requiredHours ?? 0} decimals={1} />
                  <span
                    style={{ fontSize: "13px", fontWeight: 400, color: "#999" }}
                  >
                    /<AnimatedNumber value={thisWeek?.availableHours ?? 0} decimals={1} />
                  </span>
                </div>
                <div>hours</div>
              </div>
            </div>
            <div
              style={{
                marginTop: "8px",
                height: "6px",
                backgroundColor: `${capacityColor}22`,
                borderRadius: "3px",
                overflow: "hidden",
              }}
            >
              <AnimatedProgressBar
                value={thisWeek?.percentage ?? 0}
                color={capacityColor}
              />
            </div>
          </div>

          {/* Absence impact */}
          <div
            style={{
              flex: "2 1 400px",
              padding: "16px 18px",
              backgroundColor: hasAbsences
                ? totalAffectedOrders > 0
                  ? "#fef2f2"
                  : "#fffbeb"
                : "#f9fafb",
              border: `1px solid ${hasAbsences ? (totalAffectedOrders > 0 ? "#dc262633" : "#b4530933") : "#e5e7eb"}`,
              borderRadius: "10px",
              borderLeft: `4px solid ${hasAbsences ? (totalAffectedOrders > 0 ? "#dc2626" : "#b45309") : "#6b7280"}`,
            }}
          >
            <div
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "#333",
                marginBottom: "10px",
              }}
            >
              Absences This Week
              {totalAffectedOrders > 0 && (
                <span
                  style={{
                    marginLeft: "8px",
                    fontSize: "11px",
                    color: "#dc2626",
                    fontWeight: 600,
                  }}
                >
                  — <AnimatedNumber value={totalAffectedOrders} />{" "}
                  {totalAffectedOrders === 1 ? "order" : "orders"} affected
                </span>
              )}
            </div>

            {!hasAbsences && (
              <div style={{ fontSize: "13px", color: "#999" }}>
                No absences scheduled this week
              </div>
            )}

            {hasAbsences && (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {absenceDayImpacts.map((day) => {
                  const isExpanded = expandedDays.has(day.dateLabel);
                  const hasImpact = day.affectedOrders.length > 0;

                  return (
                    <div
                      key={day.dateLabel}
                      style={{
                        padding: "10px 12px",
                        backgroundColor: hasImpact ? "#fff0f0" : "white",
                        borderRadius: "6px",
                        border: hasImpact
                          ? "1px solid #fecaca"
                          : "1px solid #e5e7eb",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "12px",
                          fontWeight: 600,
                          color: "#333",
                          marginBottom: "4px",
                        }}
                      >
                        {day.dateLabel}
                      </div>
                      <div style={{ fontSize: "12px", color: "#666" }}>
                        Absent:{" "}
                        {day.absentEngineers.map((e) => e.name).join(", ")}
                      </div>

                      {day.unavailableSteps.length > 0 && (
                        <div
                          style={{
                            marginTop: "6px",
                            fontSize: "12px",
                            color: "#dc2626",
                            fontWeight: 500,
                          }}
                        >
                          ⚠ No qualified engineers available for:{" "}
                          {day.unavailableSteps.join(", ")}
                        </div>
                      )}

                      {hasImpact && (
                        <button
                          onClick={() => {
                            setExpandedDays((prev) => {
                              const next = new Set(prev);
                              if (next.has(day.dateLabel)) {
                                next.delete(day.dateLabel);
                              } else {
                                next.add(day.dateLabel);
                              }
                              return next;
                            });
                          }}
                          style={{
                            marginTop: "8px",
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            fontSize: "12px",
                            color: "#dc2626",
                            fontWeight: 500,
                            padding: 0,
                          }}
                        >
                          {isExpanded ? "▾" : "▸"}{" "}
                          <AnimatedNumber value={day.affectedOrders.length} />{" "}
                          {day.affectedOrders.length === 1 ? "order" : "orders"}{" "}
                          at risk
                        </button>
                      )}

                      {hasImpact && isExpanded && (
                        <div style={{ marginTop: "8px" }}>
                          {day.affectedOrders.map((o) => (
                            <div
                              key={o.work_order_id}
                              style={{
                                fontSize: "12px",
                                color: "#333",
                                padding: "4px 0",
                                borderTop: "1px solid #f3f3f3",
                              }}
                            >
                              <strong>{o.work_order_id}</strong>
                              {o.customer ? ` — ${o.customer}` : ""}
                              <span style={{ color: "#999" }}>
                                {" "}
                                · now at {o.current_step}
                              </span>
                              <div
                                style={{
                                  fontSize: "11px",
                                  color: "#dc2626",
                                  marginTop: "2px",
                                }}
                              >
                                Can&apos;t do:{" "}
                                {o.blocked_remaining_steps.join(", ")}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {day.unavailableSteps.length === 0 && (
                        <div
                          style={{
                            marginTop: "4px",
                            fontSize: "11px",
                            color: "#16a34a",
                          }}
                        >
                          ✓ No impact on current orders
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>
      </div>
    </main>
  );
}

