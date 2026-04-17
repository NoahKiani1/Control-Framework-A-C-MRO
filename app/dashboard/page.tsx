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
import {
  getProcessStepsForType,
  READY_TO_CLOSE_STEP,
} from "@/lib/process-steps";

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

type CardProps = {
  label: string;
  value: number;
  color: string;
  active: boolean;
  onClick?: () => void;
};

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

type DetailPanel =
  | "due"
  | "overdue"
  | "actions"
  | "ready"
  | "aog"
  | "stale"
  | null;

type HealthStatus = {
  label: string;
  color: string;
  bg: string;
  reason: string;
  panel: DetailPanel;
};

// Refined palette — modern, clean, professional
const COLORS = {
  // Surfaces
  pageBg: "#f8fafc",
  surface: "#ffffff",
  surfaceSubtle: "#f9fafb",

  // Borders
  border: "#e5e7eb",
  borderStrong: "#d1d5db",

  // Text
  heading: "#0f172a",
  text: "#1e293b",
  textSoft: "#475569",
  textMuted: "#94a3b8",

  // Accents
  blue: "#2563eb",
  blueSoft: "#eff6ff",
  red: "#dc2626",
  redSoft: "#fef2f2",
  amber: "#d97706",
  amberSoft: "#fffbeb",
  green: "#059669",
  greenSoft: "#ecfdf5",
  purple: "#7c3aed",
  purpleSoft: "#f5f3ff",
  gold: "#b45309",
  goldSoft: "#fef3c7",
};

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

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
        borderRadius: "999px",
        transition: "background-color 0.2s ease",
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
          gap: "6px",
          color: COLORS.red,
          fontWeight: 600,
          cursor: "help",
        }}
      >
        <span aria-hidden="true">▲</span>
        <span>Blocked</span>
        <span className="blocked-step-tooltip-text">{blockedReason(order)}</span>
      </span>
    );
  }

  return <>{order.current_process_step || "–"}</>;
}

function KpiCard({ label, value, color, active, onClick }: CardProps) {
  return (
    <button
      onClick={onClick}
      style={{
        position: "relative",
        width: "100%",
        padding: "20px 22px",
        backgroundColor: active ? color : COLORS.surface,
        border: `1px solid ${active ? color : COLORS.border}`,
        borderRadius: "12px",
        cursor: onClick ? "pointer" : "default",
        textAlign: "left",
        transition: "transform 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease",
        boxShadow: active
          ? `0 10px 24px -8px ${color}66`
          : "0 1px 2px rgba(15, 23, 42, 0.04)",
        overflow: "hidden",
        fontFamily: FONT_STACK,
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.transform = "translateY(-1px)";
          e.currentTarget.style.boxShadow = "0 4px 12px rgba(15, 23, 42, 0.06)";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.transform = "translateY(0)";
          e.currentTarget.style.boxShadow = "0 1px 2px rgba(15, 23, 42, 0.04)";
        }
      }}
    >
      {/* Left accent stripe */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "3px",
          height: "100%",
          backgroundColor: active ? "rgba(255,255,255,0.4)" : color,
        }}
      />

      <div
        style={{
          fontSize: "32px",
          fontWeight: 700,
          color: active ? "white" : color,
          lineHeight: 1,
          letterSpacing: "-0.03em",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <AnimatedNumber value={value} />
      </div>

      <div
        style={{
          fontSize: "13px",
          color: active ? "rgba(255,255,255,0.95)" : COLORS.textSoft,
          marginTop: "10px",
          fontWeight: 500,
        }}
      >
        {label}
      </div>
    </button>
  );
}

function StatTile({
  label,
  children,
  tone = "default",
}: {
  label: string;
  children: React.ReactNode;
  tone?: "default" | "success" | "warn" | "danger";
}) {
  const toneStyles: Record<string, { color: string; bg: string; border: string }> = {
    default: { color: COLORS.heading, bg: COLORS.surface, border: COLORS.border },
    success: { color: COLORS.green, bg: COLORS.surface, border: COLORS.border },
    warn: { color: COLORS.amber, bg: COLORS.surface, border: COLORS.border },
    danger: { color: COLORS.red, bg: COLORS.surface, border: COLORS.border },
  };
  const t = toneStyles[tone];

  return (
    <div
      style={{
        padding: "18px 20px",
        backgroundColor: t.bg,
        border: `1px solid ${t.border}`,
        borderRadius: "12px",
        boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
      }}
    >
      <div
        style={{
          fontSize: "11px",
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: COLORS.textMuted,
          marginBottom: "10px",
        }}
      >
        {label}
      </div>
      <div style={{ color: t.color }}>{children}</div>
    </div>
  );
}

