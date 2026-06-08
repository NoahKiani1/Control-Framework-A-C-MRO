"use client";

import Link from "next/link";
import { Newspaper, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { dispatchAcmpPendingReviewRefresh } from "@/app/components/acmp-pending-events";
import { RequireRole } from "@/app/components/require-role";
import { PageHeader } from "@/app/components/page-header";
import { applySuggestedAssignmentsForCurrentStep } from "@/lib/auto-assign";
import {
  blockReason as getWorkOrderBlockReason,
  formatDate,
  getCorrectiveActionCompletionPayload,
  hasActiveCorrectiveAction,
  isBlocked,
  isRfqManualApprovalBlocked,
  isRfqRejectedState,
  isStale,
  latestUpdate,
  normalizeRfqState,
  normalizeAssignedPersonTeam,
  priorityTag,
  sortOrders,
} from "@/lib/work-order-rules";
import { getWorkOrders, updateWorkOrder } from "@/lib/work-orders";
import { archiveCompletedCorrectiveAction } from "@/lib/completed-tasks";
import {
  RFQ_AWAITING_APPROVAL_REASON,
  buildCloseRfqActionPayload,
  hasActiveRfqSendAction,
  type RfqCloseMode,
} from "@/lib/rfq-workflow";
import {
  filterEngineersStartedOnDateKey,
  getEngineers,
  getEngineerAbsences,
  getAbsentEngineerIdSetForDateKey,
  deletePastEngineerAbsences,
  isEngineerStartedOnDateKey,
} from "@/lib/engineers";
import { calculateWeekCapacity } from "@/lib/capacity";
import { RESTRICTION_BLOCKED_STEPS, hasRestriction } from "@/lib/restrictions";
import {
  READY_TO_CLOSE_STEP,
  resolveStepsForOrder,
} from "@/lib/process-steps";
import { syncWorkOrderDataBlockState } from "@/lib/work-order-data";
import { supabase } from "@/lib/supabase";
import { reactivateReturnedAbsentAssigneeWorkOrders } from "@/lib/absent-assignment";

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
  rfq_manual_approved_at: string | null;
  required_next_action: string | null;
  action_owner: string | null;
  action_status: string | null;
  action_closed: boolean | null;
  action_created_at: string | null;
  action_closed_at: string | null;
  last_manual_update: string | null;
  last_system_update: string | null;
  work_order_type: string | null;
  included_process_steps: string[] | null;
  is_open: boolean;
  is_active: boolean;
  data_tracking_enabled: boolean | null;
};

type Engineer = {
  id: number;
  name: string;
  is_active: boolean;
  restrictions: string[] | null;
  employment_start_date: string | null;
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
  dateKey: string;
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

type AbsencePeriodImpact = {
  key: string;
  signature: string;
  dateLabel: string;
  startDate: Date;
  endDate: Date;
  absentEngineers: AbsenceDayImpact["absentEngineers"];
  unavailableSteps: string[];
  affectedOrders: AbsenceDayImpact["affectedOrders"];
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

type DropboxCandidate = {
  filename: string;
  exportDate: string | null;
  exportSequence: number;
  serverModified: string | null;
  pathLower: string;
};

type DropboxImportSummary = {
  candidatesFound?: number;
  deletedSuperseded?: number;
  processedFiles: number;
  ignoredDuplicateFiles: number;
  failedFiles: number;
  totals: {
    pendingNewWorkOrders: number;
    pendingRfqApprovedInactive: number;
    closedRemoved: number;
    missingClosed: number;
  };
};

type DropboxStatusTone = "info" | "success" | "error";

type DashboardActionConfirmation = {
  kind: "close_action" | "rfq_sent";
  order: WorkOrder;
};

type ShopWallSettings = {
  aviationNewsEnabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
};

// Refined palette — modern, clean, professional
const COLORS = {
  // Surfaces
  pageBg: "#f2efe9",
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

function formatDropboxImportStatus(summary: DropboxImportSummary): string {
  if (summary.failedFiles > 0 && summary.processedFiles === 0) {
    return "AcMP import failed.";
  }
  if (summary.failedFiles > 0) {
    return "AcMP import finished with errors.";
  }
  if (summary.processedFiles > 0 || summary.ignoredDuplicateFiles > 0) {
    const parts: string[] = [];
    if (summary.totals.pendingNewWorkOrders > 0) {
      parts.push(`${summary.totals.pendingNewWorkOrders} new to review`);
    }
    if (summary.totals.pendingRfqApprovedInactive > 0) {
      parts.push(`${summary.totals.pendingRfqApprovedInactive} RFQ review`);
    }
    if (summary.totals.closedRemoved > 0) {
      parts.push(`${summary.totals.closedRemoved} closed removed`);
    }
    return parts.length > 0
      ? `AcMP import successful: ${parts.join(", ")}.`
      : "AcMP import successful.";
  }
  return "No new AcMP export found.";
}

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
  if (isRfqRejectedState(o.rfq_state)) return false;
  if (isRfqManualApprovalBlocked(o)) return true;
  if (hasActiveCorrectiveAction(o)) return true;
  return Boolean(o.hold_reason?.trim()) && o.action_status !== "Done" && !o.action_closed;
}

function getManualUnblockPayload(order: WorkOrder, timestamp: string) {
  return {
    hold_reason: null,
    rfq_manual_approved_at:
      normalizeRfqState(order.rfq_state) === "rfq send"
        ? order.rfq_manual_approved_at ?? timestamp
        : null,
    required_next_action: null,
    action_owner: null,
    action_status: null,
    action_closed: false,
    action_created_at: null,
    action_closed_at: null,
    last_manual_update: timestamp,
  };
}

function engineerCanDoRestriction(eng: Engineer, restriction: string): boolean {
  return !hasRestriction(eng.restrictions, restriction);
}

function blockedReason(order: WorkOrder): string {
  return getWorkOrderBlockReason(order, {
    rfqSentLabel: RFQ_AWAITING_APPROVAL_REASON,
  });
}

function formatAnimatedNumber(value: number, decimals: number): string {
  if (decimals === 0) return String(Math.round(value));
  const rounded = Number(value.toFixed(decimals));
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(decimals);
}

function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatAbsenceDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function formatAbsenceDateRange(startDate: Date, endDate: Date): string {
  const startLabel = formatAbsenceDate(startDate);
  const endLabel = formatAbsenceDate(endDate);
  return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
}

function getAbsenceImpactSignature(day: AbsenceDayImpact): string {
  return JSON.stringify({
    absent: day.absentEngineers.map((e) => e.name),
    unavailableSteps: day.unavailableSteps,
    affectedOrders: day.affectedOrders.map((o) => ({
      id: o.work_order_id,
      steps: o.blocked_remaining_steps,
    })),
  });
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
      className="dashboard-kpi-card"
      onClick={onClick}
      style={{
        position: "relative",
        width: "100%",
        padding: "var(--card-py) var(--card-px)",
        backgroundColor: active ? color : COLORS.surface,
        border: `1px solid ${active ? color : COLORS.border}`,
        borderRadius: "var(--card-radius)",
        cursor: onClick ? "pointer" : "default",
        textAlign: "left",
        transition: "transform 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease",
        boxShadow: active
          ? `0 10px 24px -8px ${color}66`
          : "0 1px 2px rgba(15, 23, 42, 0.04)",
        overflow: "hidden",
        fontFamily: FONT_STACK,
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-start",
        minHeight: "68px",
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
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "flex-start",
          gap: "8px",
          paddingLeft: "6px",
          maxWidth: "100%",
          minWidth: 0,
        }}
      >
        <div
          className="dashboard-kpi-value"
          style={{
            fontSize: "var(--fs-display)",
            fontWeight: 700,
            color: active ? "white" : color,
            lineHeight: 1,
            letterSpacing: "-0.03em",
            fontVariantNumeric: "tabular-nums",
            flexShrink: 0,
          }}
        >
          <AnimatedNumber value={value} />
        </div>

        <div
          className="dashboard-kpi-label"
          style={{
            color: active ? "rgba(255,255,255,0.95)" : COLORS.textSoft,
            fontWeight: 550,
            lineHeight: 1.35,
            whiteSpace: "normal",
            overflow: "hidden",
            overflowWrap: "anywhere",
            minWidth: 0,
          }}
        >
          {label}
        </div>
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
        padding: "var(--card-py) var(--card-px)",
        backgroundColor: t.bg,
        border: `1px solid ${t.border}`,
        borderRadius: "var(--card-radius)",
        boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
      }}
    >
      <div
        className="dashboard-meta-label"
        style={{
          color: COLORS.textMuted,
          marginBottom: "8px",
        }}
      >
        {label}
      </div>
      <div style={{ color: t.color }}>{children}</div>
    </div>
  );
}

