"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import { RequireRole } from "@/app/components/require-role";
import { PageHeader } from "@/app/components/page-header";
import {
  PROCESS_STEP_SHORT_LABELS,
  READY_TO_CLOSE_STEP,
  getShortProcessStepLabel,
  resolveStepsForOrder,
} from "@/lib/process-steps";
import { STEP_WEIGHTS } from "@/lib/capacity";
import {
  DEFAULT_ASSIGNED_PERSON_TEAM,
  applyTodayQualificationBlocks,
  blockReason,
  formatDate,
  getCorrectiveActionCompletionPayload,
  getCorrectiveActionContext,
  hasActiveCorrectiveAction,
  isBlocked,
  isStale,
  latestUpdate,
  localDateKey,
  normalizeAssignedPersonTeam,
  priorityTag,
  sortOrders,
} from "@/lib/work-order-rules";
import { applySuggestedAssignmentsForCurrentStep } from "@/lib/auto-assign";
import { getEngineerAbsences, getEngineers } from "@/lib/engineers";
import { getWorkOrders, updateWorkOrderAndFetch } from "@/lib/work-orders";
import {
  ExtraAction,
  deleteExtraAction,
  getExtraActions,
  sortExtraActionsByDueDate,
  updateExtraActionAndFetch,
} from "@/lib/extra-actions";

type WorkOrder = {
  work_order_id: string;
  customer: string | null;
  part_number: string | null;
  work_order_type: string | null;
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
  included_process_steps: string[] | null;
};

type StaffMember = {
  id: number;
  name: string;
  restrictions: string[] | null;
  employment_start_date?: string | null;
};

type QuickEditState = {
  workOrderId: string;
  blocked: boolean;
  field: "due_date" | "assigned_person_team";
};

type QuickEditForm = {
  due_date: string;
  assigned_person_team: string;
};

type Absence = {
  engineer_id: number;
  absence_date: string;
};

const WORK_ORDER_SELECT =
  "work_order_id, customer, part_number, work_order_type, due_date, priority, assigned_person_team, current_process_step, hold_reason, rfq_state, required_next_action, action_owner, action_status, action_closed, last_manual_update, last_system_update, included_process_steps";

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
  red: "#b42318",
  redSoft: "#fff2ef",
  redBorder: "#efc6bf",
  orange: "#b45309",
  orangeSoft: "#fff6e8",
  orangeBorder: "#ead1a6",
  blue: "#2555c7",
  blueSoft: "#eef3ff",
  blueBorder: "#d7e3ff",
  shadow: "0 1px 2px rgba(31, 41, 55, 0.04), 0 4px 12px rgba(31, 41, 55, 0.04)",
  radius: "14px",
};

function toneStyles(tone: "green" | "red" | "slate") {
  if (tone === "green") {
    return { color: "#166534", backgroundColor: "#eef9f1", borderColor: "#cfe5d6" };
  }

  if (tone === "red") {
    return { color: ui.red, backgroundColor: ui.redSoft, borderColor: ui.redBorder };
  }

  return { color: ui.text, backgroundColor: ui.surfaceSoft, borderColor: ui.border };
}

const surfaceCardStyle: React.CSSProperties = {
  backgroundColor: ui.surface,
  border: `1px solid ${ui.border}`,
  borderRadius: ui.radius,
  boxShadow: ui.shadow,
};

const sectionCardStyle: React.CSSProperties = {
  ...surfaceCardStyle,
  padding: "var(--card-py) var(--card-px)",
  minWidth: 0,
};

const secondarySectionStyle: React.CSSProperties = {
  ...surfaceCardStyle,
  padding: "var(--card-py) var(--card-px)",
  backgroundColor: ui.surfaceMuted,
  minWidth: 0,
};

const sectionHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "var(--gap-default)",
  marginBottom: "10px",
};

const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "var(--fs-heading)",
  fontWeight: 650,
  color: ui.text,
  letterSpacing: "-0.015em",
};

const sectionDescriptionStyle: React.CSSProperties = {
  margin: "2px 0 0",
  fontSize: "var(--fs-body)",
  color: ui.muted,
  lineHeight: 1.5,
};

const badgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  padding: "3px 8px",
  borderRadius: "999px",
  border: `1px solid ${ui.border}`,
  fontSize: "var(--fs-sm)",
  fontWeight: 650,
  lineHeight: 1.2,
  whiteSpace: "nowrap",
};

const countBadgeMutedStyle: React.CSSProperties = {
  ...badgeStyle,
  color: ui.muted,
  backgroundColor: ui.surfaceSoft,
  borderColor: ui.border,
};

const countBadgeRedStyle: React.CSSProperties = {
  ...badgeStyle,
  color: ui.red,
  backgroundColor: ui.redSoft,
  borderColor: ui.redBorder,
};

const countBadgeOpenStyle: React.CSSProperties = {
  ...badgeStyle,
  ...toneStyles("green"),
};

const woBadgeBase: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "1px 6px",
  borderRadius: "6px",
  fontSize: "10px",
  fontWeight: 700,
  letterSpacing: "0.04em",
  lineHeight: 1.4,
  border: "1px solid transparent",
};

const aogBadgeStyle: React.CSSProperties = {
  ...woBadgeBase,
  color: ui.red,
  backgroundColor: ui.redSoft,
  borderColor: ui.redBorder,
};

const prioBadgeStyle: React.CSSProperties = {
  ...woBadgeBase,
  color: ui.orange,
  backgroundColor: ui.orangeSoft,
  borderColor: ui.orangeBorder,
};

const typeBadgeStyle: React.CSSProperties = {
  ...woBadgeBase,
  color: ui.muted,
  backgroundColor: ui.surfaceSoft,
  borderColor: ui.border,
  textTransform: "uppercase",
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
  padding: "8px 12px",
  borderBottom: `1px solid ${ui.border}`,
  fontSize: "var(--fs-body)",
  lineHeight: 1.45,
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
  fontSize: "var(--fs-sm)",
  letterSpacing: "0.02em",
  position: "sticky",
  top: 0,
  zIndex: 1,
};

const roundedTableHeaderStyle = (position: "left" | "right"): React.CSSProperties => ({
  borderTopLeftRadius: position === "left" ? "10px" : 0,
  borderTopRightRadius: position === "right" ? "10px" : 0,
});

const mutedCellStyle: React.CSSProperties = {
  ...tableCellStyle,
  color: ui.muted,
};

const blockedTableWrapStyle: React.CSSProperties = {
  ...tableWrapStyle,
  borderColor: ui.redBorder,
  backgroundColor: "#fff9f7",
};

const inlineEditButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "22px",
  height: "22px",
  marginLeft: "6px",
  borderRadius: "999px",
  border: `1px solid ${ui.border}`,
  backgroundColor: ui.surfaceSoft,
  color: ui.muted,
  cursor: "pointer",
};

const inlineActionButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  marginTop: "8px",
  padding: "6px 14px",
  minWidth: "112px",
  borderRadius: "999px",
  border: `1px solid ${ui.redBorder}`,
  backgroundColor: ui.redSoft,
  color: ui.red,
  fontSize: "var(--fs-sm)",
  fontWeight: 700,
  whiteSpace: "nowrap",
  cursor: "pointer",
};

const extraActionsDescriptionColumnStyle: React.CSSProperties = {
  width: "68%",
};

const extraActionsResponsibleColumnStyle: React.CSSProperties = {
  width: "14%",
};

const extraActionsDueDateColumnStyle: React.CSSProperties = {
  width: "10%",
};

const extraActionsActionColumnStyle: React.CSSProperties = {
  width: "8%",
};

