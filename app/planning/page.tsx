"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import { READY_TO_CLOSE_STEP } from "@/lib/process-steps";
import {
  DEFAULT_ASSIGNED_PERSON_TEAM,
  applyTodayQualificationBlocks,
  blockReason,
  formatDate,
  getCorrectiveActionContext,
  isBlocked,
  isStale,
  latestUpdate,
  localDateKey,
  normalizeAssignedPersonTeam,
  priorityTag,
  sortOrders,
} from "@/lib/work-order-rules";
import { getEngineerAbsences, getEngineers } from "@/lib/engineers";
import { getWorkOrders, updateWorkOrderAndFetch } from "@/lib/work-orders";

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
  last_manual_update: string | null;
  last_system_update: string | null;
};

type StaffMember = {
  id: number;
  name: string;
  restrictions: string[] | null;
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
  "work_order_id, customer, part_number, due_date, priority, assigned_person_team, current_process_step, hold_reason, rfq_state, required_next_action, action_owner, last_manual_update, last_system_update";

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
  padding: "16px 18px",
};

const secondarySectionStyle: React.CSSProperties = {
  ...surfaceCardStyle,
  padding: "16px 18px",
  backgroundColor: ui.surfaceMuted,
};

const sectionHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "14px",
  marginBottom: "12px",
};

const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "16px",
  fontWeight: 650,
  color: ui.text,
  letterSpacing: "-0.015em",
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
  padding: "10px 14px",
  borderBottom: `1px solid ${ui.border}`,
  fontSize: "14px",
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
  fontSize: "13px",
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

const modalBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  backgroundColor: "rgba(31, 41, 55, 0.28)",
  display: "grid",
  placeItems: "center",
  padding: "24px",
  zIndex: 60,
};

const modalCardStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: "520px",
  backgroundColor: "#fcfaf6",
  border: `1px solid ${ui.borderStrong}`,
  borderRadius: "18px",
  boxShadow: "0 20px 50px rgba(31, 41, 55, 0.18)",
  padding: "18px",
};

const modalInnerCardStyle: React.CSSProperties = {
  backgroundColor: ui.surface,
  border: `1px solid ${ui.border}`,
  borderRadius: "14px",
  padding: "15px",
};

const modalInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  border: `1px solid ${ui.borderStrong}`,
  borderRadius: "10px",
  fontSize: "14px",
  lineHeight: 1.4,
  boxSizing: "border-box",
  backgroundColor: "#fffdf9",
  color: ui.text,
  minHeight: "42px",
  outline: "none",
};

const modalEyebrowStyle: React.CSSProperties = {
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: ui.mutedSoft,
  marginBottom: "6px",
};

const modalTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "22px",
  fontWeight: 750,
  letterSpacing: "-0.025em",
  color: ui.text,
  lineHeight: 1.1,
};

const modalSubtitleStyle: React.CSSProperties = {
  margin: "8px 0 0",
  fontSize: "14px",
  lineHeight: 1.5,
  color: ui.muted,
};

const modalActionButtonStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: "10px",
  border: `1px solid ${ui.borderStrong}`,
  backgroundColor: ui.surface,
  color: ui.text,
  fontSize: "14px",
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

export default function PlanningPage() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [shopStaff, setShopStaff] = useState<StaffMember[]>([]);
  const [todayAbsentEngineerIds, setTodayAbsentEngineerIds] = useState<number[]>([]);
  const [quickEdit, setQuickEdit] = useState<QuickEditState | null>(null);
  const [quickEditForm, setQuickEditForm] = useState<QuickEditForm>({
    due_date: "",
    assigned_person_team: "",
  });
  const [quickEditStatus, setQuickEditStatus] = useState("");
  const [isSavingQuickEdit, setIsSavingQuickEdit] = useState(false);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    async function load() {
      const today = localDateKey();

      const [data, engineers, absences] = await Promise.all([
        getWorkOrders<WorkOrder>({
          select: WORK_ORDER_SELECT,
          isOpen: true,
          isActive: true,
        }),
        getEngineers<StaffMember>({
          select: "id, name, restrictions",
          isActive: true,
          role: "shop",
          orderBy: { column: "name" },
        }),
        getEngineerAbsences<Absence>({
          select: "engineer_id, absence_date",
          fromDate: today,
        }),
      ]);

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
      setOrders(sortOrders(withQualificationBlocks));
      setLoading(false);
    }

    void load();
  }, []);

  if (loading) {
    return <p style={{ padding: "2rem" }}>Loading...</p>;
  }

  const quickEditOrder = quickEdit
    ? orders.find((order) => order.work_order_id === quickEdit.workOrderId) || null
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
      sortOrders(
        prev.map((order) =>
          order.work_order_id === quickEdit.workOrderId ? savedOrder : order,
        ),
      ),
    );

    closeQuickEdit();
  }

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
      <div style={{ maxWidth: "1440px" }}>
        <header
          style={{
            marginBottom: "22px",
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
              Shared Planning
            </h1>
            <p
              style={{
                margin: "8px 0 0",
                fontSize: "14px",
                lineHeight: 1.45,
                color: ui.muted,
              }}
            >
              Overview of active work orders, current next steps, assignments and blocking reasons.
            </p>
          </div>
        </header>

        <section style={{ ...sectionCardStyle, marginBottom: "24px" }}>
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
              <table style={{ ...tableBaseStyle, minWidth: "1080px" }}>
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
                          {correctiveAction.summary && (
                            <div
                              style={{
                                marginTop: "3px",
                                color: ui.muted,
                                fontSize: "12px",
                                fontWeight: 500,
                                lineHeight: 1.4,
                              }}
                            >
                              {correctiveAction.summary}
                            </div>
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
              <p style={modalSubtitleStyle}>
                {quickEdit.blocked
                  ? "Update the due date here. Use Office Update for corrective action or status changes."
                  : quickEdit.field === "due_date"
                    ? "Update the due date here. Use Office Update for full work order editing."
                    : "Update the assigned person here. Use Office Update for full work order editing."}
              </p>
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
    </main>
  );
}