function DashboardPageContent() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [engineers, setEngineers] = useState<Engineer[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [loading, setLoading] = useState(true);
  const [activePanel, setActivePanel] = useState<DetailPanel>(null);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [dropboxBusy, setDropboxBusy] = useState(false);
  const [dropboxStatus, setDropboxStatus] = useState("");
  const [dropboxStatusTone, setDropboxStatusTone] =
    useState<DropboxStatusTone>("info");
  const [dropboxCandidates, setDropboxCandidates] = useState<DropboxCandidate[]>(
    [],
  );
  const [shopWallSettings, setShopWallSettings] =
    useState<ShopWallSettings | null>(null);
  const [shopWallSettingsBusy, setShopWallSettingsBusy] = useState(false);
  const [shopWallSettingsStatus, setShopWallSettingsStatus] = useState("");
  const [actionConfirmation, setActionConfirmation] =
    useState<DashboardActionConfirmation | null>(null);
  const [rfqCloseMode, setRfqCloseMode] =
    useState<RfqCloseMode>("awaiting_approval");
  const [actionConfirmationStatus, setActionConfirmationStatus] = useState("");
  const [isCompletingAction, setIsCompletingAction] = useState(false);

  const loadDashboardData = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    const today = toLocalDateKey(new Date());
    await deletePastEngineerAbsences(today);

    const [eng, abs] = await Promise.all([
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

    const reactivationResult =
      await reactivateReturnedAbsentAssigneeWorkOrders({
        today,
        absences: abs,
      });
    if (reactivationResult.error) {
      console.error(
        `Failed to reactivate returned absent-assignee work orders: ${reactivationResult.error.message}`,
      );
    }

    const wo = await getWorkOrders<WorkOrder>({
      select: "*",
      isOpen: true,
      isActive: true,
    });

    const startedTodayEngineers = filterEngineersStartedOnDateKey(eng, today);

    setOrders(
      sortOrders(
        applySuggestedAssignmentsForCurrentStep(
          wo,
          startedTodayEngineers,
          new Set(
            startedTodayEngineers
              .filter((engineer) =>
                abs.some(
                  (absence) =>
                    absence.absence_date === today &&
                    absence.engineer_id === engineer.id,
                ),
              )
              .map((engineer) => engineer.name),
          ),
        ),
      ),
    );

    const shopIds = new Set(eng.map((e) => e.id));
    setEngineers(eng);
    setAbsences(abs.filter((a) => shopIds.has(a.engineer_id)));
    setLoading(false);
  }, []);

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token
      ? { Authorization: `Bearer ${session.access_token}` }
      : {};
  }, []);

  const fetchJson = useCallback(async <T,>(
    url: string,
    init: RequestInit = {},
  ): Promise<T> => {
    const headers = {
      ...(await authHeaders()),
      ...(init.headers ?? {}),
    };
    const response = await fetch(url, { ...init, headers });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error?.message || "Request failed.");
    }
    return payload as T;
  }, [authHeaders]);

  const loadShopWallSettings = useCallback(async () => {
    try {
      const payload = await fetchJson<{ settings: ShopWallSettings }>(
        "/api/shop-wall-settings",
      );
      setShopWallSettings(payload.settings);
      setShopWallSettingsStatus("");
    } catch (error) {
      setShopWallSettingsStatus(
        error instanceof Error
          ? `Wall setting error: ${error.message}`
          : "Wall setting error.",
      );
    }
  }, [fetchJson]);

  async function toggleAviationNewsForWall() {
    const nextEnabled = !(shopWallSettings?.aviationNewsEnabled ?? false);
    setShopWallSettingsBusy(true);
    setShopWallSettingsStatus(
      nextEnabled ? "Turning news on..." : "Turning news off...",
    );

    try {
      const payload = await fetchJson<{ settings: ShopWallSettings }>(
        "/api/shop-wall-settings",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ aviationNewsEnabled: nextEnabled }),
        },
      );

      setShopWallSettings(payload.settings);
      setShopWallSettingsStatus(
        payload.settings.aviationNewsEnabled
          ? "Luchtvaartnieuws enabled for wall."
          : "Luchtvaartnieuws disabled for wall.",
      );
    } catch (error) {
      setShopWallSettingsStatus(
        error instanceof Error
          ? `Wall setting error: ${error.message}`
          : "Wall setting error.",
      );
    } finally {
      setShopWallSettingsBusy(false);
    }
  }

  async function checkDropboxNow() {
    setDropboxBusy(true);
    setDropboxStatusTone("info");
    setDropboxStatus("Checking Dropbox...");
    try {
      const payload = await fetchJson<{ candidates: DropboxCandidate[] }>(
        "/api/acmp/dropbox/check",
      );
      setDropboxCandidates(payload.candidates);
      const newestCandidate = payload.candidates[0];
      if (!newestCandidate) {
        setDropboxStatus("No new AcMP export found.");
      } else if (payload.candidates.length === 1) {
        setDropboxStatus(`AcMP export ready: ${newestCandidate.filename}.`);
      } else {
        setDropboxStatus(
          `Multiple Excel exports found. Newest will import: ${newestCandidate.filename}. Older Excel files delete after success.`,
        );
      }
    } catch (error) {
      setDropboxStatusTone("error");
      setDropboxStatus(
        error instanceof Error ? `Error: ${error.message}` : "Dropbox check failed.",
      );
    } finally {
      setDropboxBusy(false);
    }
  }

  async function importDropboxNow() {
    setDropboxBusy(true);
    setDropboxStatusTone("info");
    setDropboxStatus("Importing AcMP export...");
    try {
      const summary = await fetchJson<DropboxImportSummary>(
        "/api/acmp/dropbox/import",
        { method: "POST" },
      );
      setDropboxCandidates([]);
      setDropboxStatusTone(summary.failedFiles > 0 ? "error" : "success");
      setDropboxStatus(formatDropboxImportStatus(summary));
      dispatchAcmpPendingReviewRefresh();
      await loadDashboardData();
    } catch (error) {
      setDropboxStatusTone("error");
      setDropboxStatus(
        error instanceof Error ? `Error: ${error.message}` : "Dropbox import failed.",
      );
    } finally {
      setDropboxBusy(false);
    }
  }

  useEffect(() => {
    void loadDashboardData(true);
  }, [loadDashboardData]);

  useEffect(() => {
    void loadShopWallSettings();
  }, [loadShopWallSettings]);

  if (loading) {
    return (
      <main
        style={{
          minHeight: "100vh",
          backgroundColor: COLORS.pageBg,
          padding: "var(--layout-page-py) var(--layout-page-px) var(--layout-page-px)",
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
  const readyToSendRfq = activeOrders.filter(hasActiveRfqSendAction);
  const readyPanelOrders = [...readyToClose, ...readyToSendRfq];

  const dueThisWeek = activeOrders.filter((o) => isDueThisWeek(o.due_date));
  const overdueOrders = activeOrders.filter((o) => isOverdue(o.due_date));
  const openActions = activeOrders.filter(
    (o) => hasOpenAction(o) && !hasActiveRfqSendAction(o),
  );
  const aogOrders = activeOrders.filter((o) => priorityTag(o.priority) !== null);
  const staleOrders = activeOrders.filter((o) => {
    const last = latestUpdate(o.last_system_update, o.last_manual_update);
    return isStale(last);
  });

  const todayStr = toLocalDateKey(new Date());
  const engineerMap = new Map(engineers.map((e) => [e.id, e]));
  const todayStartedEngineers = filterEngineersStartedOnDateKey(engineers, todayStr);
  const todayAbsentEngineerIds = getAbsentEngineerIdSetForDateKey(absences, todayStr);
  const todayPresentEngineers = todayStartedEngineers.filter(
    (engineer) => !todayAbsentEngineerIds.has(engineer.id),
  );
  const absenceDates = absences
    .filter((a) => a.absence_date >= todayStr)
    .filter((a) => {
      const engineer = engineerMap.get(a.engineer_id);
      return engineer ? isEngineerStartedOnDateKey(engineer, a.absence_date) : false;
    })
    .map((a) => parseLocalDateKey(a.absence_date));

  const { weeks } = calculateWeekCapacity(
    activeOrders.map((o) => ({
      work_order_id: o.work_order_id,
      customer: o.customer,
      work_order_type: o.work_order_type,
      part_number: o.part_number,
      current_process_step: o.current_process_step,
      included_process_steps: o.included_process_steps,
      due_date: o.due_date,
      hold_reason: o.hold_reason,
      rfq_state: o.rfq_state,
    })),
    engineers,
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
    const steps = resolveStepsForOrder(
      order.work_order_type,
      order.included_process_steps,
    );
    const currentIdx = steps.indexOf(order.current_process_step);
    if (currentIdx === -1) return [];
    return steps.slice(currentIdx);
  }

  const allRestrictedSteps = Object.entries(RESTRICTION_BLOCKED_STEPS);
  const nonBlockedActive = activeOrders.filter((o) => !isBlocked(o));

  const absenceDayImpacts: AbsenceDayImpact[] = remainingWorkDays
    .map((day) => {
      const dayStr = toLocalDateKey(day);
      const activeEngineers = filterEngineersStartedOnDateKey(engineers, dayStr);
      const activeEngineerIdSet = new Set(activeEngineers.map((engineer) => engineer.id));

      const absentIds = new Set(
        absences
          .filter((a) => a.absence_date === dayStr && activeEngineerIdSet.has(a.engineer_id))
          .map((a) => a.engineer_id),
      );

      if (absentIds.size === 0) return null;

      const absentEngineers = [...absentIds]
        .map((id) => engineerMap.get(id))
        .filter(Boolean)
        .map((e) => ({ name: e!.name, restrictions: e!.restrictions }));

      const unavailableSteps: string[] = [];
      for (const [restriction, steps] of allRestrictedSteps) {
        const qualifiedEngineers = activeEngineers.filter((e) =>
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
        dateKey: dayStr,
        dateLabel: formatAbsenceDate(day),
        date: day,
        absentEngineers,
        unavailableSteps,
        affectedOrders,
      } as AbsenceDayImpact;
    })
    .filter(Boolean) as AbsenceDayImpact[];

  const absencePeriodImpacts = absenceDayImpacts.reduce<AbsencePeriodImpact[]>(
    (periods, day) => {
      const previous = periods[periods.length - 1];
      const previousDay = previous ? new Date(previous.endDate) : null;
      previousDay?.setDate(previousDay.getDate() + 1);

      const isConsecutive =
        previousDay !== null && toLocalDateKey(previousDay) === day.dateKey;
      const matchesPrevious =
        previous !== undefined &&
        previous.signature === getAbsenceImpactSignature(day);

      if (previous && isConsecutive && matchesPrevious) {
        previous.endDate = day.date;
        previous.dateLabel = formatAbsenceDateRange(
          previous.startDate,
          previous.endDate,
        );
        return periods;
      }

      const signature = getAbsenceImpactSignature(day);

      periods.push({
        key: `${day.dateKey}|${signature}`,
        signature,
        dateLabel: day.dateLabel,
        startDate: day.date,
        endDate: day.date,
        absentEngineers: day.absentEngineers,
        unavailableSteps: day.unavailableSteps,
        affectedOrders: day.affectedOrders,
      });

      return periods;
    },
    [],
  );

  const totalAffectedOrders = new Set(
    absencePeriodImpacts.flatMap((d) =>
      d.affectedOrders.map((o) => o.work_order_id),
    ),
  ).size;
  const hasAbsences = absencePeriodImpacts.length > 0;

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
  const aviationNewsEnabled = shopWallSettings?.aviationNewsEnabled ?? false;

  function openActionConfirmation(
    order: WorkOrder,
    kind: DashboardActionConfirmation["kind"],
  ) {
    setActionConfirmation({ kind, order });
    setRfqCloseMode("awaiting_approval");
    setActionConfirmationStatus("");
    setIsCompletingAction(false);
  }

  function closeActionConfirmation() {
    if (isCompletingAction) return;
    setActionConfirmation(null);
    setActionConfirmationStatus("");
  }

  function isDashboardRfqAction(
    confirmation: DashboardActionConfirmation,
  ): boolean {
    return (
      confirmation.kind === "rfq_sent" ||
      hasActiveRfqSendAction(confirmation.order)
    );
  }

  function actionConfirmationTitle(
    confirmation: DashboardActionConfirmation,
  ): string {
    if (confirmation.kind === "rfq_sent") {
      return `RFQ is sent for ${confirmation.order.work_order_id}?`;
    }

    if (hasActiveCorrectiveAction(confirmation.order)) {
      return `Complete action for ${confirmation.order.work_order_id}?`;
    }

    return `Unblock ${confirmation.order.work_order_id}?`;
  }

  function actionConfirmationPrimaryLabel(
    confirmation: DashboardActionConfirmation,
  ): string {
    return hasActiveCorrectiveAction(confirmation.order) ? "Confirm" : "Unblock";
  }

  async function completeActionConfirmation() {
    if (!actionConfirmation) return;

    setIsCompletingAction(true);
    setActionConfirmationStatus("Saving...");

    const { order } = actionConfirmation;

    const closedAt = new Date().toISOString();
    const hasCorrectiveAction = hasActiveCorrectiveAction(order);
    const isRfqAction = isDashboardRfqAction(actionConfirmation);

    if (!hasCorrectiveAction && !isRfqAction && isRfqRejectedState(order.rfq_state)) {
      setActionConfirmationStatus(
        "This work order is blocked by an AcMP RFQ status and cannot be manually unblocked.",
      );
      setIsCompletingAction(false);
      return;
    }

    if (hasCorrectiveAction) {
      const archiveResult = await archiveCompletedCorrectiveAction(order, closedAt);

      if (archiveResult.error) {
        setActionConfirmationStatus(`Error: ${archiveResult.error.message}`);
        setIsCompletingAction(false);
        return;
      }
    }

    const payload =
      isRfqAction
        ? buildCloseRfqActionPayload({
            mode: rfqCloseMode,
            timestamp: closedAt,
            updateSource: "manual",
          })
        : hasCorrectiveAction
          ? getCorrectiveActionCompletionPayload(closedAt)
          : getManualUnblockPayload(order, closedAt);

    const { error } = await updateWorkOrder(order.work_order_id, payload);

    if (error) {
      setActionConfirmationStatus(`Error: ${error.message}`);
      setIsCompletingAction(false);
      return;
    }

    const blockResult = await syncWorkOrderDataBlockState({
      ...order,
      ...payload,
    });
    if (blockResult.error) {
      console.error(
        `Failed to sync Work Order Data block state for ${order.work_order_id}: ${blockResult.error.message}`,
      );
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

    setActionConfirmation(null);
    setActionConfirmationStatus("");
    setIsCompletingAction(false);
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
    whiteSpace: "normal",
  };

  const modalFieldLabelStyle: React.CSSProperties = {
    color: COLORS.textMuted,
    fontSize: "var(--fs-xs)",
    fontWeight: 800,
    letterSpacing: "0.08em",
    marginBottom: "6px",
    textTransform: "uppercase",
  };

  const cellStyle: React.CSSProperties = {
    padding: "12px 14px",
    fontSize: "13px",
    color: COLORS.text,
    borderBottom: `1px solid ${COLORS.border}`,
    whiteSpace: "normal",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
    lineHeight: 1.45,
  };

  const compactCellStyle: React.CSSProperties = {
    ...cellStyle,
    whiteSpace: "nowrap",
    overflowWrap: "normal",
    wordBreak: "normal",
  };

  const priorityBadgeStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: "38px",
    padding: "3px 8px",
    fontSize: "11px",
    fontWeight: 700,
    borderRadius: "999px",
    color: "white",
    lineHeight: 1.1,
    letterSpacing: 0,
    whiteSpace: "nowrap",
    overflowWrap: "normal",
    wordBreak: "normal",
    flexShrink: 0,
  };

  const detailTableStyle: React.CSSProperties = {
    borderCollapse: "collapse",
    width: "100%",
    minWidth: "var(--dashboard-detail-table-min-width)",
    tableLayout: "fixed",
  };

  const defaultColumnWidths = ["12%", "18%", "12%", "12%", "10%", "16%", "20%"];
  const staleColumnWidths = ["12%", "24%", "18%", "24%", "22%"];
  const readyColumnWidths = ["14%", "30%", "22%", "21%", "13%"];

  function tableActionButtonStyle(tone: "green" | "red"): React.CSSProperties {
    const color = tone === "green" ? COLORS.green : COLORS.red;
    const shadow =
      tone === "green"
        ? "0 7px 16px rgba(5, 150, 105, 0.16)"
        : "0 7px 16px rgba(220, 38, 38, 0.12)";

    return {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "32px",
      padding: "7px 10px",
      fontSize: "12px",
      lineHeight: 1,
      fontWeight: 750,
      border: `1px solid ${color}`,
      borderRadius: "999px",
      cursor: "pointer",
      backgroundColor: color,
      color: "#ffffff",
      whiteSpace: "nowrap",
      boxShadow: shadow,
      transition:
        "transform 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease",
    };
  }

  function setTableActionButtonHover(
    element: HTMLButtonElement,
    tone: "green" | "red",
    active: boolean,
  ) {
    element.style.backgroundColor = active
      ? tone === "green"
        ? "#047857"
        : "#b91c1c"
      : tone === "green"
        ? COLORS.green
        : COLORS.red;
    element.style.transform = active ? "translateY(-1px)" : "translateY(0)";
    element.style.boxShadow = active
      ? tone === "green"
        ? "0 10px 20px rgba(5, 150, 105, 0.22)"
        : "0 10px 20px rgba(220, 38, 38, 0.18)"
      : tone === "green"
        ? "0 7px 16px rgba(5, 150, 105, 0.16)"
        : "0 7px 16px rgba(220, 38, 38, 0.12)";
  }

  function readyStatusBadgeStyle(isRfq: boolean): React.CSSProperties {
    const color = isRfq ? COLORS.blue : COLORS.green;
    const backgroundColor = isRfq ? COLORS.blueSoft : COLORS.greenSoft;
    return {
      display: "inline-flex",
      alignItems: "center",
      gap: "6px",
      maxWidth: "100%",
      padding: "5px 8px",
      borderRadius: "999px",
      border: `1px solid ${color}2f`,
      backgroundColor,
      color,
      fontSize: "12px",
      fontWeight: 750,
      lineHeight: 1.2,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    };
  }

  function readyStatusDotStyle(isRfq: boolean): React.CSSProperties {
    return {
      width: "7px",
      height: "7px",
      borderRadius: "999px",
      backgroundColor: isRfq ? COLORS.blue : COLORS.green,
      flexShrink: 0,
    };
  }

  function renderColumnGroup(widths: string[]) {
    return (
      <colgroup>
        {widths.map((width, index) => (
          <col key={`${width}-${index}`} style={{ width }} />
        ))}
      </colgroup>
    );
  }

  const woLinkStyle: React.CSSProperties = {
    color: COLORS.blue,
    textDecoration: "none",
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
  };

  function renderWorkOrderIdentifier(order: WorkOrder) {
    return (
      <div>
        <Link href={`/office-update?wo=${order.work_order_id}`} style={woLinkStyle}>
          {order.work_order_id}
        </Link>
        <div
          style={{
            marginTop: "4px",
            fontSize: "11px",
            fontWeight: 500,
            color: COLORS.textMuted,
            lineHeight: 1.3,
          }}
        >
          PN: {order.part_number || "â€“"}
        </div>
      </div>
    );
  }

  const sectionCard: React.CSSProperties = {
    backgroundColor: COLORS.surface,
    border: `1px solid ${COLORS.border}`,
    borderRadius: "var(--card-radius)",
    padding: "var(--card-py) var(--card-px)",
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
    minWidth: 0,
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
      <table style={detailTableStyle}>
        {renderColumnGroup(defaultColumnWidths)}
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
          {sorted.map((o, idx) => {
            const tag = priorityTag(o.priority);
            return (
            <tr
              key={o.work_order_id}
              style={{
                backgroundColor:
                  tag === "AOG"
                    ? COLORS.redSoft
                    : tag === "PRIO"
                      ? COLORS.amberSoft
                      : idx % 2 === 0
                        ? COLORS.surface
                        : COLORS.surfaceSubtle,
              }}
            >
              <td style={{ ...cellStyle, fontWeight: 600 }}>
                {renderWorkOrderIdentifier(o)}
              </td>
              <td style={cellStyle}>{o.customer || "–"}</td>
              <td style={cellStyle}>{o.work_order_type || "–"}</td>
              <td style={compactCellStyle}>{formatDate(o.due_date)}</td>
              <td style={compactCellStyle}>
                {tag ? (
                  <span
                    className="mobile-nowrap-token"
                    style={{
                      ...priorityBadgeStyle,
                      backgroundColor:
                        tag === "AOG" ? COLORS.red : COLORS.amber,
                    }}
                  >
                    {tag}
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
            );
          })}

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
      <table style={detailTableStyle}>
        {renderColumnGroup(defaultColumnWidths)}
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
            const hasCorrectiveAction = hasActiveCorrectiveAction(o);
            const displayedHoldReason = getWorkOrderBlockReason(o, {
              rfqSentLabel: RFQ_AWAITING_APPROVAL_REASON,
            });
            const canUnblockOnly =
              !hasCorrectiveAction &&
              (Boolean(o.hold_reason?.trim()) || isRfqManualApprovalBlocked(o));
            const canUseActionButton = !isDone || canUnblockOnly;
            const statusLabel = canUnblockOnly
              ? "Blocked"
              : isDone
                ? "Closed"
                : "Open";
            const statusIsClosed = statusLabel === "Closed";

            return (
              <tr
                key={o.work_order_id}
                style={{
                  backgroundColor: displayedHoldReason !== "–"
                    ? COLORS.amberSoft
                    : idx % 2 === 0
                      ? COLORS.surface
                      : COLORS.surfaceSubtle,
                }}
              >
                <td style={{ ...cellStyle, fontWeight: 600 }}>
                  {renderWorkOrderIdentifier(o)}
                </td>
                <td style={cellStyle}>{o.customer || "–"}</td>
                <td
                  style={{
                    ...cellStyle,
                    fontWeight: displayedHoldReason !== "–" ? 600 : 400,
                  }}
                >
                  {displayedHoldReason}
                </td>
                <td style={cellStyle}>{o.required_next_action || "–"}</td>
                <td style={cellStyle}>{o.action_owner || "–"}</td>
                <td style={cellStyle}>
                  <span
                    className="mobile-nowrap-token"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "3px 10px",
                      fontSize: "11px",
                      fontWeight: 700,
                      borderRadius: "999px",
                      backgroundColor: statusIsClosed ? COLORS.greenSoft : COLORS.amberSoft,
                      color: statusIsClosed ? COLORS.green : COLORS.amber,
                      border: `1px solid ${statusIsClosed ? COLORS.green : COLORS.amber}22`,
                      whiteSpace: "nowrap",
                      overflowWrap: "normal",
                      wordBreak: "normal",
                    }}
                  >
                    {statusLabel}
                  </span>
                </td>
                <td style={cellStyle}>
                  {canUseActionButton && (
                    <button
                      onClick={() => openActionConfirmation(o, "close_action")}
                      style={tableActionButtonStyle("red")}
                      onMouseEnter={(e) => {
                        setTableActionButtonHover(e.currentTarget, "red", true);
                      }}
                      onMouseLeave={(e) => {
                        setTableActionButtonHover(e.currentTarget, "red", false);
                      }}
                    >
                      {hasCorrectiveAction ? "Close action" : "Unblock"}
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
      <table style={detailTableStyle}>
        {renderColumnGroup(readyColumnWidths)}
        <thead>
          <tr>
            <th style={headerStyle}>WO</th>
            <th style={headerStyle}>Customer</th>
            <th style={headerStyle}>Type</th>
            <th style={headerStyle}>Status</th>
            <th style={headerStyle}></th>
          </tr>
        </thead>
        <tbody>
          {list.map((o, idx) => {
            const isRfq = hasActiveRfqSendAction(o);
            const statusLabel =
              o.current_process_step === READY_TO_CLOSE_STEP
                ? "Ready to close"
                : "Ready to send RFQ";

            return (
              <tr
                key={o.work_order_id}
                style={{
                  backgroundColor:
                    idx % 2 === 0 ? COLORS.surface : COLORS.surfaceSubtle,
                }}
              >
                <td style={{ ...cellStyle, fontWeight: 600 }}>
                  {renderWorkOrderIdentifier(o)}
                </td>
                <td style={cellStyle}>{o.customer || "–"}</td>
                <td style={cellStyle}>{o.work_order_type || "–"}</td>
                <td style={cellStyle}>
                  <span style={readyStatusBadgeStyle(isRfq)}>
                    <span style={readyStatusDotStyle(isRfq)} />
                    {statusLabel}
                  </span>
                </td>
                <td style={{ ...cellStyle, textAlign: "right" }}>
                  {isRfq ? (
                    <button
                      onClick={() => openActionConfirmation(o, "rfq_sent")}
                      style={tableActionButtonStyle("green")}
                      onMouseEnter={(e) => {
                        setTableActionButtonHover(e.currentTarget, "green", true);
                      }}
                      onMouseLeave={(e) => {
                        setTableActionButtonHover(e.currentTarget, "green", false);
                      }}
                    >
                      RFQ is sent
                    </button>
                  ) : (
                    <span style={{ color: COLORS.textMuted }}>–</span>
                  )}
                </td>
              </tr>
            );
          })}

          {list.length === 0 && (
            <tr>
              <td
                colSpan={5}
                style={{ ...cellStyle, textAlign: "center", color: COLORS.textMuted, padding: "32px" }}
              >
                No orders ready to close or RFQs ready to send
              </td>
            </tr>
          )}
        </tbody>
      </table>
    );
  }

  function renderStaleTable(list: WorkOrder[]) {
    return (
      <table style={detailTableStyle}>
        {renderColumnGroup(staleColumnWidths)}
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
                  {renderWorkOrderIdentifier(o)}
                </td>
                <td style={cellStyle}>{o.customer || "–"}</td>
                <td style={cellStyle}>
                  {normalizeAssignedPersonTeam(o.assigned_person_team)}
                </td>
                <td style={cellStyle}>{o.current_process_step || "–"}</td>
                <td style={compactCellStyle}>{formatDate(last)}</td>
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
      title: "Ready to close / ready to send RFQ",
      count: readyPanelOrders.length,
      accent: COLORS.green,
      data: readyPanelOrders,
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

  const dropboxStatusPalette = {
    info: {
      color: COLORS.textSoft,
      backgroundColor: COLORS.surface,
      borderColor: COLORS.borderStrong,
    },
    success: {
      color: COLORS.green,
      backgroundColor: COLORS.greenSoft,
      borderColor: "#a7f3d0",
    },
    error: {
      color: COLORS.red,
      backgroundColor: COLORS.redSoft,
      borderColor: "#fecaca",
    },
  }[dropboxStatusTone];

  return (
    <main
      style={{
        minHeight: "100vh",
        backgroundColor: COLORS.pageBg,
        padding: "var(--layout-page-py) var(--layout-page-px) var(--layout-page-px)",
        fontFamily: FONT_STACK,
        color: COLORS.text,
      }}
    >
      <div style={{ width: "100%", maxWidth: "var(--layout-content-max-w)", marginInline: "auto" }}>
        <PageHeader
          eyebrow="Aircraft & Component MRO's Wheels & Brake Shop"
          title="Planning & Monitoring Tool"
          description="Live control of work order flow, blockers, readiness, and capacity."
          actions={
            <div
              style={{
                display: "grid",
                gap: "6px",
                justifyItems: "end",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "flex-end",
                  gap: "var(--gap-tight)",
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  aria-label="Check Dropbox for new AcMP export"
                  title="Check Dropbox for new AcMP export"
                  disabled={dropboxBusy}
                  onClick={() => void checkDropboxNow()}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    minHeight: "34px",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    backgroundColor: COLORS.surface,
                    color: COLORS.blue,
                    border: `1px solid ${COLORS.borderStrong}`,
                    fontSize: "13px",
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                    cursor: dropboxBusy ? "wait" : "pointer",
                    fontFamily: FONT_STACK,
                  }}
                >
                  <RefreshCw size={15} strokeWidth={2.2} />
                  Check AcMP export
                </button>

                {dropboxStatus && (
                  <span
                    role="status"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      minHeight: "34px",
                      maxWidth: "360px",
                      padding: "7px 10px",
                      borderRadius: "8px",
                      backgroundColor: dropboxStatusPalette.backgroundColor,
                      color: dropboxStatusPalette.color,
                      border: `1px solid ${dropboxStatusPalette.borderColor}`,
                      fontSize: "13px",
                      fontWeight: 700,
                      lineHeight: 1.25,
                      whiteSpace: "normal",
                      overflowWrap: "anywhere",
                      fontFamily: FONT_STACK,
                    }}
                  >
                    {dropboxStatus}
                  </span>
                )}

                {dropboxCandidates.length > 0 && (
                  <button
                    type="button"
                    disabled={dropboxBusy}
                    onClick={() => void importDropboxNow()}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      minHeight: "34px",
                      padding: "8px 12px",
                      borderRadius: "8px",
                      border: "none",
                      backgroundColor: COLORS.blue,
                      color: "white",
                      fontWeight: 700,
                      cursor: dropboxBusy ? "wait" : "pointer",
                      fontSize: "13px",
                      fontFamily: FONT_STACK,
                      whiteSpace: "nowrap",
                    }}
                  >
                    Import now
                  </button>
                )}

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
                    minHeight: "34px",
                    padding: "8px 14px",
                    borderRadius: "8px",
                    backgroundColor: health.bg,
                    color: health.color,
                    border: `1px solid ${health.color}33`,
                    fontSize: "13px",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
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
                  </span>
                </button>
              </div>

              <div
                style={{
                  display: "grid",
                  gap: "5px",
                  justifyItems: "end",
                }}
              >
                <button
                  type="button"
                  onClick={() => void toggleAviationNewsForWall()}
                  disabled={shopWallSettingsBusy}
                  aria-pressed={aviationNewsEnabled}
                  title={
                    aviationNewsEnabled
                      ? "Turn Luchtvaartnieuws off on the wall"
                      : "Turn Luchtvaartnieuws on on the wall"
                  }
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    minHeight: "34px",
                    padding: "7px 11px",
                    borderRadius: "8px",
                    border: `1px solid ${
                      aviationNewsEnabled ? "#1350a3" : COLORS.border
                    }`,
                    backgroundColor: aviationNewsEnabled
                      ? "#eff6ff"
                      : COLORS.surface,
                    color: aviationNewsEnabled ? "#1350a3" : COLORS.textSoft,
                    boxShadow: aviationNewsEnabled
                      ? "0 8px 18px rgba(19, 80, 163, 0.10)"
                      : "0 1px 2px rgba(15, 23, 42, 0.04)",
                    cursor: shopWallSettingsBusy ? "wait" : "pointer",
                    fontSize: "12px",
                    fontWeight: 750,
                    whiteSpace: "nowrap",
                    fontFamily: FONT_STACK,
                  }}
                >
                  <Newspaper size={15} strokeWidth={2.2} />
                  Luchtvaartnieuws
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      minWidth: "34px",
                      padding: "2px 7px",
                      borderRadius: "999px",
                      backgroundColor: aviationNewsEnabled
                        ? "#1350a3"
                        : COLORS.surfaceSubtle,
                      color: aviationNewsEnabled ? "#ffffff" : COLORS.textMuted,
                      border: aviationNewsEnabled
                        ? "1px solid #1350a3"
                        : `1px solid ${COLORS.border}`,
                      fontSize: "10px",
                      fontWeight: 850,
                      letterSpacing: "0.04em",
                    }}
                  >
                    {aviationNewsEnabled ? "ON" : "OFF"}
                  </span>
                </button>

                {shopWallSettingsStatus && (
                  <div
                    style={{
                      maxWidth: "230px",
                      color: shopWallSettingsStatus.startsWith(
                        "Wall setting error",
                      )
                        ? COLORS.red
                        : COLORS.textMuted,
                      fontSize: "11px",
                      fontWeight: 650,
                      lineHeight: 1.25,
                      textAlign: "right",
                    }}
                  >
                    {shopWallSettingsStatus}
                  </div>
                )}
              </div>
            </div>
          }
        />

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "var(--dashboard-summary-grid)",
            gap: "var(--gap-default)",
            marginBottom: "var(--gap-section)",
          }}
        >
          {/* Capacity — single source of truth */}
          <div
            style={{
              minWidth: 0,
              padding: "var(--card-py) var(--card-px)",
              backgroundColor: COLORS.surface,
              border: `1px solid ${COLORS.border}`,
              borderLeft: `3px solid ${capacityColor}`,
              borderRadius: "var(--card-radius)",
              boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: "var(--gap-default)",
                marginBottom: "10px",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  className="dashboard-meta-label"
                  style={{
                    color: COLORS.textMuted,
                    marginBottom: "6px",
                  }}
                >
                  Week Capacity
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: "8px",
                    flexWrap: "wrap",
                  }}
                >
                  <div
                    style={{
                      fontSize: "var(--fs-display-lg)",
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
                    className="dashboard-capacity-detail"
                    style={{
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
                fontSize: "var(--fs-display)",
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
                fontSize: "var(--fs-display)",
                fontWeight: 700,
                letterSpacing: "-0.03em",
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
                color: COLORS.blue,
              }}
            >
              <AnimatedNumber value={todayPresentEngineers.length} />
            </div>
          </StatTile>
        </section>

        {/* KPI GRID — 6 clickable cards */}
        <section style={{ marginBottom: "var(--gap-section)" }}>
          <div
            className="dashboard-meta-label"
            style={{
              color: COLORS.textMuted,
              marginBottom: "8px",
              paddingLeft: "4px",
            }}
          >
            Overview
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "var(--dashboard-kpi-grid)",
              gap: "var(--gap-default)",
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
              label={openActions.length === 1 ? "Open action" : "Open actions"}
              value={openActions.length}
              color={COLORS.amber}
              active={activePanel === "actions"}
              onClick={() => togglePanel("actions")}
            />
            <KpiCard
              label="Ready to close / ready to send RFQ"
              value={readyPanelOrders.length}
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
            gridTemplateColumns: "var(--dashboard-main-grid)",
            gap: "var(--gap-default)",
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
                    gap: "var(--gap-default)",
                    marginBottom: "var(--gap-default)",
                    paddingBottom: "2px",
                    flexWrap: "wrap",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        width: "3px",
                        height: "18px",
                        backgroundColor: panelConfig[activePanel].accent,
                        borderRadius: "2px",
                        flexShrink: 0,
                      }}
                    />
                    <h3
                      style={{
                        margin: 0,
                        fontSize: "var(--fs-heading)",
                        fontWeight: 700,
                        color: COLORS.heading,
                        letterSpacing: "-0.01em",
                      }}
                    >
                      {panelConfig[activePanel].title}
                    </h3>
                    <span
                      style={{
                        padding: "2px 8px",
                        fontSize: "var(--fs-xs)",
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
                      fontSize: "var(--fs-sm)",
                      cursor: "pointer",
                      color: COLORS.textSoft,
                      padding: "5px 10px",
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
                  padding: "36px 20px",
                  textAlign: "center",
                  color: COLORS.textMuted,
                  fontSize: "var(--fs-body)",
                }}
              >
                <div
                  style={{
                    fontSize: "var(--fs-md)",
                    fontWeight: 600,
                    color: COLORS.textSoft,
                    marginBottom: "4px",
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
                gap: "10px",
                marginBottom: "var(--gap-default)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: "var(--fs-meta)",
                    fontWeight: 600,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: COLORS.textMuted,
                    marginBottom: "4px",
                  }}
                >
                  Staff Availability
                </div>
                <h3
                  style={{
                    margin: 0,
                    fontSize: "var(--fs-heading)",
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
                    padding: "3px 8px",
                    borderRadius: "999px",
                    backgroundColor: COLORS.redSoft,
                    color: COLORS.red,
                    fontSize: "var(--fs-xs)",
                    fontWeight: 700,
                    border: `1px solid ${COLORS.red}22`,
                    whiteSpace: "nowrap",
                    flexShrink: 0,
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
                {absencePeriodImpacts.map((absence) => {
                  const isExpanded = expandedDays.has(absence.key);
                  const hasImpact = absence.affectedOrders.length > 0;

                  return (
                    <div
                      key={absence.key}
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
                          {absence.dateLabel}
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
                        Absent: {absence.absentEngineers.map((e) => e.name).join(", ")}
                      </div>

                      {absence.unavailableSteps.length > 0 && (
                        <div
                          style={{
                            marginTop: "8px",
                            fontSize: "12px",
                            color: COLORS.red,
                            fontWeight: 600,
                          }}
                        >
                          No qualified engineer for: {absence.unavailableSteps.join(", ")}
                        </div>
                      )}

                      {hasImpact && (
                        <button
                          onClick={() => {
                            setExpandedDays((prev) => {
                              const next = new Set(prev);
                              if (next.has(absence.key)) {
                                next.delete(absence.key);
                              } else {
                                next.add(absence.key);
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
                          <AnimatedNumber value={absence.affectedOrders.length} />{" "}
                          {absence.affectedOrders.length === 1 ? "order" : "orders"} at risk
                        </button>
                      )}

                      {hasImpact && isExpanded && (
                        <div style={{ marginTop: "10px" }}>
                          {absence.affectedOrders.map((o) => (
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

                      {absence.unavailableSteps.length === 0 && (
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

      {actionConfirmation && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(31, 41, 55, 0.28)",
            display: "grid",
            placeItems: "center",
            padding: "24px",
            zIndex: 70,
          }}
          onMouseDown={closeActionConfirmation}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "640px",
              backgroundColor: "#fcfaf6",
              border: `1px solid ${COLORS.borderStrong}`,
              borderRadius: "18px",
              boxShadow: "0 20px 50px rgba(31, 41, 55, 0.18)",
              padding: "18px",
            }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div style={{ marginBottom: "14px" }}>
              <div
                style={{
                  color: COLORS.textMuted,
                  fontSize: "var(--fs-xs)",
                  fontWeight: 800,
                  letterSpacing: "0.08em",
                  marginBottom: "6px",
                  textTransform: "uppercase",
                }}
              >
                Confirm action
              </div>
              <h2
                style={{
                  margin: 0,
                  color: COLORS.heading,
                  fontSize: "var(--fs-title)",
                  fontWeight: 750,
                  letterSpacing: "-0.02em",
                  lineHeight: 1.15,
                }}
              >
                {actionConfirmationTitle(actionConfirmation)}
              </h2>
            </div>

            <div
              style={{
                display: "grid",
                gap: "12px",
                padding: "16px",
                border: `1px solid ${COLORS.border}`,
                borderRadius: "14px",
                backgroundColor: COLORS.surface,
              }}
            >
              <div>
                <div style={modalFieldLabelStyle}>Hold reason</div>
                <div style={{ color: COLORS.text, fontSize: "15px" }}>
                  {getWorkOrderBlockReason(actionConfirmation.order, {
                    rfqSentLabel: RFQ_AWAITING_APPROVAL_REASON,
                  })}
                </div>
              </div>

              <div>
                <div style={modalFieldLabelStyle}>Action</div>
                <div style={{ color: COLORS.text, fontSize: "15px" }}>
                  {actionConfirmation.order.required_next_action || "–"}
                </div>
              </div>

              <div>
                <div style={modalFieldLabelStyle}>After completion</div>
                {isDashboardRfqAction(actionConfirmation) ? (
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    {[
                      ["awaiting_approval", `Blocked: ${RFQ_AWAITING_APPROVAL_REASON}`],
                      ["continue", "Open: Engineers can continue working"],
                    ].map(([mode, label]) => {
                      const selected = rfqCloseMode === mode;
                      return (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setRfqCloseMode(mode as RfqCloseMode)}
                          style={{
                            padding: "8px 12px",
                            borderRadius: "10px",
                            border: `1px solid ${
                              selected ? COLORS.blue : COLORS.borderStrong
                            }`,
                            backgroundColor: selected
                              ? COLORS.blueSoft
                              : COLORS.surface,
                            color: selected ? COLORS.blue : COLORS.text,
                            cursor: "pointer",
                            fontSize: "var(--fs-sm)",
                            fontWeight: 750,
                          }}
                          disabled={isCompletingAction}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <span style={readyStatusBadgeStyle(false)}>
                    <span style={readyStatusDotStyle(false)} />
                    Open
                  </span>
                )}
              </div>

              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: "10px",
                  border: `1px solid ${COLORS.red}`,
                  backgroundColor: COLORS.redSoft,
                  color: COLORS.red,
                  fontSize: "13px",
                  fontWeight: 700,
                  lineHeight: 1.45,
                }}
              >
                Are you sure you want to do this? This updates the block state
                immediately
                {isDashboardRfqAction(actionConfirmation)
                  ? " and should only be used after RFQ approval/payment is confirmed."
                  : "."}
              </div>

              {actionConfirmationStatus && (
                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: `1px solid ${
                      actionConfirmationStatus.startsWith("Error:")
                        ? COLORS.red
                        : COLORS.border
                    }`,
                    backgroundColor: actionConfirmationStatus.startsWith("Error:")
                      ? COLORS.redSoft
                      : COLORS.surfaceSubtle,
                    color: actionConfirmationStatus.startsWith("Error:")
                      ? COLORS.red
                      : COLORS.textSoft,
                    fontSize: "13px",
                    fontWeight: 700,
                  }}
                >
                  {actionConfirmationStatus}
                </div>
              )}
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "10px",
                marginTop: "14px",
              }}
            >
              <button
                type="button"
                onClick={closeActionConfirmation}
                style={{
                  padding: "9px 14px",
                  borderRadius: "10px",
                  border: `1px solid ${COLORS.borderStrong}`,
                  backgroundColor: COLORS.surface,
                  color: COLORS.text,
                  cursor: "pointer",
                  fontSize: "var(--fs-body)",
                  fontWeight: 750,
                }}
                disabled={isCompletingAction}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void completeActionConfirmation()}
                style={{
                  padding: "9px 16px",
                  borderRadius: "10px",
                  border: `1px solid ${COLORS.blue}`,
                  backgroundColor: COLORS.blue,
                  color: "#ffffff",
                  cursor: "pointer",
                  fontSize: "var(--fs-body)",
                  fontWeight: 750,
                  boxShadow: "0 8px 20px rgba(37, 85, 199, 0.18)",
                }}
                disabled={isCompletingAction}
              >
                {actionConfirmationPrimaryLabel(actionConfirmation)}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function DashboardPage() {
  return (
    <RequireRole allowedRoles={["office"]}>
      <DashboardPageContent />
    </RequireRole>
  );
}
// noah was hier