const extraActionsTextCellStyle: React.CSSProperties = {
  overflowWrap: "normal",
  wordBreak: "normal",
  whiteSpace: "normal",
};

const modalBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  backgroundColor: "rgba(31, 41, 55, 0.28)",
  display: "grid",
  placeItems: "center",
  padding: "20px",
  zIndex: 60,
};

const modalCardStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: "520px",
  backgroundColor: "#fcfaf6",
  border: `1px solid ${ui.borderStrong}`,
  borderRadius: "18px",
  boxShadow: "0 20px 50px rgba(31, 41, 55, 0.18)",
  padding: "16px",
};

const modalInnerCardStyle: React.CSSProperties = {
  backgroundColor: ui.surface,
  border: `1px solid ${ui.border}`,
  borderRadius: "14px",
  padding: "13px",
};

const modalInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: `1px solid ${ui.borderStrong}`,
  borderRadius: "10px",
  fontSize: "var(--fs-body)",
  lineHeight: 1.4,
  boxSizing: "border-box",
  backgroundColor: "#fffdf9",
  color: ui.text,
  minHeight: "36px",
  outline: "none",
};

const modalEyebrowStyle: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: ui.mutedSoft,
  marginBottom: "6px",
};

const modalTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "var(--fs-title)",
  fontWeight: 750,
  letterSpacing: "-0.025em",
  color: ui.text,
  lineHeight: 1.1,
};

const modalActionButtonStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: "10px",
  border: `1px solid ${ui.borderStrong}`,
  backgroundColor: ui.surface,
  color: ui.text,
  fontSize: "var(--fs-body)",
  fontWeight: 700,
  cursor: "pointer",
};

const modalPrimaryButtonStyle: React.CSSProperties = {
  ...modalActionButtonStyle,
  borderColor: ui.blue,
  backgroundColor: ui.blue,
  color: "#ffffff",
  boxShadow: "0 8px 20px rgba(37, 85, 199, 0.18)",
};

function isOverdue(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const due = new Date(dateStr);
  if (Number.isNaN(due.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

function WorkOrderCell({ order }: { order: WorkOrder }) {
  const priority = priorityTag(order.priority);

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        fontWeight: 600,
      }}
    >
      <span>{order.work_order_id}</span>
      {priority === "AOG" && <span style={aogBadgeStyle}>AOG</span>}
      {priority === "PRIO" && <span style={prioBadgeStyle}>PRIO</span>}
    </span>
  );
}

function DueDateCell({ value }: { value: string | null }) {
  const overdue = isOverdue(value);
  return (
    <span style={overdue ? { color: ui.red, fontWeight: 600 } : undefined}>
      {formatDate(value)}
    </span>
  );
}

function LastUpdateCell({ value }: { value: string | null }) {
  return (
    <>
      {formatDate(value)}
      {isStale(value) && (
        <span className="stale-warning">
          ⚠
          <span className="stale-tooltip">Not updated in over 2 weeks</span>
        </span>
      )}
    </>
  );
}

type TimelineSegment = {
  name: string;
  shortName: string;
  weight: number;
  share: number;
  state: "completed" | "current" | "upcoming";
};

/** Labels stay selective so the timeline reads as an operational control, not a caption list. */
const SEGMENT_LABEL_MIN_SHARE = 0.03;
const EDGE_SEGMENT_LABEL_MIN_SHARE = 0.025;
const CURRENT_SEGMENT_LABEL_MIN_SHARE = 0.03;

function getTimelineTrackTemplate(segments: TimelineSegment[]): string {
  return segments
    .map((segment) => {
      const trackShare = Math.max(segment.share, 0.001);
      return `minmax(0, ${trackShare}fr)`;
    })
    .join(" ");
}

function buildTimelineSegments(order: WorkOrder): TimelineSegment[] {
  if (!order.work_order_type) return [];
  const includedSteps = resolveStepsForOrder(
    order.work_order_type,
    order.included_process_steps,
  );
  if (includedSteps.length === 0) return [];

  const weights = STEP_WEIGHTS[order.work_order_type] || {};
  const currentIdx = order.current_process_step
    ? includedSteps.indexOf(order.current_process_step)
    : -1;

  const resolved = includedSteps.map((step: string) => {
    const rawWeight = weights[step];
    const weight = rawWeight && rawWeight > 0 ? rawWeight : 0.03;
    return { step, weight };
  });
  const totalWeight = resolved.reduce(
    (sum: number, s: { step: string; weight: number }) => sum + s.weight,
    0,
  ) || 1;

  return resolved.map(({ step, weight }: { step: string; weight: number }, idx: number) => {
    const state: TimelineSegment["state"] =
      currentIdx === -1
        ? "upcoming"
        : idx < currentIdx
          ? "completed"
          : idx === currentIdx
            ? "current"
            : "upcoming";

    return {
      name: step,
      shortName: getShortProcessStepLabel(step),
      weight,
      share: weight / totalWeight,
      state,
    };
  });
}

const timelineCompletedBg = "#d5e8db";
const timelineCompletedBorder = "#b1d2bb";
const timelineCompletedInk = "#166534";
const timelineLegendEntries = [
  "Intake",
  "Disassembly",
  "Cleaning",
  "Paint Stripping",
  "Penetrant Testing",
  "Magnetic Test",
  "Eddy Current",
  "Inspection",
  "Painting",
  "Assembly",
].map((step) => ({
  step,
  shortLabel: PROCESS_STEP_SHORT_LABELS[step] || step,
}));

const timelineRowBaseStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(210px, 238px) minmax(0, 1fr)",
  columnGap: "16px",
  rowGap: "8px",
  padding: "11px 14px",
  borderRadius: "10px",
  border: `1px solid ${ui.border}`,
  backgroundColor: ui.surface,
  alignItems: "center",
};

const timelineRowBlockedStyle: React.CSSProperties = {
  ...timelineRowBaseStyle,
  borderColor: ui.redBorder,
  backgroundColor: "#fff9f7",
};

function shouldShowTimelineLabel(
  segment: TimelineSegment,
  index: number,
  total: number,
): boolean {
  if (segment.state === "current") {
    return true;
  }

  if (segment.shortName.length <= 3) {
    return segment.share >= 0.02 || total <= 12;
  }

  if (segment.share >= SEGMENT_LABEL_MIN_SHARE) {
    return true;
  }

  return (
    (index === 0 || index === total - 1) &&
    segment.share >= EDGE_SEGMENT_LABEL_MIN_SHARE
  );
}

function getTimelineLabelFontSize(segment: TimelineSegment): string {
  const labelLength = segment.state === "current" ? segment.name.length : segment.shortName.length;
  const estimatedCapacity =
    segment.state === "current"
      ? Math.max(4, Math.round(segment.share * 120))
      : Math.max(3, Math.round(segment.share * 160));

  if (labelLength <= estimatedCapacity) {
    return "10px";
  }

  if (labelLength <= estimatedCapacity + 2) {
    return "9px";
  }

  if (segment.share < 0.045 || labelLength >= 11) {
    return "8px";
  }

  return "9px";
}