export default function DashboardPage() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [engineers, setEngineers] = useState<Engineer[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [loading, setLoading] = useState(true);
  const [activePanel, setActivePanel] = useState<DetailPanel>("due");
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

    void load();
  }, []);

  if (loading) {
    return (
      <main
        style={{
          minHeight: "100vh",
          backgroundColor: COLORS.pageBg,
          padding: "32px",
          color: COLORS.textSoft,
          fontFamily: FONT_STACK,
        }}
      >
        Loading...
      </main>
    );
  }

  const activeOrders = orders.filter(
    (o) => o.current_process_step !== READY_TO_CLOSE_STEP,
  );
  const readyToClose = orders.filter(
    (o) => o.current_process_step === READY_TO_CLOSE_STEP,
  );

  const dueThisWeek = activeOrders.filter((o) => isDueThisWeek(o.due_date));
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
      ? COLORS.red
      : thisWeek?.status === "orange"
        ? COLORS.amber
        : COLORS.green;
  const capacityBgTint =
    thisWeek?.status === "red"
      ? COLORS.redSoft
      : thisWeek?.status === "orange"
        ? COLORS.amberSoft
        : COLORS.greenSoft;

  const engineerMap = new Map(engineers.map((e) => [e.id, e]));

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

  function getRemainingStepsForOrder(order: WorkOrder): string[] {
    if (!order.work_order_type || !order.current_process_step) return [];
    const steps = getProcessStepsForType(order.work_order_type);
    const currentIdx = steps.indexOf(order.current_process_step);
    if (currentIdx === -1) return [];
    return steps.slice(currentIdx);
  }

  const allRestrictedSteps = Object.entries(RESTRICTION_BLOCKED_STEPS);
  const nonBlockedActive = activeOrders.filter((o) => !isBlocked(o));

  const absenceDayImpacts: AbsenceDayImpact[] = remainingWorkDays
    .map((day) => {
      const dayStr = day.toISOString().split("T")[0];

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

      const affectedOrders =
        unavailableSteps.length > 0
          ? (nonBlockedActive
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
              .filter(Boolean) as AbsenceDayImpact["affectedOrders"])
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

  function togglePanel(panel: DetailPanel) {
    setActivePanel((prev) => (prev === panel ? null : panel));
  }

  function getHealthStatus(): HealthStatus {
    if (overdueOrders.length > 0)
      return {
        label: "Attention needed",
        color: COLORS.red,
        bg: COLORS.redSoft,
        reason: `${overdueOrders.length} overdue work ${
          overdueOrders.length === 1 ? "order needs" : "orders need"
        } attention.`,
        panel: "overdue",
      };
    if (openActions.length > 0)
      return {
        label: "Blockers active",
        color: COLORS.amber,
        bg: COLORS.amberSoft,
        reason: `${openActions.length} open action ${
          openActions.length === 1 ? "is" : "are"
        } blocking flow.`,
        panel: "actions",
      };
    if ((thisWeek?.percentage ?? 0) >= 85)
      return {
        label: "High load",
        color: COLORS.amber,
        bg: COLORS.amberSoft,
        reason: `This week is at ${Math.round(
          thisWeek?.percentage ?? 0,
        )}% of available capacity.`,
        panel: null,
      };
    return {
      label: "Flow stable",
      color: COLORS.green,
      bg: COLORS.greenSoft,
      reason: "No overdue orders, blockers, or capacity warnings right now.",
      panel: null,
    };
  }

  const health = getHealthStatus();

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

  const headerStyle: React.CSSProperties = {
    padding: "12px 14px",
    textAlign: "left",
    fontSize: "11px",
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: COLORS.textMuted,
    borderBottom: `1px solid ${COLORS.border}`,
    backgroundColor: COLORS.surfaceSubtle,
    whiteSpace: "nowrap",
  };

  const cellStyle: React.CSSProperties = {
    padding: "12px 14px",
    fontSize: "13px",
    color: COLORS.text,
    borderBottom: `1px solid ${COLORS.border}`,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };

  const woLinkStyle: React.CSSProperties = {
    color: COLORS.blue,
    textDecoration: "none",
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
  };

  const sectionCard: React.CSSProperties = {
    backgroundColor: COLORS.surface,
    border: `1px solid ${COLORS.border}`,
    borderRadius: "14px",
    padding: "20px",
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
  };

  const tableWrapperStyle: React.CSSProperties = {
    border: `1px solid ${COLORS.border}`,
    borderRadius: "10px",
    overflow: "hidden",
    overflowX: "auto",
    backgroundColor: COLORS.surface,
  };

  function renderDueTable(list: WorkOrder[]) {
    const sorted = [...list].sort((a, b) =>
      (a.due_date || "").localeCompare(b.due_date || ""),
    );

    return (
      <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "auto" }}>
        <thead>
          <tr>
            <th style={headerStyle}>WO</th>
            <th style={headerStyle}>Customer</th>
            <th style={headerStyle}>Type</th>
            <th style={headerStyle}>Due Date</th>
            <th style={headerStyle}>Prio</th>
            <th style={headerStyle}>Assigned</th>
            <th style={headerStyle}>Next Step</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((o, idx) => (
            <tr
              key={o.work_order_id}
              style={{
                backgroundColor:
                  o.priority === "AOG"
                    ? COLORS.redSoft
                    : o.priority === "Yes"
                      ? COLORS.amberSoft
                      : idx % 2 === 0
                        ? COLORS.surface
                        : COLORS.surfaceSubtle,
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
              <td style={cellStyle}>
                {o.priority && o.priority !== "No" ? (
                  <span
                    style={{
                      padding: "3px 8px",
                      fontSize: "11px",
                      fontWeight: 700,
                      borderRadius: "999px",
                      backgroundColor:
                        o.priority === "AOG" ? COLORS.red : COLORS.amber,
                      color: "white",
                      letterSpacing: "0.03em",
                    }}
                  >
                    {o.priority}
                  </span>
                ) : (
                  <span style={{ color: COLORS.textMuted }}>–</span>
                )}
              </td>
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
                style={{ ...cellStyle, textAlign: "center", color: COLORS.textMuted, padding: "32px" }}
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
      <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "auto" }}>
        <thead>
          <tr>
            <th style={headerStyle}>WO</th>
            <th style={headerStyle}>Customer</th>
            <th style={headerStyle}>Hold Reason</th>
            <th style={headerStyle}>Action Required</th>
            <th style={headerStyle}>Owner</th>
            <th style={headerStyle}>Status</th>
            <th style={headerStyle}></th>
          </tr>
        </thead>
        <tbody>
          {list.map((o, idx) => {
            const isDone = o.action_status === "Done";

            return (
              <tr
                key={o.work_order_id}
                style={{
                  backgroundColor: o.hold_reason
                    ? COLORS.amberSoft
                    : idx % 2 === 0
                      ? COLORS.surface
                      : COLORS.surfaceSubtle,
                }}
              >
                <td style={{ ...cellStyle, fontWeight: 600 }}>
                  <Link href={`/office-update?wo=${o.work_order_id}`} style={woLinkStyle}>
                    {o.work_order_id}
                  </Link>
                </td>
                <td style={cellStyle}>{o.customer || "–"}</td>
                <td style={{ ...cellStyle, fontWeight: o.hold_reason ? 600 : 400 }}>
                  {o.hold_reason || "–"}
                </td>
                <td style={cellStyle}>{o.required_next_action || "–"}</td>
                <td style={cellStyle}>{o.action_owner || "–"}</td>
                <td style={cellStyle}>
                  <span
                    style={{
                      padding: "3px 10px",
                      fontSize: "11px",
                      fontWeight: 700,
                      borderRadius: "999px",
                      backgroundColor: isDone ? COLORS.greenSoft : COLORS.amberSoft,
                      color: isDone ? COLORS.green : COLORS.amber,
                      display: "inline-block",
                      border: `1px solid ${isDone ? COLORS.green : COLORS.amber}22`,
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
                        padding: "6px 12px",
                        fontSize: "12px",
                        fontWeight: 600,
                        border: `1px solid ${COLORS.border}`,
                        borderRadius: "8px",
                        cursor: "pointer",
                        backgroundColor: COLORS.surface,
                        color: COLORS.red,
                        whiteSpace: "nowrap",
                        transition: "all 0.15s ease",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = COLORS.redSoft;
                        e.currentTarget.style.borderColor = COLORS.red;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = COLORS.surface;
                        e.currentTarget.style.borderColor = COLORS.border;
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
                style={{ ...cellStyle, textAlign: "center", color: COLORS.textMuted, padding: "32px" }}
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
      <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "auto" }}>
        <thead>
          <tr>
            <th style={headerStyle}>WO</th>
            <th style={headerStyle}>Customer</th>
            <th style={headerStyle}>Type</th>
          </tr>
        </thead>
        <tbody>
          {list.map((o, idx) => (
            <tr
              key={o.work_order_id}
              style={{
                backgroundColor: idx % 2 === 0 ? COLORS.surface : COLORS.surfaceSubtle,
              }}
            >
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
                style={{ ...cellStyle, textAlign: "center", color: COLORS.textMuted, padding: "32px" }}
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
      <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "auto" }}>
        <thead>
          <tr>
            <th style={headerStyle}>WO</th>
            <th style={headerStyle}>Customer</th>
            <th style={headerStyle}>Assigned</th>
            <th style={headerStyle}>Next Step</th>
            <th style={headerStyle}>Last Update</th>
          </tr>
        </thead>
        <tbody>
          {list.map((o, idx) => {
            const last = latestUpdate(o.last_system_update, o.last_manual_update);
            return (
              <tr
                key={o.work_order_id}
                style={{
                  backgroundColor: idx % 2 === 0 ? COLORS.surface : COLORS.surfaceSubtle,
                }}
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
                style={{ ...cellStyle, textAlign: "center", color: COLORS.textMuted, padding: "32px" }}
              >
                All orders recently updated
              </td>
            </tr>
          )}
        </tbody>
      </table>
    );
  }

  const panelConfig: Record<
    Exclude<DetailPanel, null>,
    {
      title: string;
      count: number;
      accent: string;
      render: (list: WorkOrder[]) => React.ReactNode;
      data: WorkOrder[];
    }
  > = {
    due: {
      title: "Due this week",
      count: dueThisWeek.length,
      accent: COLORS.blue,
      data: dueThisWeek,
      render: renderDueTable,
    },
    overdue: {
      title: "Overdue",
      count: overdueOrders.length,
      accent: COLORS.red,
      data: overdueOrders,
      render: renderDueTable,
    },
    actions: {
      title: "Open actions",
      count: openActions.length,
      accent: COLORS.amber,
      data: openActions,
      render: renderActionsTable,
    },
    ready: {
      title: "Ready to close in AcMP",
      count: readyToClose.length,
      accent: COLORS.green,
      data: readyToClose,
      render: renderReadyTable,
    },
    aog: {
      title: "AOG / Priority",
      count: aogOrders.length,
      accent: COLORS.purple,
      data: aogOrders,
      render: renderDueTable,
    },
    stale: {
      title: "No update in 2+ weeks",
      count: staleOrders.length,
      accent: COLORS.gold,
      data: staleOrders,
      render: renderStaleTable,
    },
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        backgroundColor: COLORS.pageBg,
        padding: "28px 32px 48px",
        fontFamily: FONT_STACK,
        color: COLORS.text,
      }}
    >
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        {/* HEADER */}
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "20px",
            marginBottom: "24px",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "11px",
                fontWeight: 600,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: COLORS.textMuted,
                marginBottom: "8px",
              }}
            >
              Aircraft & Component MRO&apos;s Wheels & Brake Shop
            </div>

            <h1
              style={{
                margin: 0,
                fontSize: "32px",
                lineHeight: 1.1,
                fontWeight: 700,
                color: COLORS.heading,
                letterSpacing: "-0.025em",
              }}
            >
              Planning & Monitoring Tool
            </h1>

            <p
              style={{
                margin: "8px 0 0",
                fontSize: "14px",
                color: COLORS.textSoft,
                lineHeight: 1.5,
              }}
            >
              Live control of work order flow, blockers, readiness, and capacity.
            </p>
          </div>

          <button
            type="button"
            aria-label={`${health.label}: ${health.reason}`}
            onClick={() => {
              if (health.panel) {
                setActivePanel(health.panel);
              }
            }}
            style={{
              position: "relative",
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 14px",
              borderRadius: "8px",
              backgroundColor: health.bg,
              color: health.color,
              border: `1px solid ${health.color}33`,
              fontSize: "13px",
              fontWeight: 600,
              whiteSpace: "nowrap",
              flexShrink: 0,
              cursor: health.panel ? "pointer" : "help",
              fontFamily: FONT_STACK,
            }}
            className="health-status"
          >
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: health.color,
                display: "inline-block",
              }}
            />
            {health.label}
            <span className="health-status-tooltip">
              {health.reason}
              {health.panel ? " Click to view the affected work orders." : ""}
            </span>
          </button>
        </header>

        {/* TOP STATS STRIP — capacity (prominent), active, engineers */}
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr",
            gap: "14px",
            marginBottom: "20px",
          }}
        >
          {/* Capacity — single source of truth */}
          <div
            style={{
              padding: "20px 22px",
              backgroundColor: COLORS.surface,
              border: `1px solid ${COLORS.border}`,
              borderLeft: `3px solid ${capacityColor}`,
              borderRadius: "12px",
              boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: "16px",
                marginBottom: "14px",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: COLORS.textMuted,
                    marginBottom: "8px",
                  }}
                >
                  Week Capacity
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: "10px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "34px",
                      fontWeight: 700,
                      color: capacityColor,
                      letterSpacing: "-0.03em",
                      lineHeight: 1,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    <AnimatedNumber value={thisWeek?.percentage ?? 0} />%
                  </div>
                  <div
                    style={{
                      fontSize: "13px",
                      color: COLORS.textSoft,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    <AnimatedNumber value={thisWeek?.requiredHours ?? 0} decimals={1} />
                    {" / "}
                    <AnimatedNumber value={thisWeek?.availableHours ?? 0} decimals={1} />
                    {" hrs"}
                  </div>
                </div>
              </div>

              <div
                style={{
                  padding: "4px 10px",
                  borderRadius: "999px",
                  backgroundColor: capacityBgTint,
                  color: capacityColor,
                  fontSize: "11px",
                  fontWeight: 700,
                  letterSpacing: "0.03em",
                  border: `1px solid ${capacityColor}22`,
                  whiteSpace: "nowrap",
                }}
              >
                {thisWeek?.status === "red"
                  ? "HIGH LOAD"
                  : thisWeek?.status === "orange"
                    ? "WATCH"
                  : "ENOUGH CAPACITY"}
              </div>
            </div>

            <div
              style={{
                height: "6px",
                backgroundColor: `${capacityColor}15`,
                borderRadius: "999px",
                overflow: "hidden",
              }}
            >
              <AnimatedProgressBar
                value={thisWeek?.percentage ?? 0}
                color={capacityColor}
              />
            </div>
          </div>

          <StatTile label="Active Work Orders">
            <div
              style={{
                fontSize: "30px",
                fontWeight: 700,
                letterSpacing: "-0.03em",
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <AnimatedNumber value={activeOrders.length} />
            </div>
          </StatTile>

          <StatTile label="Shop Engineers">
            <div
              style={{
                fontSize: "30px",
                fontWeight: 700,
                letterSpacing: "-0.03em",
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
                color: COLORS.blue,
              }}
            >
              <AnimatedNumber value={engineers.length} />
            </div>
          </StatTile>
        </section>

        {/* KPI GRID — 6 clickable cards */}
        <section style={{ marginBottom: "20px" }}>
          <div
            style={{
              fontSize: "11px",
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: COLORS.textMuted,
              marginBottom: "10px",
              paddingLeft: "4px",
            }}
          >
            Overview
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: "12px",
            }}
          >
            <KpiCard
              label="Due this week"
              value={dueThisWeek.length}
              color={COLORS.blue}
              active={activePanel === "due"}
              onClick={() => togglePanel("due")}
            />
            <KpiCard
              label="Overdue"
              value={overdueOrders.length}
              color={COLORS.red}
              active={activePanel === "overdue"}
              onClick={() => togglePanel("overdue")}
            />
            <KpiCard
              label="Open actions"
              value={openActions.length}
              color={COLORS.amber}
              active={activePanel === "actions"}
              onClick={() => togglePanel("actions")}
            />
            <KpiCard
              label="Ready to close"
              value={readyToClose.length}
              color={COLORS.green}
              active={activePanel === "ready"}
              onClick={() => togglePanel("ready")}
            />
            <KpiCard
              label="AOG / Priority"
              value={aogOrders.length}
              color={COLORS.purple}
              active={activePanel === "aog"}
              onClick={() => togglePanel("aog")}
            />
            <KpiCard
              label="No update in 2+ weeks"
              value={staleOrders.length}
              color={COLORS.gold}
              active={activePanel === "stale"}
              onClick={() => togglePanel("stale")}
            />
          </div>
        </section>

        {/* MAIN AREA — detail view + absences */}
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 2.2fr) minmax(280px, 1fr)",
            gap: "16px",
            alignItems: "start",
          }}
        >
          {/* LEFT: Detail panel */}
          <div style={sectionCard}>
            {activePanel && panelConfig[activePanel] && (
              <>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "16px",
                    paddingBottom: "4px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                    }}
                  >
                    <div
                      style={{
                        width: "3px",
                        height: "22px",
                        backgroundColor: panelConfig[activePanel].accent,
                        borderRadius: "2px",
                      }}
                    />
                    <h3
                      style={{
                        margin: 0,
                        fontSize: "18px",
                        fontWeight: 700,
                        color: COLORS.heading,
                        letterSpacing: "-0.01em",
                      }}
                    >
                      {panelConfig[activePanel].title}
                    </h3>
                    <span
                      style={{
                        padding: "2px 10px",
                        fontSize: "12px",
                        fontWeight: 700,
                        borderRadius: "999px",
                        backgroundColor: `${panelConfig[activePanel].accent}15`,
                        color: panelConfig[activePanel].accent,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      <AnimatedNumber value={panelConfig[activePanel].count} />
                    </span>
                  </div>

                  <button
                    onClick={() => setActivePanel(null)}
                    style={{
                      backgroundColor: COLORS.surface,
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: "8px",
                      fontSize: "13px",
                      cursor: "pointer",
                      color: COLORS.textSoft,
                      padding: "6px 12px",
                      fontWeight: 500,
                      transition: "all 0.15s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = COLORS.surfaceSubtle;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = COLORS.surface;
                    }}
                  >
                    Hide
                  </button>
                </div>

                <div style={tableWrapperStyle}>
                  {panelConfig[activePanel].render(panelConfig[activePanel].data)}
                </div>
              </>
            )}

            {!activePanel && (
              <div
                style={{
                  padding: "48px 24px",
                  textAlign: "center",
                  color: COLORS.textMuted,
                  fontSize: "14px",
                }}
              >
                <div
                  style={{
                    fontSize: "16px",
                    fontWeight: 600,
                    color: COLORS.textSoft,
                    marginBottom: "6px",
                  }}
                >
                  Select a card above
                </div>
                <div>Click any KPI to see the underlying work orders.</div>
              </div>
            )}
          </div>

          {/* RIGHT: Absences */}
          <div style={sectionCard}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: "12px",
                marginBottom: "14px",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: COLORS.textMuted,
                    marginBottom: "6px",
                  }}
                >
                  Staff Availability
                </div>
                <h3
                  style={{
                    margin: 0,
                    fontSize: "18px",
                    fontWeight: 700,
                    color: COLORS.heading,
                    letterSpacing: "-0.01em",
                  }}
                >
                  Absences this week
                </h3>
              </div>

              {totalAffectedOrders > 0 && (
                <div
                  style={{
                    padding: "4px 10px",
                    borderRadius: "999px",
                    backgroundColor: COLORS.redSoft,
                    color: COLORS.red,
                    fontSize: "11px",
                    fontWeight: 700,
                    border: `1px solid ${COLORS.red}22`,
                    whiteSpace: "nowrap",
                  }}
                >
                  <AnimatedNumber value={totalAffectedOrders} /> at risk
                </div>
              )}
            </div>

            {!hasAbsences && (
              <div
                style={{
                  padding: "24px 16px",
                  textAlign: "center",
                  color: COLORS.textMuted,
                  fontSize: "13px",
                  backgroundColor: COLORS.surfaceSubtle,
                  borderRadius: "10px",
                  border: `1px dashed ${COLORS.border}`,
                }}
              >
                No absences scheduled.
              </div>
            )}

            {hasAbsences && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {absenceDayImpacts.map((day) => {
                  const isExpanded = expandedDays.has(day.dateLabel);
                  const hasImpact = day.affectedOrders.length > 0;

                  return (
                    <div
                      key={day.dateLabel}
                      style={{
                        padding: "12px 14px",
                        backgroundColor: hasImpact ? COLORS.redSoft : COLORS.surfaceSubtle,
                        borderRadius: "10px",
                        border: hasImpact
                          ? `1px solid ${COLORS.red}22`
                          : `1px solid ${COLORS.border}`,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: "4px",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "13px",
                            fontWeight: 700,
                            color: COLORS.heading,
                          }}
                        >
                          {day.dateLabel}
                        </div>
                        {hasImpact && (
                          <span
                            style={{
                              fontSize: "10px",
                              fontWeight: 700,
                              color: COLORS.red,
                              letterSpacing: "0.03em",
                            }}
                          >
                            IMPACT
                          </span>
                        )}
                      </div>

                      <div style={{ fontSize: "12px", color: COLORS.textSoft }}>
                        Absent: {day.absentEngineers.map((e) => e.name).join(", ")}
                      </div>

                      {day.unavailableSteps.length > 0 && (
                        <div
                          style={{
                            marginTop: "8px",
                            fontSize: "12px",
                            color: COLORS.red,
                            fontWeight: 600,
                          }}
                        >
                          No qualified engineer for: {day.unavailableSteps.join(", ")}
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
                            color: COLORS.red,
                            fontWeight: 600,
                            padding: 0,
                            display: "flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                        >
                          <span style={{ fontSize: "10px" }}>{isExpanded ? "▾" : "▸"}</span>
                          <AnimatedNumber value={day.affectedOrders.length} />{" "}
                          {day.affectedOrders.length === 1 ? "order" : "orders"} at risk
                        </button>
                      )}

                      {hasImpact && isExpanded && (
                        <div style={{ marginTop: "10px" }}>
                          {day.affectedOrders.map((o) => (
                            <div
                              key={o.work_order_id}
                              style={{
                                fontSize: "12px",
                                color: COLORS.text,
                                padding: "8px 0",
                                borderTop: `1px solid ${COLORS.red}22`,
                              }}
                            >
                              <div style={{ fontWeight: 600 }}>
                                {o.work_order_id}
                                {o.customer ? (
                                  <span style={{ fontWeight: 400, color: COLORS.textSoft }}>
                                    {" "} — {o.customer}
                                  </span>
                                ) : null}
                              </div>
                              <div
                                style={{
                                  fontSize: "11px",
                                  color: COLORS.textMuted,
                                  marginTop: "2px",
                                }}
                              >
                                Now at: {o.current_step}
                              </div>
                              <div
                                style={{
                                  fontSize: "11px",
                                  color: COLORS.red,
                                  marginTop: "3px",
                                  fontWeight: 600,
                                }}
                              >
                                Can&apos;t do: {o.blocked_remaining_steps.join(", ")}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {day.unavailableSteps.length === 0 && (
                        <div
                          style={{
                            marginTop: "6px",
                            fontSize: "12px",
                            color: COLORS.green,
                            fontWeight: 600,
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
        </section>
      </div>
    </main>
  );
}
