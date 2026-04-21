"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  deletePastEngineerAbsences,
  getEngineerAbsences,
  getEngineers,
} from "@/lib/engineers";
import { getWorkOrders } from "@/lib/work-orders";
import { calculateWeekCapacity, type WeekCapacity, type OrderCapacity } from "@/lib/capacity";
import { isRfqBlockedState } from "@/lib/work-order-rules";
import { RESTRICTION_LABELS, RESTRICTION_BLOCKED_STEPS } from "@/lib/restrictions";
import { PROCESS_STEPS, READY_TO_CLOSE_STEP } from "@/lib/process-steps";

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
  reason: string | null;
  absence_group_id: string | null;
};

type WorkOrder = {
  work_order_id: string;
  customer: string | null;
  work_order_type: string | null;
  part_number: string | null;
  current_process_step: string | null;
  due_date: string | null;
  hold_reason: string | null;
  rfq_state: string | null;
};

type GroupedAbsence = {
  key: string;
  engineer_id: number;
  reason: string | null;
  start_date: string;
  end_date: string;
  days: number;
  ids: number[];
  group_id: string | null;
};

type ExcludedOrder = WorkOrder & {
  reason: string;
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

function ChevronIcon() {
  return (
    <svg
      aria-hidden="true"
      className="capacity-chevron"
      width="14"
      height="14"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      style={{
        color: "#8b94a3",
        flexShrink: 0,
        transition: "transform 180ms ease, color 180ms ease",
      }}
    >
      <path d="M5 7.5 10 12.5 15 7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      style={{ flexShrink: 0 }}
    >
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 13.5V9.25" strokeLinecap="round" />
      <circle cx="10" cy="6.75" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default function CapacityPage() {
  const [engineers, setEngineers] = useState<Engineer[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [allOrders, setAllOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const [weeks, setWeeks] = useState<WeekCapacity[]>([]);
  const [orderDetails, setOrderDetails] = useState<OrderCapacity[]>([]);
  const [overdueOrders, setOverdueOrders] = useState<OrderCapacity[]>([]);
  const [showInfoBanner, setShowInfoBanner] = useState(false);
  const infoPopoverRef = useRef<HTMLDivElement | null>(null);

  function formatLocalDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  const loadData = useEffectEvent(async () => {
    const today = formatLocalDateKey(new Date());
    await deletePastEngineerAbsences(today);

    const engData = await getEngineers<Engineer>({
      select: "*",
      isActive: true,
      role: "shop",
      orderBy: { column: "name" },
    });

    const allAbsData = await getEngineerAbsences<Absence>({
      select: "*",
      fromDate: formatLocalDateKey(new Date()),
      orderBy: { column: "absence_date", ascending: true },
    });

    const shopEngineerIds = new Set(engData.map((e) => e.id));
    const absData = allAbsData.filter((a) => shopEngineerIds.has(a.engineer_id));

    const woData = await getWorkOrders<WorkOrder>({
      select:
        "work_order_id, customer, work_order_type, part_number, current_process_step, due_date, hold_reason, rfq_state",
      isOpen: true,
      isActive: true,
    });

    setEngineers(engData);
    setAbsences(absData);
    setAllOrders(woData);

    const absenceDates = absData.map((a) => {
      const d = new Date(a.absence_date);
      d.setHours(0, 0, 0, 0);
      return d;
    });

    const result = calculateWeekCapacity(woData, engData.length, absenceDates);
    setWeeks(result.weeks);
    setOrderDetails(result.orderDetails);
    setOverdueOrders(result.overdueOrders);
    setLoading(false);
  });

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    if (!showInfoBanner) return;

    function handlePointerDown(event: MouseEvent) {
      if (!infoPopoverRef.current?.contains(event.target as Node)) {
        setShowInfoBanner(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setShowInfoBanner(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showInfoBanner]);

  if (loading) return <p style={{ padding: "2rem" }}>Loading...</p>;

  const excludedOrders: ExcludedOrder[] = allOrders
    .filter((o) => {
      if (!o.due_date) return true;
      if (o.hold_reason) return true;
      if (isRfqBlockedState(o.rfq_state)) return true;
      if (o.current_process_step === READY_TO_CLOSE_STEP) return true;
      return false;
    })
    .map((o) => {
      let reason = "";
      if (!o.due_date) reason = "No due date";
      else if (o.hold_reason) reason = `Blocked: ${o.hold_reason}`;
      else if (isRfqBlockedState(o.rfq_state)) reason = "RFQ blocked";
      else if (o.current_process_step === READY_TO_CLOSE_STEP) reason = "Ready to close";
      return { ...o, reason };
    });

  const ordersNoDueDate = excludedOrders.filter((o) => !o.due_date);
  const ordersBlocked = excludedOrders.filter(
    (o) => o.due_date && (o.hold_reason || isRfqBlockedState(o.rfq_state)),
  );
  const ordersEasa = excludedOrders.filter(
    (o) =>
      o.due_date &&
      o.current_process_step === READY_TO_CLOSE_STEP &&
      !o.hold_reason &&
      !isRfqBlockedState(o.rfq_state),
  );

  type RestrictionWarning = {
    restriction: string;
    label: string;
    blockedSteps: string[];
    unavailableDates: string[];
    affectedOrders: {
      work_order_id: string;
      customer: string | null;
      part_number: string | null;
      work_order_type: string | null;
      current_step: string | null;
      due_date: string | null;
    }[];
  };

  const restrictionWarnings: RestrictionWarning[] = (() => {
    const allDays: Date[] = weeks.flatMap((w) => w.workDays);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const warnings: RestrictionWarning[] = [];

    for (const [restriction, label] of Object.entries(RESTRICTION_LABELS)) {
      const blockedSteps = RESTRICTION_BLOCKED_STEPS[restriction] || [];
      const unavailableDates: string[] = [];

      for (const day of allDays) {
        if (day < today) continue;
        const dayStr = formatLocalDateKey(day);

        const absentIds = new Set(
          absences.filter((a) => a.absence_date === dayStr).map((a) => a.engineer_id),
        );
        const presentEngineers = engineers.filter((e) => !absentIds.has(e.id));

        if (presentEngineers.length === 0) {
          unavailableDates.push(dayStr);
          continue;
        }

        const anyoneCanDo = presentEngineers.some(
          (e) => !(e.restrictions || []).includes(restriction),
        );

        if (!anyoneCanDo) {
          unavailableDates.push(dayStr);
        }
      }

      if (unavailableDates.length === 0) continue;

      const affected = allOrders
        .filter((o) => {
          if (!o.work_order_type || !o.current_process_step) return false;
          const steps = PROCESS_STEPS[o.work_order_type];
          if (!steps) return false;

          const currentIdx = steps.indexOf(o.current_process_step);
          if (currentIdx === -1) return false;

          return blockedSteps.some((bs) => {
            const bsIdx = steps.indexOf(bs);
            return bsIdx >= currentIdx;
          });
        })
        .map((o) => ({
          work_order_id: o.work_order_id,
          customer: o.customer,
          part_number: o.part_number,
          work_order_type: o.work_order_type,
          current_step: o.current_process_step,
          due_date: o.due_date,
        }));

      if (affected.length === 0) continue;

      warnings.push({
        restriction,
        label,
        blockedSteps,
        unavailableDates,
        affectedOrders: affected,
      });
    }

    return warnings;
  })();

  function getActiveEngineersForWeek(week: WeekCapacity): number {
    const absentIds = new Set<number>();
    for (const day of week.workDays) {
      const dayStr = formatLocalDateKey(day);
      for (const a of absences) {
        if (a.absence_date === dayStr) {
          absentIds.add(a.engineer_id);
        }
      }
    }
    return Math.max(0, engineers.length - absentIds.size);
  }

  function getOrderCountForWeek(week: WeekCapacity): number {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return orderDetails.filter((o) => {
      if (o.is_overdue && week.weekLabel === "This week") return true;
      const dueDate = new Date(o.due_date);
      dueDate.setHours(0, 0, 0, 0);
      return week.workDays.some((d) => d >= today && d <= dueDate);
    }).length;
  }

  function getCurrentStepForWorkOrder(workOrderId: string, fallback?: string | null): string {
    if (fallback) return fallback;
    return allOrders.find((order) => order.work_order_id === workOrderId)?.current_process_step || "-";
  }

  function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  function formatShortDate(date: Date): string {
    return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }

  function parseLocalDateKey(dateStr: string): Date {
    const [year, month, day] = dateStr.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function formatDateRanges(dateStrings: string[]): string {
    if (dateStrings.length === 0) return "";

    const sortedDates = [...dateStrings]
      .map(parseLocalDateKey)
      .sort((a, b) => a.getTime() - b.getTime());

    const ranges: Array<{ start: Date; end: Date }> = [];

    for (const date of sortedDates) {
      const previous = ranges[ranges.length - 1];

      if (!previous) {
        ranges.push({ start: date, end: date });
        continue;
      }

      const dayDifference = Math.round(
        (date.getTime() - previous.end.getTime()) / (1000 * 60 * 60 * 24),
      );
      const crossesWeekend =
        previous.end.getDay() === 5 && date.getDay() === 1 && dayDifference === 3;

      if (dayDifference === 1 || crossesWeekend) {
        previous.end = date;
      } else {
        ranges.push({ start: date, end: date });
      }
    }

    return ranges
      .map((range) =>
        range.start.getTime() === range.end.getTime()
          ? formatDate(formatLocalDateKey(range.start))
          : `${formatDate(formatLocalDateKey(range.start))} - ${formatDate(formatLocalDateKey(range.end))}`,
      )
      .join(", ");
  }

  function weekDateRange(week: WeekCapacity): string {
    if (week.workDays.length === 0) return "";
    const first = week.workDays[0];
    const last = week.workDays[week.workDays.length - 1];
    return `${formatShortDate(first)} - ${formatShortDate(last)}`;
  }

  function statusLabel(status: string): string {
    if (status === "red") return "Overloaded";
    if (status === "orange") return "Nearly full";
    return "On track";
  }

  const groupedAbsences: GroupedAbsence[] = Object.values(
    absences.reduce((acc, a) => {
      const key = a.absence_group_id || `single-${a.id}`;

      if (!acc[key]) {
        acc[key] = {
          key,
          engineer_id: a.engineer_id,
          reason: a.reason,
          start_date: a.absence_date,
          end_date: a.absence_date,
          days: 0,
          ids: [],
          group_id: a.absence_group_id,
        };
      }

      if (a.absence_date < acc[key].start_date) acc[key].start_date = a.absence_date;
      if (a.absence_date > acc[key].end_date) acc[key].end_date = a.absence_date;

      acc[key].days += 1;
      acc[key].ids.push(a.id);

      return acc;
    }, {} as Record<string, GroupedAbsence>),
  ).sort((a, b) => a.start_date.localeCompare(b.start_date));

  const threeWeekCutoff = (() => {
    if (weeks.length === 0) return "";
    const lastWeek = weeks[weeks.length - 1];
    if (lastWeek.workDays.length === 0) return "";
    const lastDay = lastWeek.workDays[lastWeek.workDays.length - 1];
    return formatLocalDateKey(lastDay);
  })();

  const absencesThisWindow = groupedAbsences.filter(
    (a) => !threeWeekCutoff || a.start_date <= threeWeekCutoff,
  );
  const absencesLater = groupedAbsences.filter(
    (a) => threeWeekCutoff && a.start_date > threeWeekCutoff,
  );
  void absencesThisWindow;
  void absencesLater;

  const ui = {
    pageBg: "#f2efe9",
    surface: "#ffffff",
    surfaceMuted: "#faf8f3",
    surfaceSoft: "#f4f1ea",
    border: "#e2ddd1",
    borderStrong: "#ccc4b4",
    text: "#1f2937",
    muted: "#5f6b7c",
    mutedSoft: "#8590a0",
    green: "#166534",
    greenSoft: "#eef9f1",
    orange: "#b45309",
    orangeSoft: "#fff6e8",
    red: "#b42318",
    redSoft: "#fff2ef",
    blue: "#2555c7",
    blueSoft: "#eef3ff",
    warnBorder: "#ecd9b3",
    warnTint: "#fdf7ea",
    shadow: "0 1px 2px rgba(31, 41, 55, 0.04), 0 4px 12px rgba(31, 41, 55, 0.04)",
    shadowSoft: "0 1px 2px rgba(31, 41, 55, 0.03)",
    radius: "14px",
  };

  function toneStyles(tone: "green" | "orange" | "red" | "blue" | "slate") {
    if (tone === "green") {
      return { color: ui.green, backgroundColor: ui.greenSoft, borderColor: "#cfe5d6" };
    }
    if (tone === "orange") {
      return { color: ui.orange, backgroundColor: ui.orangeSoft, borderColor: "#ead1a6" };
    }
    if (tone === "red") {
      return { color: ui.red, backgroundColor: ui.redSoft, borderColor: "#efc6bf" };
    }
    if (tone === "blue") {
      return { color: ui.blue, backgroundColor: ui.blueSoft, borderColor: "#d7e3ff" };
    }
    return { color: ui.text, backgroundColor: ui.surfaceSoft, borderColor: ui.border };
  }

  function restrictionWarningTitle(warning: RestrictionWarning): string {
    const dayLabel = `${warning.unavailableDates.length} day${warning.unavailableDates.length !== 1 ? "s" : ""}`;

    if (warning.restriction === "ndt") {
      return `No NDT coverage on ${dayLabel}`;
    }

    if (warning.restriction === "certification") {
      return `No certification coverage on ${dayLabel}`;
    }

    return `${warning.label} unavailable on ${dayLabel}`;
  }

  const warningGroupCount =
    (overdueOrders.length > 0 ? 1 : 0) + restrictionWarnings.length;
  const visibleExcludedOrders = [...ordersNoDueDate, ...ordersBlocked, ...ordersEasa];

  const surfaceCardStyle: React.CSSProperties = {
    backgroundColor: ui.surface,
    border: `1px solid ${ui.border}`,
    borderRadius: ui.radius,
    boxShadow: ui.shadow,
  };

  const sectionCardStyle: React.CSSProperties = {
    ...surfaceCardStyle,
    padding: "16px 18px",
  };

  const collapsibleSectionStyle: React.CSSProperties = {
    ...surfaceCardStyle,
    padding: 0,
    overflow: "hidden",
  };

  const secondarySectionStyle: React.CSSProperties = {
    ...collapsibleSectionStyle,
    backgroundColor: ui.surfaceMuted,
    boxShadow: ui.shadowSoft,
  };

  const warningSectionStyle: React.CSSProperties = {
    ...collapsibleSectionStyle,
    borderColor: ui.warnBorder,
    backgroundColor: ui.warnTint,
  };

  const sectionHeaderStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "14px",
  };

  const sectionTitleStyle: React.CSSProperties = {
    margin: 0,
    fontSize: "16px",
    fontWeight: 650,
    color: ui.text,
    letterSpacing: "-0.015em",
  };

  const secondarySectionTitleStyle: React.CSSProperties = {
    ...sectionTitleStyle,
    fontSize: "15px",
    color: ui.muted,
  };

  const sectionDescriptionStyle: React.CSSProperties = {
    margin: "3px 0 0",
    fontSize: "13px",
    color: ui.muted,
    lineHeight: 1.5,
  };

  const badgeStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "3px 9px",
    borderRadius: "999px",
    border: `1px solid ${ui.border}`,
    fontSize: "12px",
    fontWeight: 650,
    lineHeight: 1.2,
    whiteSpace: "nowrap",
  };

  const labelStyle: React.CSSProperties = {
    margin: 0,
    fontSize: "10px",
    fontWeight: 700,
    color: ui.mutedSoft,
    textTransform: "uppercase",
    letterSpacing: "0.09em",
  };

  const collapsibleSummaryBaseStyle: React.CSSProperties = {
    cursor: "pointer",
    listStyle: "none",
    display: "block",
    padding: "12px 16px",
  };

  const summaryRightStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    flexShrink: 0,
  };

  const summaryTextWrapStyle: React.CSSProperties = {
    minWidth: 0,
    flex: 1,
  };

  const contentPaddingStyle: React.CSSProperties = {
    padding: "0 16px 14px",
  };

  const calloutStyle: React.CSSProperties = {
    padding: "11px 13px",
    borderRadius: "10px",
    border: `1px solid ${ui.border}`,
    backgroundColor: ui.surface,
    fontSize: "13px",
    lineHeight: 1.6,
    color: ui.text,
  };

  const tableWrapStyle: React.CSSProperties = {
    overflowX: "auto",
    borderRadius: "10px",
    border: `1px solid ${ui.border}`,
    backgroundColor: ui.surface,
  };

  const tableBaseStyle: React.CSSProperties = {
    borderCollapse: "separate",
    borderSpacing: 0,
    width: "100%",
  };

  const tableCellStyle: React.CSSProperties = {
    padding: "9px 13px",
    borderBottom: `1px solid ${ui.border}`,
    fontSize: "13px",
    overflowWrap: "anywhere",
    verticalAlign: "top",
    textAlign: "left",
    color: ui.text,
    backgroundColor: "transparent",
  };

  const tableHeaderCellStyle: React.CSSProperties = {
    ...tableCellStyle,
    fontWeight: 650,
    color: ui.muted,
    backgroundColor: ui.surfaceSoft,
    fontSize: "12px",
    letterSpacing: "0.02em",
    position: "sticky",
    top: 0,
    zIndex: 1,
  };

  const roundedTableHeaderStyle = (position: "left" | "right"): React.CSSProperties => ({
    borderTopLeftRadius: position === "left" ? "10px" : 0,
    borderTopRightRadius: position === "right" ? "10px" : 0,
  });

  const metricValueStyle: React.CSSProperties = {
    margin: "3px 0 0",
    fontSize: "15px",
    fontWeight: 650,
    color: ui.text,
  };

  const infoBlockStyle: React.CSSProperties = {
    padding: "13px 14px",
    borderRadius: "10px",
    border: `1px solid ${ui.border}`,
    backgroundColor: ui.surface,
    fontSize: "13px",
    lineHeight: 1.65,
    color: ui.text,
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        backgroundColor: ui.pageBg,
        padding: "32px 40px 40px",
        fontFamily: "var(--font-inter), var(--font-geist-sans), sans-serif",
        color: ui.text,
      }}
    >
      <style>{`
        .capacity-summary::-webkit-details-marker {
          display: none;
        }

        .capacity-details[open] > .capacity-summary .capacity-chevron {
          transform: rotate(180deg);
        }

        .capacity-summary {
          border-radius: 10px;
          transition: background-color 150ms ease;
        }

        .capacity-summary:hover {
          background-color: rgba(31, 41, 55, 0.035);
        }

        .capacity-summary:focus-visible {
          outline: 2px solid #4a68b3;
          outline-offset: -2px;
        }

        .capacity-summary-warn:hover {
          background-color: rgba(180, 83, 9, 0.05);
        }

        .capacity-summary:hover .capacity-chevron {
          color: #5a6575;
        }

        .capacity-table tbody tr {
          transition: background-color 120ms ease;
        }

        .capacity-table tbody tr:hover {
          background-color: #faf8f3;
        }

        .capacity-table tbody tr.capacity-row-overdue {
          background-color: #fdf6f4;
        }

        .capacity-table tbody tr.capacity-row-overdue:hover {
          background-color: #fbebe6;
        }

        .capacity-table tbody tr:last-child td {
          border-bottom: 0;
        }

        .capacity-info-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 11px;
          border-radius: 999px;
          border: 1px solid ${ui.border};
          background-color: ${ui.surface};
          color: ${ui.muted};
          font-size: 12px;
          font-weight: 600;
          line-height: 1.2;
          cursor: pointer;
          transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease;
          font-family: inherit;
        }

        .capacity-info-btn:hover {
          background-color: ${ui.surfaceSoft};
          border-color: ${ui.borderStrong};
          color: ${ui.text};
        }

        .capacity-info-btn[aria-expanded="true"] {
          background-color: ${ui.surfaceSoft};
          border-color: ${ui.borderStrong};
          color: ${ui.text};
        }

        .capacity-info-btn:focus-visible {
          outline: 2px solid #4a68b3;
          outline-offset: 2px;
        }

      `}</style>

      <div style={{ maxWidth: "1280px" }}>
        <header
          style={{
            marginBottom: "18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "16px",
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h1
              style={{
                margin: 0,
                fontSize: "36px",
                fontWeight: 800,
                letterSpacing: "-0.035em",
                color: ui.text,
                lineHeight: 1.02,
              }}
            >
              Capacity Management
            </h1>
            <p
              style={{
                margin: "8px 0 0",
                fontSize: "14px",
                lineHeight: 1.45,
                color: ui.muted,
                whiteSpace: "nowrap",
              }}
            >
              Monitor near-term shop capacity, see which orders are driving weekly load, and review issues that need timely attention.
            </p>
          </div>
        </header>

        <section style={{ ...sectionCardStyle, marginBottom: "14px" }}>
          <div style={{ ...sectionHeaderStyle, marginBottom: "12px" }}>
            <div>
              <h2 style={sectionTitleStyle}>Weekly overview</h2>
              <p style={sectionDescriptionStyle}>
                Utilization, workload, available hours, and how many engineers and orders contribute to each week.
              </p>
            </div>

            <div
              ref={infoPopoverRef}
              style={{ position: "relative", flexShrink: 0 }}
            >
              <button
                type="button"
                className="capacity-info-btn"
                aria-label="How capacity is calculated"
                aria-expanded={showInfoBanner}
                aria-controls="capacity-help-popover"
                onClick={() => setShowInfoBanner((current) => !current)}
              >
                <InfoIcon />
                <span>How it works</span>
              </button>

              {showInfoBanner && (
                <div
                  id="capacity-help-popover"
                  role="dialog"
                  aria-label="How capacity is calculated"
                  style={{
                    position: "absolute",
                    top: "calc(100% + 8px)",
                    right: 0,
                    zIndex: 20,
                    width: "min(460px, calc(100vw - 48px))",
                    padding: "14px",
                    borderRadius: "12px",
                    border: `1px solid ${ui.border}`,
                    backgroundColor: ui.surface,
                    boxShadow: "0 18px 40px rgba(31, 41, 55, 0.12)",
                    display: "grid",
                    gap: "10px",
                  }}
                >
                  <div>
                    <h3 style={{ ...sectionTitleStyle, fontSize: "15px" }}>How capacity is calculated</h3>
                  </div>

                  <div style={{ display: "grid", gap: "8px" }}>
                    <div style={infoBlockStyle}>
                      <strong style={{ display: "block", marginBottom: "4px" }}>Included in Calculation</strong>
                      Only active work orders are included when they have a due date, are not blocked, and are not ready to close.
                    </div>

                    <div
                      style={{
                        ...infoBlockStyle,
                        border: `1px solid ${toneStyles("orange").borderColor}`,
                        backgroundColor: toneStyles("orange").backgroundColor,
                      }}
                    >
                      <strong style={{ display: "block", marginBottom: "4px", color: ui.orange }}>Excluded from Calculation</strong>
                      Work orders are excluded when they have no due date, are blocked, or are already ready to close.
                    </div>

                    <div style={infoBlockStyle}>
                      <strong style={{ display: "block", marginBottom: "4px" }}>Planned hours</strong>
                      Each included work order gets estimated remaining hours based on its type, part history, and current process step.
                    </div>

                    <div style={infoBlockStyle}>
                      <strong style={{ display: "block", marginBottom: "4px" }}>Available hours</strong>
                      Available hours are based on active shop engineers, standard working hours, and planned absences.
                    </div>

                    <div style={infoBlockStyle}>
                      <strong style={{ display: "block", marginBottom: "4px" }}>Utilization</strong>
                      Utilization = planned hours / available hours.
                    </div>

                    <div style={infoBlockStyle}>
                      <strong style={{ display: "block", marginBottom: "4px" }}>Overdue orders</strong>
                      If an included work order is overdue, all remaining hours count in this week.
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: "12px",
            }}
          >
            {weeks.map((w, i) => {
              const activeEngs = getActiveEngineersForWeek(w);
              const orderCount = getOrderCountForWeek(w);
              const tone = w.status === "red" ? "red" : w.status === "orange" ? "orange" : "green";
              const toneStyle = toneStyles(tone);

              return (
                <article
                  key={i}
                  style={{
                    border: `1px solid ${ui.border}`,
                    backgroundColor: ui.surface,
                    borderRadius: "12px",
                    padding: "13px 14px",
                    display: "grid",
                    gap: "10px",
                    boxShadow: ui.shadowSoft,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: "10px",
                    }}
                  >
                    <div>
                      <h3
                        style={{
                          margin: 0,
                          fontSize: "14px",
                          fontWeight: 650,
                          color: ui.text,
                          letterSpacing: "-0.01em",
                        }}
                      >
                        {w.weekLabel}
                      </h3>
                      <p style={{ margin: "2px 0 0", fontSize: "12px", color: ui.muted }}>
                        {weekDateRange(w)}
                      </p>
                    </div>
                    <span style={{ ...badgeStyle, ...toneStyle }}>{statusLabel(w.status)}</span>
                  </div>

                  <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                    <span
                      style={{
                        fontSize: "30px",
                        fontWeight: 700,
                        lineHeight: 1,
                        letterSpacing: "-0.03em",
                        color: toneStyle.color,
                      }}
                    >
                      <AnimatedNumber value={w.percentage} />%
                    </span>
                    <span style={{ fontSize: "12px", color: ui.muted }}>utilization</span>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                      gap: "8px 12px",
                      paddingTop: "4px",
                      borderTop: `1px solid ${ui.border}`,
                    }}
                  >
                    <div>
                      <p style={labelStyle}>Planned</p>
                      <p style={metricValueStyle}>
                        <AnimatedNumber value={w.requiredHours} decimals={1} />h
                      </p>
                    </div>
                    <div>
                      <p style={labelStyle}>Available</p>
                      <p style={metricValueStyle}>
                        <AnimatedNumber value={w.availableHours} decimals={1} />h
                      </p>
                    </div>
                    <div>
                      <p style={labelStyle}>Engineers</p>
                      <p style={metricValueStyle}>
                        <AnimatedNumber value={activeEngs} />/{engineers.length}
                      </p>
                    </div>
                    <div>
                      <p style={labelStyle}>Orders</p>
                      <p style={metricValueStyle}>
                        <AnimatedNumber value={orderCount} />
                      </p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section style={{ ...warningSectionStyle, marginBottom: "14px" }}>
          <details className="capacity-details">
            <summary
              className="capacity-summary capacity-summary-warn"
              style={collapsibleSummaryBaseStyle}
            >
              <div style={sectionHeaderStyle}>
                <div style={summaryTextWrapStyle}>
                  <h2 style={sectionTitleStyle}>Warnings</h2>
                  <p style={sectionDescriptionStyle}>
                    Review these warnings to see what may affect this week&apos;s workload or delay work orders.
                  </p>
                </div>
                <div style={summaryRightStyle}>
                  <span
                    style={{
                      ...badgeStyle,
                      ...(warningGroupCount > 0
                        ? { ...toneStyles("orange"), fontWeight: 700 }
                        : toneStyles("slate")),
                    }}
                  >
                    <AnimatedNumber value={warningGroupCount} /> warning{warningGroupCount !== 1 ? "s" : ""}
                  </span>
                  <ChevronIcon />
                </div>
              </div>
            </summary>

            <div style={contentPaddingStyle}>
              {warningGroupCount > 0 ? (
                <div style={{ display: "grid", gap: "10px" }}>
                  {overdueOrders.length > 0 && (
                    <details
                      className="capacity-details"
                      style={{
                        border: `1px solid ${toneStyles("red").borderColor}`,
                        borderRadius: "12px",
                        backgroundColor: ui.surface,
                      }}
                    >
                      <summary className="capacity-summary" style={collapsibleSummaryBaseStyle}>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "64px minmax(0, 1fr) auto",
                            columnGap: "12px",
                            alignItems: "center",
                          }}
                        >
                          <div>
                            <span
                              style={{
                                ...badgeStyle,
                                ...toneStyles("red"),
                                justifyContent: "center",
                                width: "100%",
                              }}
                            >
                              High
                            </span>
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: "14px", fontWeight: 650, color: ui.text }}>
                              <AnimatedNumber value={overdueOrders.length} /> work order{overdueOrders.length !== 1 ? "s are" : " is"} overdue
                            </div>
                            <div
                              style={{
                                marginTop: "2px",
                                fontSize: "13px",
                                color: ui.muted,
                                lineHeight: 1.5,
                              }}
                            >
                              All remaining hours for these work orders have been added to this week&apos;s plan.
                            </div>
                          </div>
                          <ChevronIcon />
                        </div>
                      </summary>

                      <div style={{ padding: "0 14px 14px" }}>
                        <div style={tableWrapStyle}>
                          <table className="capacity-table" style={{ ...tableBaseStyle, minWidth: "900px" }}>
                            <thead>
                              <tr>
                                <th style={{ ...tableHeaderCellStyle, ...roundedTableHeaderStyle("left") }}>WO</th>
                                <th style={tableHeaderCellStyle}>Customer</th>
                                <th style={tableHeaderCellStyle}>Part number</th>
                                <th style={tableHeaderCellStyle}>Type</th>
                                <th style={tableHeaderCellStyle}>Due date</th>
                                <th style={{ ...tableHeaderCellStyle, ...roundedTableHeaderStyle("right") }}>Current step</th>
                              </tr>
                            </thead>
                            <tbody>
                              {overdueOrders.map((o) => (
                                <tr key={o.work_order_id} className="capacity-row-overdue">
                                  <td style={{ ...tableCellStyle, fontWeight: 600 }}>{o.work_order_id}</td>
                                  <td style={tableCellStyle}>{o.customer || "-"}</td>
                                  <td style={tableCellStyle}>{o.part_number || "-"}</td>
                                  <td style={tableCellStyle}>{o.work_order_type || "-"}</td>
                                  <td style={tableCellStyle}>{formatDate(o.due_date)}</td>
                                  <td style={tableCellStyle}>{getCurrentStepForWorkOrder(o.work_order_id, o.current_step)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </details>
                  )}

                  {restrictionWarnings.map((w) => (
                    <details
                      key={w.restriction}
                      className="capacity-details"
                      style={{
                        border: `1px solid ${toneStyles("orange").borderColor}`,
                        borderRadius: "12px",
                        backgroundColor: ui.surface,
                      }}
                    >
                      <summary className="capacity-summary" style={collapsibleSummaryBaseStyle}>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "64px minmax(0, 1fr) auto",
                            columnGap: "12px",
                            alignItems: "center",
                          }}
                        >
                          <div>
                            <span
                              style={{
                                ...badgeStyle,
                                ...toneStyles("orange"),
                                justifyContent: "center",
                                width: "100%",
                              }}
                            >
                              Medium
                            </span>
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: "14px", fontWeight: 650, color: ui.text }}>
                              {restrictionWarningTitle(w)}
                            </div>
                            <div
                              style={{
                                marginTop: "2px",
                                fontSize: "13px",
                                color: ui.muted,
                                lineHeight: 1.5,
                              }}
                            >
                              No available engineer can do {w.blockedSteps.join(", ")} on these dates.
                            </div>
                          </div>
                          <ChevronIcon />
                        </div>
                      </summary>

                      <div style={{ padding: "0 14px 14px", display: "grid", gap: "10px" }}>
                        <div style={calloutStyle}>
                          <strong style={{ fontWeight: 650 }}>Unavailable dates:</strong> {formatDateRanges(w.unavailableDates)}
                        </div>

                        <div style={calloutStyle}>
                          <p style={{ margin: 0, fontSize: "13px", color: ui.text, lineHeight: 1.6 }}>
                            <AnimatedNumber value={w.affectedOrders.length} /> order{w.affectedOrders.length !== 1 ? "s still" : " still"} need{" "}
                            {w.restriction === "certification"
                              ? "a qualified engineer available for certification"
                              : "these steps done on a day when a qualified engineer is present"}
                            .
                          </p>

                          <div style={{ ...tableWrapStyle, marginTop: "10px" }}>
                            <table className="capacity-table" style={{ ...tableBaseStyle, minWidth: "980px" }}>
                              <thead>
                                <tr>
                                  <th style={{ ...tableHeaderCellStyle, ...roundedTableHeaderStyle("left") }}>WO</th>
                                  <th style={tableHeaderCellStyle}>Customer</th>
                                  <th style={tableHeaderCellStyle}>Part number</th>
                                  <th style={tableHeaderCellStyle}>Type</th>
                                  <th style={tableHeaderCellStyle}>Due date</th>
                                  <th style={{ ...tableHeaderCellStyle, ...roundedTableHeaderStyle("right") }}>Current step</th>
                                </tr>
                              </thead>
                              <tbody>
                                {w.affectedOrders.map((o) => (
                                  <tr key={o.work_order_id}>
                                    <td style={{ ...tableCellStyle, fontWeight: 600 }}>{o.work_order_id}</td>
                                    <td style={tableCellStyle}>{o.customer || "-"}</td>
                                    <td style={tableCellStyle}>{o.part_number || "-"}</td>
                                    <td style={tableCellStyle}>{o.work_order_type || "-"}</td>
                                    <td style={tableCellStyle}>{o.due_date ? formatDate(o.due_date) : "No due date"}</td>
                                    <td style={tableCellStyle}>{o.current_step || "-"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    </details>
                  ))}
                </div>
              ) : (
                <div
                  style={{
                    padding: "14px",
                    borderRadius: "10px",
                    backgroundColor: ui.surface,
                    border: `1px dashed ${ui.borderStrong}`,
                    color: ui.muted,
                    fontSize: "13px",
                  }}
                >
                  No warnings need attention right now.
                </div>
              )}
            </div>
          </details>
        </section>

        {orderDetails.length > 0 && (
          <section style={{ ...collapsibleSectionStyle, marginBottom: "14px" }}>
            <details className="capacity-details">
              <summary className="capacity-summary" style={collapsibleSummaryBaseStyle}>
                <div style={sectionHeaderStyle}>
                  <div style={summaryTextWrapStyle}>
                    <h2 style={sectionTitleStyle}>Orders included in calculation</h2>
                    <p style={sectionDescriptionStyle}>
                      Active, non-blocked orders with a due date and not yet ready to close.
                    </p>
                  </div>
                  <div style={summaryRightStyle}>
                    <span style={{ ...badgeStyle, ...toneStyles("blue") }}>
                      <AnimatedNumber value={orderDetails.length} /> order{orderDetails.length !== 1 ? "s" : ""}
                    </span>
                    <ChevronIcon />
                  </div>
                </div>
              </summary>

              <div style={contentPaddingStyle}>
                <div style={tableWrapStyle}>
                  <table className="capacity-table" style={{ ...tableBaseStyle, minWidth: "980px" }}>
                    <thead>
                      <tr>
                        <th style={{ ...tableHeaderCellStyle, ...roundedTableHeaderStyle("left") }}>WO</th>
                        <th style={tableHeaderCellStyle}>Customer</th>
                        <th style={tableHeaderCellStyle}>Part number</th>
                        <th style={tableHeaderCellStyle}>Type</th>
                        <th style={tableHeaderCellStyle}>Due date</th>
                        <th style={tableHeaderCellStyle}>Current process step</th>
                        <th style={{ ...tableHeaderCellStyle, ...roundedTableHeaderStyle("right") }}>Remaining</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderDetails.map((o) => (
                        <tr key={o.work_order_id} className={o.is_overdue ? "capacity-row-overdue" : undefined}>
                          <td style={{ ...tableCellStyle, fontWeight: 600 }}>{o.work_order_id}</td>
                          <td style={tableCellStyle}>{o.customer || "-"}</td>
                          <td style={tableCellStyle}>{o.part_number || "-"}</td>
                          <td style={tableCellStyle}>{o.work_order_type || "-"}</td>
                          <td style={tableCellStyle}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                              <span>{formatDate(o.due_date)}</span>
                              {o.is_overdue && (
                                <span style={{ ...badgeStyle, ...toneStyles("red") }}>Overdue</span>
                              )}
                            </div>
                          </td>
                          <td style={tableCellStyle}>{getCurrentStepForWorkOrder(o.work_order_id, o.current_step)}</td>
                          <td style={tableCellStyle}>{o.remaining_hours}h</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </details>
          </section>
        )}

        {visibleExcludedOrders.length > 0 && (
          <section style={{ ...secondarySectionStyle, marginBottom: "14px" }}>
            <details className="capacity-details">
              <summary className="capacity-summary" style={collapsibleSummaryBaseStyle}>
                <div style={sectionHeaderStyle}>
                  <div style={summaryTextWrapStyle}>
                    <h2 style={secondarySectionTitleStyle}>Excluded orders</h2>
                    <p style={sectionDescriptionStyle}>
                      Orders without a due date ({ordersNoDueDate.length}), blocked orders ({ordersBlocked.length}), and ready-to-close orders ({ordersEasa.length}) &mdash; all excluded from the capacity calculation.
                    </p>
                  </div>
                  <div style={summaryRightStyle}>
                    <span style={{ ...badgeStyle, ...toneStyles("slate") }}>
                      <AnimatedNumber value={visibleExcludedOrders.length} /> order{visibleExcludedOrders.length !== 1 ? "s" : ""}
                    </span>
                    <ChevronIcon />
                  </div>
                </div>
              </summary>

              <div style={contentPaddingStyle}>
                <div style={tableWrapStyle}>
                  <table className="capacity-table" style={{ ...tableBaseStyle, minWidth: "920px" }}>
                    <thead>
                      <tr>
                        <th style={{ ...tableHeaderCellStyle, ...roundedTableHeaderStyle("left") }}>WO</th>
                        <th style={tableHeaderCellStyle}>Customer</th>
                        <th style={tableHeaderCellStyle}>Part number</th>
                        <th style={tableHeaderCellStyle}>Type</th>
                        <th style={tableHeaderCellStyle}>Due date</th>
                        <th style={{ ...tableHeaderCellStyle, ...roundedTableHeaderStyle("right") }}>Reason excluded</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleExcludedOrders.map((o) => (
                        <tr key={o.work_order_id}>
                          <td style={{ ...tableCellStyle, fontWeight: 600 }}>{o.work_order_id}</td>
                          <td style={tableCellStyle}>{o.customer || "-"}</td>
                          <td style={tableCellStyle}>{o.part_number || "-"}</td>
                          <td style={tableCellStyle}>{o.work_order_type || "-"}</td>
                          <td style={tableCellStyle}>{o.due_date ? formatDate(o.due_date) : "No due date"}</td>
                          <td style={tableCellStyle}>{o.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </details>
          </section>
        )}

      </div>
    </main>
  );
}