function WorkOrderTimelineRow({
  order,
  blocked,
}: {
  order: WorkOrder;
  blocked: boolean;
}) {
  const segments = buildTimelineSegments(order);
  const timelineTrackTemplate = getTimelineTrackTemplate(segments);
  const priority = priorityTag(order.priority);
  const overdue = isOverdue(order.due_date);

  const reason = blocked
    ? blockReason(order, { rfqSentLabel: "Waiting for RFQ Approval" })
    : null;
  const correctiveAction = getCorrectiveActionContext(order);
  const hasCorrective = hasActiveCorrectiveAction(order);
  const currentInk = blocked ? ui.red : ui.blue;

  return (
    <article
      className="planning-timeline-row"
      style={blocked ? timelineRowBlockedStyle : timelineRowBaseStyle}
    >
      {/* Left column: metadata */}
      <div
        style={{
          display: "grid",
          gap: "3px",
          minWidth: 0,
          alignContent: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "14px",
            fontWeight: 650,
            color: ui.text,
            letterSpacing: "-0.01em",
          }}
        >
          <span>{order.work_order_id}</span>
          {priority === "AOG" && <span style={aogBadgeStyle}>AOG</span>}
          {priority === "PRIO" && <span style={prioBadgeStyle}>PRIO</span>}
        </div>
        <div style={{ fontSize: "12px", color: ui.text, overflowWrap: "anywhere" }}>
          {order.customer || "–"}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            flexWrap: "wrap",
            fontSize: "11px",
            color: ui.muted,
            fontVariantNumeric: "tabular-nums",
            overflowWrap: "anywhere",
          }}
        >
          PN {order.part_number || "–"}
        </div>
        {order.work_order_type && (
          <div style={{ marginTop: "1px" }}>
            <span style={typeBadgeStyle}>{order.work_order_type}</span>
          </div>
        )}
        <div
          style={{
            fontSize: "12px",
            color: overdue ? ui.red : ui.muted,
            fontWeight: overdue ? 650 : 500,
            marginTop: order.work_order_type ? "1px" : 0,
          }}
        >
          Due {formatDate(order.due_date)}
        </div>
      </div>

      {/* Right column: timeline */}
      <div
        style={{
          display: "grid",
          gap: "4px",
          minWidth: 0,
          alignContent: "center",
          paddingLeft: "14px",
          borderLeft: `1px solid ${blocked ? ui.redBorder : ui.border}`,
        }}
      >
        {segments.length > 0 ? (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: timelineTrackTemplate,
                gap: "3px",
                width: "100%",
                alignItems: "start",
              }}
            >
              {segments.map((segment, index) => {
                let backgroundColor = ui.surfaceSoft;
                let borderStyle = `1px dashed ${ui.border}`;
                if (segment.state === "completed") {
                  backgroundColor = timelineCompletedBg;
                  borderStyle = `1px solid ${timelineCompletedBorder}`;
                } else if (segment.state === "current") {
                  backgroundColor = currentInk;
                  borderStyle = `1px solid ${currentInk}`;
                }

                const color =
                  segment.state === "current"
                    ? currentInk
                    : segment.state === "completed"
                      ? timelineCompletedInk
                      : ui.mutedSoft;
                const showLabel = shouldShowTimelineLabel(segment, index, segments.length);
                const labelFontSize = getTimelineLabelFontSize(segment);
                return (
                  <div
                    key={segment.name}
                    title={segment.name}
                    aria-label={segment.name}
                    style={{
                      minWidth: 0,
                      display: "grid",
                      justifyItems: "center",
                      alignContent: "start",
                      rowGap: "4px",
                    }}
                  >
                    <div
                      style={{
                        width: "100%",
                        minWidth: 0,
                        height: segment.state === "current" ? "14px" : "12px",
                        borderRadius: "4px",
                        backgroundColor,
                        border: borderStyle,
                        boxShadow:
                          segment.state === "current"
                            ? `0 0 0 2px ${blocked ? ui.redSoft : ui.blueSoft}, 0 3px 10px ${
                                blocked ? "rgba(180, 35, 24, 0.16)" : "rgba(37, 85, 199, 0.18)"
                              }`
                            : undefined,
                        transition: "background-color 180ms ease",
                      }}
                    />
                    {showLabel ? (
                      segment.state === "current" ? (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            maxWidth: "100%",
                            minWidth: 0,
                            padding: "1px 6px",
                            borderRadius: "999px",
                            border: `1px solid ${blocked ? ui.redBorder : ui.blueBorder}`,
                            backgroundColor: blocked ? ui.redSoft : ui.blueSoft,
                            fontSize: labelFontSize,
                            lineHeight: 1.15,
                            boxSizing: "border-box",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {segment.name}
                        </span>
                      ) : (
                        <span
                          style={{
                            minWidth: 0,
                            padding: "0 1px",
                            fontSize: labelFontSize,
                            lineHeight: 1.2,
                            color,
                            fontWeight: 500,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "clip",
                            textAlign: "center",
                          }}
                        >
                          {segment.shortName}
                        </span>
                      )
                    ) : (
                      ""
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div style={{ fontSize: "12px", color: ui.mutedSoft, fontStyle: "italic" }}>
            No process flow available for this work order type.
          </div>
        )}

        {blocked && reason && (
          <div
            style={{
              display: "grid",
              gap: "3px",
              marginTop: "4px",
              paddingTop: "10px",
              borderTop: `1px solid ${ui.redBorder}`,
            }}
          >
            <span
              style={{
                fontSize: "10px",
                fontWeight: 700,
                color: ui.red,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Hold reason
            </span>
            <div
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: ui.red,
                lineHeight: 1.4,
              }}
            >
              {reason}
            </div>
            {hasCorrective && correctiveAction.action && (
              <div
                style={{
                  marginTop: "2px",
                  fontSize: "12px",
                  color: ui.muted,
                  lineHeight: 1.4,
                }}
              >
                Corrective action: {correctiveAction.action}
              </div>
            )}
            {hasCorrective && correctiveAction.owner && (
              <div style={{ fontSize: "12px", color: ui.muted, lineHeight: 1.4 }}>
                Owner: {correctiveAction.owner}
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function TimelineLegend() {
  return (
    <details
      style={{
        position: "relative",
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          listStyle: "none",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "36px",
          padding: "8px 12px",
          borderRadius: "10px",
          border: `1px solid ${ui.border}`,
          backgroundColor: ui.surface,
          fontSize: "12px",
          fontWeight: 700,
          color: ui.muted,
          whiteSpace: "nowrap",
        }}
      >
        Legend
      </summary>
      <div
        style={{
          position: "absolute",
          top: "calc(100% + 8px)",
          right: 0,
          zIndex: 5,
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: "8px 10px",
          width: "min(320px, 70vw)",
          padding: "12px",
          borderRadius: "12px",
          border: `1px solid ${ui.border}`,
          backgroundColor: ui.surface,
          boxShadow: ui.shadow,
        }}
      >
        {timelineLegendEntries.map((entry) => (
          <div
            key={entry.step}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              minWidth: 0,
            }}
          >
            <span
              style={{
                flex: "0 0 auto",
                minWidth: entry.shortLabel === "EASA Form 1" ? "78px" : "34px",
                padding: entry.shortLabel === "EASA Form 1" ? "2px 8px" : "2px 6px",
                borderRadius: "999px",
                border: `1px solid ${ui.border}`,
                backgroundColor: ui.surfaceSoft,
                fontSize: "10px",
                fontWeight: 700,
                color: ui.text,
                textAlign: "center",
                whiteSpace: "nowrap",
              }}
            >
              {entry.shortLabel}
            </span>
            <span
              style={{
                minWidth: 0,
                fontSize: "12px",
                color: ui.muted,
                lineHeight: 1.35,
              }}
            >
              {entry.step}
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}

type PlanningTab = "list" | "timeline";

function PlanningPageContent() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [shopStaff, setShopStaff] = useState<StaffMember[]>([]);
  const [todayAbsentEngineerIds, setTodayAbsentEngineerIds] = useState<number[]>([]);
  const [quickEdit, setQuickEdit] = useState<QuickEditState | null>(null);
  const [actionConfirmationWorkOrderId, setActionConfirmationWorkOrderId] = useState<string | null>(null);
  const [quickEditForm, setQuickEditForm] = useState<QuickEditForm>({
    due_date: "",
    assigned_person_team: "",
  });
  const [quickEditStatus, setQuickEditStatus] = useState("");
  const [actionStatus, setActionStatus] = useState("");
  const [isSavingQuickEdit, setIsSavingQuickEdit] = useState(false);
  const [isCompletingAction, setIsCompletingAction] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<PlanningTab>("list");
  const [extraActions, setExtraActions] = useState<ExtraAction[]>([]);
  const [extraActionToClose, setExtraActionToClose] = useState<ExtraAction | null>(null);
  const [extraActionCloseStatus, setExtraActionCloseStatus] = useState("");
  const [isClosingExtraAction, setIsClosingExtraAction] = useState(false);
  const [extraActionEdit, setExtraActionEdit] = useState<
    | { action: ExtraAction; field: "responsible_person_team" | "due_date" }
    | null
  >(null);
  const [extraActionEditForm, setExtraActionEditForm] = useState<{
    responsible_person_team: string;
    due_date: string;
  }>({ responsible_person_team: "", due_date: "" });
  const [extraActionEditStatus, setExtraActionEditStatus] = useState("");
  const [isSavingExtraActionEdit, setIsSavingExtraActionEdit] = useState(false);
  const today = localDateKey();

  const todayAbsentEngineerIdSet = useMemo(
    () => new Set(todayAbsentEngineerIds),
    [todayAbsentEngineerIds],
  );

  const todayAbsentShopEngineerNames = useMemo(
    () =>
      new Set(
        shopStaff
          .filter((staffMember) => todayAbsentEngineerIdSet.has(staffMember.id))
          .map((staffMember) => staffMember.name),
      ),
    [shopStaff, todayAbsentEngineerIdSet],
  );

  function applySharedPlanningBlocks(nextOrders: WorkOrder[]) {
    return sortOrders(
      applySuggestedAssignmentsForCurrentStep(
        applyTodayQualificationBlocks(
          nextOrders,
          shopStaff,
          todayAbsentEngineerIds.map((engineerId) => ({
            engineer_id: engineerId,
            absence_date: today,
          })),
          today,
        ),
        shopStaff,
        todayAbsentShopEngineerNames,
      ),
    );
  }

  useEffect(() => {
    async function load() {
      const [data, engineers, absences, extras] = await Promise.all([
        getWorkOrders<WorkOrder>({
          select: WORK_ORDER_SELECT,
          isOpen: true,
          isActive: true,
        }),
        getEngineers<StaffMember>({
          select: "id, name, restrictions",
          isActive: true,
          role: "shop",
          startedOn: today,
          orderBy: { column: "name" },
        }),
        getEngineerAbsences<Absence>({
          select: "engineer_id, absence_date",
          fromDate: today,
        }),
        getExtraActions(),
      ]);
      setExtraActions(sortExtraActionsByDueDate(extras));

      const filtered = data.filter(
        (o) => o.current_process_step !== READY_TO_CLOSE_STEP,
      );

      const withQualificationBlocks = applyTodayQualificationBlocks(
        filtered,
        engineers,
        absences,
        today,
      );

      setShopStaff(engineers);
      setTodayAbsentEngineerIds(
        absences
          .filter((absence) => absence.absence_date === today)
          .map((absence) => absence.engineer_id),
      );
      setOrders(
        sortOrders(
          applySuggestedAssignmentsForCurrentStep(
            withQualificationBlocks,
            engineers,
            new Set(
              engineers
                .filter((engineer) =>
                  absences.some(
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
      setLoading(false);
    }

    void load();
  }, [today]);

  if (loading) {
    return <p style={{ padding: "2rem" }}>Loading...</p>;
  }

  const quickEditOrder = quickEdit
    ? orders.find((order) => order.work_order_id === quickEdit.workOrderId) || null
    : null;
  const actionConfirmationOrder = actionConfirmationWorkOrderId
    ? orders.find((order) => order.work_order_id === actionConfirmationWorkOrderId) || null
    : null;

  const dueDateRequired =
    quickEdit?.field === "due_date" &&
    (quickEditOrder?.priority === "Yes" || quickEditOrder?.priority === "AOG");

  const openOrders = orders.filter((o) => !isBlocked(o));
  const blockedOrders = orders.filter((o) => isBlocked(o));

  function openQuickEdit(
    order: WorkOrder,
    blocked: boolean,
    field: "due_date" | "assigned_person_team",
  ) {
    const storedAssignedPersonTeam = order.assigned_person_team?.trim() || "";
    const assignedPersonTeam =
      storedAssignedPersonTeam === DEFAULT_ASSIGNED_PERSON_TEAM
        ? ""
        : storedAssignedPersonTeam;

    setQuickEdit({
      workOrderId: order.work_order_id,
      blocked,
      field,
    });
    setQuickEditForm({
      due_date: order.due_date || "",
      assigned_person_team: blocked ? "" : assignedPersonTeam,
    });
    setQuickEditStatus("");
    setIsSavingQuickEdit(false);
  }

  function closeQuickEdit() {
    setQuickEdit(null);
    setQuickEditStatus("");
    setIsSavingQuickEdit(false);
  }

  function openCompleteActionConfirmation(order: WorkOrder) {
    setActionConfirmationWorkOrderId(order.work_order_id);
    setActionStatus("");
    setIsCompletingAction(false);
  }

  function closeCompleteActionConfirmation() {
    if (isCompletingAction) return;
    setActionConfirmationWorkOrderId(null);
  }

  async function saveQuickEdit() {
    if (!quickEditOrder || !quickEdit) return;

    if (quickEdit.field === "due_date" && dueDateRequired && !quickEditForm.due_date) {
      setQuickEditStatus("Due Date is required when Priority is Yes or AOG.");
      return;
    }

    if (
      quickEdit.field === "assigned_person_team" &&
      !quickEdit.blocked &&
      todayAbsentShopEngineerNames.has(quickEditForm.assigned_person_team)
    ) {
      setQuickEditStatus(
        `${quickEditForm.assigned_person_team} is absent today. Choose another engineer or Shop (default).`,
      );
      return;
    }

    setIsSavingQuickEdit(true);
    setQuickEditStatus("Saving...");

    const payload: Record<string, unknown> = {
      last_manual_update: new Date().toISOString(),
    };

    if (quickEdit.field === "due_date") {
      payload.due_date = quickEditForm.due_date || null;
    }

    if (quickEdit.field === "assigned_person_team" && !quickEdit.blocked) {
      payload.assigned_person_team = normalizeAssignedPersonTeam(
        quickEditForm.assigned_person_team,
      );
    }

    const { data: savedOrder, error } = await updateWorkOrderAndFetch<WorkOrder>(
      quickEdit.workOrderId,
      payload,
      WORK_ORDER_SELECT,
    );

    if (error || !savedOrder) {
      setQuickEditStatus(`Error: ${error?.message || "Unable to save changes."}`);
      setIsSavingQuickEdit(false);
      return;
    }

    setOrders((prev) =>
      applySharedPlanningBlocks(
        prev.map((order) =>
          order.work_order_id === quickEdit.workOrderId ? savedOrder : order,
        ),
      ),
    );

    closeQuickEdit();
  }

  function openCloseExtraActionConfirmation(action: ExtraAction) {
    setExtraActionToClose(action);
    setExtraActionCloseStatus("");
    setIsClosingExtraAction(false);
  }

  function closeCloseExtraActionConfirmation() {
    if (isClosingExtraAction) return;
    setExtraActionToClose(null);
    setExtraActionCloseStatus("");
  }

  async function confirmCloseExtraAction() {
    if (!extraActionToClose) return;

    setIsClosingExtraAction(true);
    setExtraActionCloseStatus("Deleting...");

    const { error } = await deleteExtraAction(extraActionToClose.id);

    if (error) {
      setExtraActionCloseStatus(`Error: ${error.message}`);
      setIsClosingExtraAction(false);
      return;
    }

    const closedId = extraActionToClose.id;
    setExtraActions((prev) => prev.filter((a) => a.id !== closedId));
    setExtraActionToClose(null);
    setExtraActionCloseStatus("");
    setIsClosingExtraAction(false);
  }

  function openEditExtraAction(
    action: ExtraAction,
    field: "responsible_person_team" | "due_date",
  ) {
    const storedResponsible = action.responsible_person_team?.trim() || "";
    const responsible =
      storedResponsible === DEFAULT_ASSIGNED_PERSON_TEAM ? "" : storedResponsible;

    setExtraActionEdit({ action, field });
    setExtraActionEditForm({
      responsible_person_team: responsible,
      due_date: action.due_date || "",
    });
    setExtraActionEditStatus("");
    setIsSavingExtraActionEdit(false);
  }

  function closeEditExtraAction() {
    if (isSavingExtraActionEdit) return;
    setExtraActionEdit(null);
    setExtraActionEditStatus("");
  }

  async function saveExtraActionEdit() {
    if (!extraActionEdit) return;

    if (
      extraActionEdit.field === "responsible_person_team" &&
      todayAbsentShopEngineerNames.has(extraActionEditForm.responsible_person_team)
    ) {
      setExtraActionEditStatus(
        `${extraActionEditForm.responsible_person_team} is absent today. Choose another engineer or Shop (default).`,
      );
      return;
    }

    setIsSavingExtraActionEdit(true);
    setExtraActionEditStatus("Saving...");

    const payload: { responsible_person_team?: string; due_date?: string | null } = {};
    if (extraActionEdit.field === "responsible_person_team") {
      payload.responsible_person_team = normalizeAssignedPersonTeam(
        extraActionEditForm.responsible_person_team,
      );
    } else {
      payload.due_date = extraActionEditForm.due_date || null;
    }

    const { data: saved, error } = await updateExtraActionAndFetch(
      extraActionEdit.action.id,
      payload,
    );

    if (error || !saved) {
      setExtraActionEditStatus(`Error: ${error?.message || "Unable to save changes."}`);
      setIsSavingExtraActionEdit(false);
      return;
    }

    setExtraActions((prev) =>
      sortExtraActionsByDueDate(
        prev.map((a) => (a.id === saved.id ? (saved as ExtraAction) : a)),
      ),
    );
    setExtraActionEdit(null);
    setExtraActionEditStatus("");
    setIsSavingExtraActionEdit(false);
  }

  async function completeCorrectiveAction() {
    if (!actionConfirmationOrder) return;

    setIsCompletingAction(true);
    setActionStatus("Saving...");

    const { data: savedOrder, error } = await updateWorkOrderAndFetch<WorkOrder>(
      actionConfirmationOrder.work_order_id,
      getCorrectiveActionCompletionPayload(),
      WORK_ORDER_SELECT,
    );

    if (error || !savedOrder) {
      setActionStatus(`Error: ${error?.message || "Unable to complete the corrective action."}`);
      setIsCompletingAction(false);
      return;
    }

    setOrders((prev) =>
      applySharedPlanningBlocks(
        prev.map((order) =>
          order.work_order_id === actionConfirmationOrder.work_order_id
            ? savedOrder
            : order,
        ),
      ),
    );
    setActionConfirmationWorkOrderId(null);
    setActionStatus(`Corrective action completed for ${actionConfirmationOrder.work_order_id}.`);
    setIsCompletingAction(false);
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        backgroundColor: ui.pageBg,
        padding: "var(--layout-page-py) var(--layout-page-px) var(--layout-page-px)",
        fontFamily: "var(--font-inter), var(--font-geist-sans), sans-serif",
        color: ui.text,
      }}
    >
      <div style={{ width: "100%", maxWidth: "var(--layout-content-max-w)", marginInline: "auto" }}>
        <PageHeader
          title="Shared Planning"
          description="Overview of active work orders, current next steps, assignments and blocking reasons."
          tabs={
            <>
              <div
                role="tablist"
                aria-label="Shared Planning views"
                style={{
                  display: "inline-flex",
                  padding: "3px",
                  borderRadius: "12px",
                  backgroundColor: ui.surfaceSoft,
                  border: `1px solid ${ui.border}`,
                  gap: "2px",
                }}
              >
                {(
                  [
                    { id: "list", label: "List" },
                    { id: "timeline", label: "Timeline" },
                  ] as const
                ).map((tab) => {
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => setActiveTab(tab.id)}
                      style={{
                        padding: "6px 14px",
                        borderRadius: "8px",
                        border: "1px solid transparent",
                        backgroundColor: isActive ? ui.surface : "transparent",
                        borderColor: isActive ? ui.border : "transparent",
                        color: isActive ? ui.text : ui.muted,
                        fontSize: "var(--fs-sm)",
                        fontWeight: 650,
                        letterSpacing: "0.005em",
                        cursor: "pointer",
                        boxShadow: isActive
                          ? "0 1px 2px rgba(31, 41, 55, 0.06)"
                          : "none",
                        transition:
                          "background-color 140ms ease, color 140ms ease, box-shadow 140ms ease",
                      }}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {activeTab === "timeline" && <TimelineLegend />}
            </>
          }
        />

        {activeTab === "list" && (
        <>
        <section style={{ ...sectionCardStyle, marginBottom: "var(--gap-section)" }}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={sectionTitleStyle}>Open work orders</h2>
              <p style={sectionDescriptionStyle}>
                Active work orders with a next process step to be completed.
              </p>
            </div>
            <span
              style={
                openOrders.length > 0 ? countBadgeOpenStyle : countBadgeMutedStyle
              }
            >
              {openOrders.length} order{openOrders.length !== 1 ? "s" : ""}
            </span>
          </div>

          {openOrders.length > 0 ? (
            <div style={tableWrapStyle}>
              <table style={{ ...tableBaseStyle, minWidth: "980px" }}>
                <thead>
                  <tr>
                    <th style={{ ...tableHeaderCellStyle, ...roundedTableHeaderStyle("left") }}>WO</th>
                    <th style={tableHeaderCellStyle}>Customer</th>
                    <th style={tableHeaderCellStyle}>Part number</th>
                    <th style={tableHeaderCellStyle}>Due date</th>
                    <th style={tableHeaderCellStyle}>Assigned</th>
                    <th style={tableHeaderCellStyle}>Next process step</th>
                    <th style={{ ...tableHeaderCellStyle, ...roundedTableHeaderStyle("right") }}>Last update</th>
                  </tr>
                </thead>
                <tbody>
                  {openOrders.map((o, idx) => {
                    const lastUpdate = latestUpdate(
                      o.last_system_update,
                      o.last_manual_update,
                    );
                    const isLast = idx === openOrders.length - 1;
                    const cell = isLast
                      ? { ...tableCellStyle, borderBottom: 0 }
                      : tableCellStyle;
                    const mCell = isLast
                      ? { ...mutedCellStyle, borderBottom: 0 }
                      : mutedCellStyle;

                    return (
                      <tr key={o.work_order_id}>
                        <td style={cell}>
                          <WorkOrderCell order={o} />
                        </td>
                        <td style={cell}>{o.customer || "–"}</td>
                        <td style={cell}>{o.part_number || "–"}</td>
                        <td style={cell}>
                          <span style={{ display: "inline-flex", alignItems: "center" }}>
                            <DueDateCell value={o.due_date} />
                            <button
                              type="button"
                              onClick={() => openQuickEdit(o, false, "due_date")}
                              style={inlineEditButtonStyle}
                              aria-label={`Edit due date for ${o.work_order_id}`}
                            >
                              <Pencil size={12} strokeWidth={2} />
                            </button>
                          </span>
                        </td>
                        <td style={cell}>
                          <span style={{ display: "inline-flex", alignItems: "center" }}>
                            {normalizeAssignedPersonTeam(o.assigned_person_team)}
                            <button
                              type="button"
                              onClick={() => openQuickEdit(o, false, "assigned_person_team")}
                              style={inlineEditButtonStyle}
                              aria-label={`Edit assignment for ${o.work_order_id}`}
                            >
                              <Pencil size={12} strokeWidth={2} />
                            </button>
                          </span>
                        </td>
                        <td style={cell}>{o.current_process_step || "–"}</td>
                        <td style={mCell}>
                          <LastUpdateCell value={lastUpdate} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
              No open work orders.
            </div>
          )}
        </section>

        <section
          style={{
            ...secondarySectionStyle,
            borderColor: ui.redBorder,
            backgroundColor: "#fff7f4",
            boxShadow: "0 1px 2px rgba(180, 35, 24, 0.04), 0 6px 18px rgba(180, 35, 24, 0.06)",
          }}
        >
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={{ ...sectionTitleStyle, color: ui.red }}>Blocked work orders</h2>
              <p style={{ ...sectionDescriptionStyle, color: "#8f332a" }}>
                Work orders waiting on customer approval, parts, or an external decision.
              </p>
            </div>
            <span
              style={
                blockedOrders.length > 0
                  ? countBadgeRedStyle
                  : countBadgeMutedStyle
              }
            >
              {blockedOrders.length} order{blockedOrders.length !== 1 ? "s" : ""}
            </span>
          </div>

          {actionStatus && (
            <div
              style={{
                marginBottom: "14px",
                padding: "10px 12px",
                borderRadius: "10px",
                border: `1px solid ${actionStatus.startsWith("Error:") ? ui.redBorder : ui.border}`,
                backgroundColor: actionStatus.startsWith("Error:") ? ui.redSoft : ui.surface,
                color: actionStatus.startsWith("Error:") ? ui.red : ui.muted,
                fontSize: "13px",
                lineHeight: 1.5,
                fontWeight: 600,
              }}
            >
              {actionStatus}
            </div>
          )}

          {blockedOrders.length > 0 ? (
            <div style={blockedTableWrapStyle}>
              <table style={{ ...tableBaseStyle, minWidth: "1120px" }}>
                <thead>
                  <tr>
                    <th style={{ ...tableHeaderCellStyle, ...roundedTableHeaderStyle("left") }}>WO</th>
                    <th style={tableHeaderCellStyle}>Customer</th>
                    <th style={tableHeaderCellStyle}>Part number</th>
                    <th style={tableHeaderCellStyle}>Due date</th>
                    <th style={tableHeaderCellStyle}>Next process step</th>
                    <th style={tableHeaderCellStyle}>Hold reason</th>
                    <th style={{ ...tableHeaderCellStyle, ...roundedTableHeaderStyle("right") }}>Last update</th>
                  </tr>
                </thead>
                <tbody>
                  {blockedOrders.map((o, idx) => {
                    const lastUpdate = latestUpdate(
                      o.last_system_update,
                      o.last_manual_update,
                    );
                    const reason = blockReason(o, {
                      rfqSentLabel: "Waiting for RFQ Approval",
                    });
                    const hasCorrectiveAction = hasActiveCorrectiveAction(o);
                    const correctiveAction = getCorrectiveActionContext(o);
                    const isLast = idx === blockedOrders.length - 1;
                    const cell = isLast
                      ? { ...tableCellStyle, borderBottom: 0 }
                      : tableCellStyle;
                    const mCell = isLast
                      ? { ...mutedCellStyle, borderBottom: 0 }
                      : mutedCellStyle;
                    const holdCell: React.CSSProperties = {
                      ...cell,
                      padding: "8px 13px",
                    };

                    return (
                      <tr key={o.work_order_id}>
                        <td style={cell}>
                          <WorkOrderCell order={o} />
                        </td>
                        <td style={cell}>{o.customer || "–"}</td>
                        <td style={cell}>{o.part_number || "–"}</td>
                        <td style={cell}>
                          <span style={{ display: "inline-flex", alignItems: "center" }}>
                            <DueDateCell value={o.due_date} />
                            <button
                              type="button"
                              onClick={() => openQuickEdit(o, true, "due_date")}
                              style={{
                                ...inlineEditButtonStyle,
                                borderColor: ui.redBorder,
                                backgroundColor: ui.redSoft,
                                color: ui.red,
                              }}
                              aria-label={`Edit due date for ${o.work_order_id}`}
                            >
                              <Pencil size={12} strokeWidth={2} />
                            </button>
                          </span>
                        </td>
                        <td style={cell}>{o.current_process_step || "–"}</td>
                        <td style={holdCell}>
                          <div
                            style={{
                              color: ui.red,
                              fontWeight: 600,
                              lineHeight: 1.35,
                            }}
                          >
                            {reason}
                          </div>
                          {hasCorrectiveAction && correctiveAction.action && (
                            <div
                              style={{
                                marginTop: "3px",
                                color: ui.muted,
                                fontSize: "12px",
                                fontWeight: 500,
                                lineHeight: 1.4,
                              }}
                            >
                              Corrective action: {correctiveAction.action}
                            </div>
                          )}
                          {hasCorrectiveAction && correctiveAction.owner && (
                            <div
                              style={{
                                marginTop: "2px",
                                color: ui.muted,
                                fontSize: "12px",
                                fontWeight: 500,
                                lineHeight: 1.4,
                              }}
                            >
                              Owner: {correctiveAction.owner}
                            </div>
                          )}
                          {hasCorrectiveAction && (
                            <button
                              type="button"
                              onClick={() => openCompleteActionConfirmation(o)}
                              style={inlineActionButtonStyle}
                            >
                              Mark corrective action as completed
                            </button>
                          )}
                        </td>
                        <td style={mCell}>
                          <LastUpdateCell value={lastUpdate} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
              No blocked work orders.
            </div>
          )}
        </section>

        <section style={{ ...sectionCardStyle, marginTop: "24px" }}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={sectionTitleStyle}>Additional tasks</h2>
              <p style={sectionDescriptionStyle}>
                Additional tasks to be completed by the engineers. 
              </p>
            </div>
            <span
              style={
                extraActions.length > 0 ? countBadgeOpenStyle : countBadgeMutedStyle
              }
            >
              {extraActions.length} task{extraActions.length !== 1 ? "s" : ""}
            </span>
          </div>

          {extraActions.length > 0 ? (
            <div style={tableWrapStyle}>
              <table style={tableBaseStyle}>
                <colgroup>
                  <col style={extraActionsDescriptionColumnStyle} />
                  <col style={extraActionsResponsibleColumnStyle} />
                  <col style={extraActionsDueDateColumnStyle} />
                  <col style={extraActionsActionColumnStyle} />
                </colgroup>
                <thead>
                  <tr>
                    <th
                      style={{
                        ...tableHeaderCellStyle,
                        ...roundedTableHeaderStyle("left"),
                        ...extraActionsTextCellStyle,
                      }}
                    >
                      Description
                    </th>
                    <th style={{ ...tableHeaderCellStyle, ...extraActionsTextCellStyle }}>
                      Responsible
                    </th>
                    <th style={{ ...tableHeaderCellStyle, ...extraActionsTextCellStyle }}>
                      Due date
                    </th>
                    <th
                      style={{
                        ...tableHeaderCellStyle,
                        ...roundedTableHeaderStyle("right"),
                        ...extraActionsTextCellStyle,
                      }}
                      aria-label="Actions"
                    />
                  </tr>
                </thead>
                <tbody>
                  {extraActions.map((action, idx) => {
                    const isLast = idx === extraActions.length - 1;
                    const cell: React.CSSProperties = {
                      ...tableCellStyle,
                      verticalAlign: "middle",
                      ...(isLast ? { borderBottom: 0 } : {}),
                    };
                    return (
                      <tr key={action.id}>
                        <td style={{ ...cell, ...extraActionsTextCellStyle, fontWeight: 600 }}>
                          {action.description}
                        </td>
                        <td style={{ ...cell, ...extraActionsTextCellStyle }}>
                          <span style={{ display: "inline-flex", alignItems: "center" }}>
                            {normalizeAssignedPersonTeam(action.responsible_person_team)}
                            <button
                              type="button"
                              onClick={() =>
                                openEditExtraAction(action, "responsible_person_team")
                              }
                              style={inlineEditButtonStyle}
                              aria-label={`Edit responsible for ${action.description}`}
                            >
                              <Pencil size={12} strokeWidth={2} />
                            </button>
                          </span>
                        </td>
                        <td style={{ ...cell, ...extraActionsTextCellStyle }}>
                          <span style={{ display: "inline-flex", alignItems: "center" }}>
                            <DueDateCell value={action.due_date} />
                            <button
                              type="button"
                              onClick={() => openEditExtraAction(action, "due_date")}
                              style={inlineEditButtonStyle}
                              aria-label={`Edit due date for ${action.description}`}
                            >
                              <Pencil size={12} strokeWidth={2} />
                            </button>
                          </span>
                        </td>
                        <td style={{ ...cell, ...extraActionsTextCellStyle, textAlign: "right" }}>
                          <button
                            type="button"
                            onClick={() => openCloseExtraActionConfirmation(action)}
                            style={{ ...inlineActionButtonStyle, marginTop: 0 }}
                          >
                            Close task
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
              No additional tasks.
            </div>
          )}
        </section>
        </>
        )}

        {activeTab === "timeline" && (
        <>
        <section style={{ ...sectionCardStyle, marginBottom: "24px" }}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={sectionTitleStyle}>Open work orders</h2>
              <p style={sectionDescriptionStyle}>
                Process timelines for active work orders, sized by each step&apos;s relative expected duration.
              </p>
            </div>
            <span
              style={
                openOrders.length > 0 ? countBadgeOpenStyle : countBadgeMutedStyle
              }
            >
              {openOrders.length} order{openOrders.length !== 1 ? "s" : ""}
            </span>
          </div>

          {openOrders.length > 0 ? (
            <div style={{ display: "grid", gap: "10px" }}>
              {openOrders.map((o) => (
                <WorkOrderTimelineRow
                  key={o.work_order_id}
                  order={o}
                  blocked={false}
                />
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
              No open work orders.
            </div>
          )}
        </section>

        <section
          style={{
            ...secondarySectionStyle,
            borderColor: ui.redBorder,
            backgroundColor: "#fff7f4",
            boxShadow:
              "0 1px 2px rgba(180, 35, 24, 0.04), 0 6px 18px rgba(180, 35, 24, 0.06)",
          }}
        >
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={{ ...sectionTitleStyle, color: ui.red }}>
                Blocked work orders
              </h2>
              <p style={{ ...sectionDescriptionStyle, color: "#8f332a" }}>
                Timelines showing where each blocked work order is currently stuck.
              </p>
            </div>
            <span
              style={
                blockedOrders.length > 0 ? countBadgeRedStyle : countBadgeMutedStyle
              }
            >
              {blockedOrders.length} order{blockedOrders.length !== 1 ? "s" : ""}
            </span>
          </div>

          {blockedOrders.length > 0 ? (
            <div style={{ display: "grid", gap: "10px" }}>
              {blockedOrders.map((o) => (
                <WorkOrderTimelineRow
                  key={o.work_order_id}
                  order={o}
                  blocked={true}
                />
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
              No blocked work orders.
            </div>
          )}
        </section>
        </>
        )}
      </div>

      {quickEditOrder && quickEdit && (
        <div style={modalBackdropStyle} onMouseDown={closeQuickEdit}>
          <div
            style={modalCardStyle}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div style={{ marginBottom: "14px" }}>
              <div style={modalEyebrowStyle}>Quick edit</div>
              <h2 style={modalTitleStyle}>{quickEditOrder.work_order_id}</h2>
            </div>

            <div style={{ ...modalInnerCardStyle, display: "grid", gap: "12px" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: quickEdit.blocked ? "1fr 1fr" : "repeat(3, 1fr)",
                  gap: "10px",
                }}
              >
                <div>
                  <div style={modalEyebrowStyle}>Customer</div>
                  <div style={{ fontSize: "14px", color: ui.text }}>
                    {quickEditOrder.customer || "â€”"}
                  </div>
                </div>
                <div>
                  <div style={modalEyebrowStyle}>Part Number</div>
                  <div style={{ fontSize: "14px", color: ui.text }}>
                    {quickEditOrder.part_number || "â€”"}
                  </div>
                </div>
                {!quickEdit.blocked && (
                  <div>
                    <div style={modalEyebrowStyle}>Current Step</div>
                    <div style={{ fontSize: "14px", color: ui.text }}>
                      {quickEditOrder.current_process_step || "â€”"}
                    </div>
                  </div>
                )}
              </div>

              {!quickEdit.blocked && quickEdit.field === "assigned_person_team" && (
                <div>
                  <div style={modalEyebrowStyle}>Assigned Person / Team</div>
                  <select
                    value={quickEditForm.assigned_person_team}
                    onChange={(event) =>
                      setQuickEditForm((prev) => ({
                        ...prev,
                        assigned_person_team: event.target.value,
                      }))
                    }
                    style={modalInputStyle}
                    disabled={isSavingQuickEdit}
                  >
                    <option value="">Shop (default)</option>
                    {shopStaff.map((staffMember) => (
                      <option
                        key={staffMember.id}
                        value={staffMember.name}
                        disabled={todayAbsentEngineerIdSet.has(staffMember.id)}
                      >
                        {staffMember.name}
                        {todayAbsentEngineerIdSet.has(staffMember.id)
                          ? " (absent today)"
                          : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {quickEdit.field === "due_date" && (
                <div>
                  <div style={modalEyebrowStyle}>Due Date</div>
                  <input
                    type="date"
                    value={quickEditForm.due_date}
                    onChange={(event) =>
                      setQuickEditForm((prev) => ({
                        ...prev,
                        due_date: event.target.value,
                      }))
                    }
                    style={{
                      ...modalInputStyle,
                      borderColor:
                        dueDateRequired && !quickEditForm.due_date
                          ? ui.red
                          : ui.borderStrong,
                    }}
                    disabled={isSavingQuickEdit}
                  />
                  {dueDateRequired && !quickEditForm.due_date && (
                    <div
                      style={{
                        marginTop: "6px",
                        fontSize: "12px",
                        color: ui.red,
                        fontWeight: 700,
                      }}
                    >
                      Due Date is required for Priority or AOG.
                    </div>
                  )}
                </div>
              )}

              {quickEditStatus && (
                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: `1px solid ${quickEditStatus.startsWith("Error:") ? ui.redBorder : ui.border}`,
                    backgroundColor: quickEditStatus.startsWith("Error:") ? ui.redSoft : ui.surfaceSoft,
                    color: quickEditStatus.startsWith("Error:") ? ui.red : ui.muted,
                    fontSize: "13px",
                    lineHeight: 1.5,
                    fontWeight: 600,
                  }}
                >
                  {quickEditStatus}
                </div>
              )}
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "12px",
                marginTop: "14px",
                flexWrap: "wrap",
              }}
            >
              <Link
                href={`/office-update?wo=${quickEditOrder.work_order_id}`}
                style={{
                  color: ui.blue,
                  fontSize: "13px",
                  fontWeight: 700,
                  textDecoration: "none",
                }}
              >
                Open full Office Update
              </Link>

              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  type="button"
                  onClick={closeQuickEdit}
                  style={modalActionButtonStyle}
                  disabled={isSavingQuickEdit}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void saveQuickEdit()}
                  style={modalPrimaryButtonStyle}
                  disabled={isSavingQuickEdit}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {actionConfirmationOrder && (
        <div style={modalBackdropStyle} onMouseDown={closeCompleteActionConfirmation}>
          <div
            style={modalCardStyle}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div style={{ marginBottom: "14px" }}>
              <div style={modalEyebrowStyle}>Confirm action</div>
              <h2 style={modalTitleStyle}>
                Complete corrective action for {actionConfirmationOrder.work_order_id}?
              </h2>
            </div>

            <div style={{ ...modalInnerCardStyle, display: "grid", gap: "10px" }}>
              <div>
                <div style={modalEyebrowStyle}>Hold reason</div>
                <div style={{ fontSize: "14px", color: ui.text }}>
                  {blockReason(actionConfirmationOrder, {
                    rfqSentLabel: "Waiting for RFQ Approval",
                  })}
                </div>
              </div>
              <div>
                <div style={modalEyebrowStyle}>Active corrective action</div>
                <div style={{ fontSize: "14px", color: ui.text }}>
                  {getCorrectiveActionContext(actionConfirmationOrder).summary || "No active corrective action"}
                </div>
              </div>

              {actionStatus && (
                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: `1px solid ${actionStatus.startsWith("Error:") ? ui.redBorder : ui.border}`,
                    backgroundColor: actionStatus.startsWith("Error:") ? ui.redSoft : ui.surfaceSoft,
                    color: actionStatus.startsWith("Error:") ? ui.red : ui.muted,
                    fontSize: "13px",
                    lineHeight: 1.5,
                    fontWeight: 600,
                  }}
                >
                  {actionStatus}
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
                onClick={closeCompleteActionConfirmation}
                style={modalActionButtonStyle}
                disabled={isCompletingAction}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void completeCorrectiveAction()}
                style={modalPrimaryButtonStyle}
                disabled={isCompletingAction}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {extraActionEdit && (
        <div style={modalBackdropStyle} onMouseDown={closeEditExtraAction}>
          <div
            style={modalCardStyle}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div style={{ marginBottom: "14px" }}>
              <div style={modalEyebrowStyle}>Quick edit</div>
              <h2 style={modalTitleStyle}>{extraActionEdit.action.description}</h2>
            </div>

            <div style={{ ...modalInnerCardStyle, display: "grid", gap: "12px" }}>
              {extraActionEdit.field === "responsible_person_team" ? (
                <div>
                  <div style={modalEyebrowStyle}>Responsible Person / Team</div>
                  <select
                    value={extraActionEditForm.responsible_person_team}
                    onChange={(event) =>
                      setExtraActionEditForm((prev) => ({
                        ...prev,
                        responsible_person_team: event.target.value,
                      }))
                    }
                    style={modalInputStyle}
                    disabled={isSavingExtraActionEdit}
                  >
                    <option value="">Shop (default)</option>
                    {shopStaff.map((staffMember) => (
                      <option
                        key={staffMember.id}
                        value={staffMember.name}
                        disabled={todayAbsentEngineerIdSet.has(staffMember.id)}
                      >
                        {staffMember.name}
                        {todayAbsentEngineerIdSet.has(staffMember.id)
                          ? " (absent today)"
                          : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <div style={modalEyebrowStyle}>Due Date</div>
                  <input
                    type="date"
                    value={extraActionEditForm.due_date}
                    onChange={(event) =>
                      setExtraActionEditForm((prev) => ({
                        ...prev,
                        due_date: event.target.value,
                      }))
                    }
                    style={modalInputStyle}
                    disabled={isSavingExtraActionEdit}
                  />
                </div>
              )}

              {extraActionEditStatus && (
                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: `1px solid ${extraActionEditStatus.startsWith("Error:") ? ui.redBorder : ui.border}`,
                    backgroundColor: extraActionEditStatus.startsWith("Error:") ? ui.redSoft : ui.surfaceSoft,
                    color: extraActionEditStatus.startsWith("Error:") ? ui.red : ui.muted,
                    fontSize: "13px",
                    lineHeight: 1.5,
                    fontWeight: 600,
                  }}
                >
                  {extraActionEditStatus}
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
                onClick={closeEditExtraAction}
                style={modalActionButtonStyle}
                disabled={isSavingExtraActionEdit}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveExtraActionEdit()}
                style={modalPrimaryButtonStyle}
                disabled={isSavingExtraActionEdit}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {extraActionToClose && (
        <div style={modalBackdropStyle} onMouseDown={closeCloseExtraActionConfirmation}>
          <div
            style={modalCardStyle}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div style={{ marginBottom: "14px" }}>
              <div style={modalEyebrowStyle}>Close additional task</div>
              <h2 style={modalTitleStyle}>
                Close {extraActionToClose.description}?
              </h2>
            </div>

            <div style={{ ...modalInnerCardStyle, display: "grid", gap: "10px" }}>
              <div>
                <div style={modalEyebrowStyle}>Responsible</div>
                <div style={{ fontSize: "14px", color: ui.text }}>
                  {normalizeAssignedPersonTeam(extraActionToClose.responsible_person_team)}
                </div>
              </div>
              <div>
                <div style={modalEyebrowStyle}>Due date</div>
                <div style={{ fontSize: "14px", color: ui.text }}>
                  {formatDate(extraActionToClose.due_date)}
                </div>
              </div>

              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: "10px",
                  border: `1px solid ${ui.redBorder}`,
                  backgroundColor: ui.redSoft,
                  color: ui.red,
                  fontSize: "13px",
                  fontWeight: 700,
                  lineHeight: 1.45,
                }}
              >
                This cannot be undone. The task will be permanently removed.
              </div>

              {extraActionCloseStatus && (
                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: `1px solid ${extraActionCloseStatus.startsWith("Error:") ? ui.redBorder : ui.border}`,
                    backgroundColor: extraActionCloseStatus.startsWith("Error:") ? ui.redSoft : ui.surfaceSoft,
                    color: extraActionCloseStatus.startsWith("Error:") ? ui.red : ui.muted,
                    fontSize: "13px",
                    lineHeight: 1.5,
                    fontWeight: 600,
                  }}
                >
                  {extraActionCloseStatus}
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
                onClick={closeCloseExtraActionConfirmation}
                style={modalActionButtonStyle}
                disabled={isClosingExtraAction}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmCloseExtraAction()}
                style={modalPrimaryButtonStyle}
                disabled={isClosingExtraAction}
              >
                Close task
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function PlanningPage() {
  return (
    <RequireRole allowedRoles={["office"]}>
      <PlanningPageContent />
    </RequireRole>
  );
}
