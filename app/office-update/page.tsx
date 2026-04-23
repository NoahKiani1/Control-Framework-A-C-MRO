"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getEngineerAbsences, getEngineers } from "@/lib/engineers";
import { getWorkOrders, updateWorkOrderAndFetch } from "@/lib/work-orders";
import { createExtraAction } from "@/lib/extra-actions";
import {
  applySuggestedAssignmentsForCurrentStep,
  autoAssignForStep,
} from "@/lib/auto-assign";
import {
  getCompletableStepsForType,
  getInitialProcessStep,
} from "@/lib/process-steps";
import {
  DEFAULT_ASSIGNED_PERSON_TEAM,
  normalizeAssignedPersonTeam,
} from "@/lib/work-order-rules";
import { SearchableSelect } from "@/app/components/searchable-select";
import { PageHeader } from "@/app/components/page-header";

type WorkOrder = {
  work_order_id: string;
  customer: string | null;
  due_date: string | null;
  priority: string | null;
  assigned_person_team: string | null;
  hold_reason: string | null;
  required_next_action: string | null;
  action_owner: string | null;
  action_status: string | null;
  action_closed: boolean | null;
  is_active: boolean;
  work_order_type: string | null;
  current_process_step: string | null;
  part_number: string | null;
};

type StaffMember = {
  id: number;
  name: string;
  role: string | null;
  restrictions: string[] | null;
  employment_start_date?: string | null;
};

type FormState = {
  due_date: string;
  priority: string;
  assigned_person_team: string;
  hold_reason: string;
  required_next_action: string;
  action_owner: string;
  activation_process_step: string;
  is_active: boolean;
};

type ExtraActionFormState = {
  description: string;
  responsible_person_team: string;
  due_date: string;
};

type Mode = "active" | "inactive" | null;

const EMPTY_FORM: FormState = {
  due_date: "",
  priority: "No",
  assigned_person_team: "",
  hold_reason: "",
  required_next_action: "",
  action_owner: "",
  activation_process_step: "",
  is_active: true,
};

const EMPTY_EXTRA_ACTION_FORM: ExtraActionFormState = {
  description: "",
  responsible_person_team: "",
  due_date: "",
};

type Absence = {
  engineer_id: number;
  absence_date: string;
};

const WORK_ORDER_SELECT =
  "work_order_id, customer, due_date, priority, assigned_person_team, hold_reason, required_next_action, action_owner, action_status, action_closed, is_active, work_order_type, current_process_step, part_number";

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

const COLORS = {
  pageBg: "#f2efe9",
  panelBg: "#ffffff",
  cardBg: "#faf8f3",
  border: "#e2ddd1",
  borderStrong: "#ccc4b4",
  text: "#1f2937",
  textSoft: "#5f6b7c",
  textMuted: "#8590a0",
  heading: "#1f2937",
  blue: "#2555c7",
  blueSoft: "#eef3ff",
  green: "#166534",
  greenSoft: "#eef9f1",
  amber: "#b45309",
  amberSoft: "#fff6e8",
  red: "#b42318",
  redSoft: "#fff2ef",
  inputBg: "#fffdf9",
  shadow: "0 1px 2px rgba(31, 41, 55, 0.04), 0 4px 12px rgba(31, 41, 55, 0.04)",
};

const FONT_STACK = 'var(--font-inter), var(--font-geist-sans), sans-serif';

export default function OfficeUpdatePage() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [shopStaff, setShopStaff] = useState<StaffMember[]>([]);
  const [officeStaff, setOfficeStaff] = useState<StaffMember[]>([]);
  const [todayAbsentEngineerIds, setTodayAbsentEngineerIds] = useState<number[]>([]);
  const [mode, setMode] = useState<Mode>(null);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [extraActionForm, setExtraActionForm] = useState<ExtraActionFormState>(
    EMPTY_EXTRA_ACTION_FORM,
  );
  const [isBlockedUpdate, setIsBlockedUpdate] = useState(false);
  const [showInactiveActivationForm, setShowInactiveActivationForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState("");
  const [extraActionStatus, setExtraActionStatus] = useState("");

  const buildFormFromOrder = useCallback((order: WorkOrder): FormState => {
    const storedAssignedPersonTeam = order.assigned_person_team?.trim() || "";
    const assignedPersonTeam =
      storedAssignedPersonTeam === DEFAULT_ASSIGNED_PERSON_TEAM
        ? ""
        : storedAssignedPersonTeam;

    return {
      due_date: order.due_date || "",
      priority: order.priority || "No",
      assigned_person_team: assignedPersonTeam,
      hold_reason: order.hold_reason || "",
      required_next_action: order.hold_reason?.trim()
        ? order.required_next_action || ""
        : "",
      action_owner: order.hold_reason?.trim() ? order.action_owner || "" : "",
      activation_process_step:
        order.current_process_step?.trim() ||
        getInitialProcessStep(order.work_order_type),
      is_active: order.is_active,
    };
  }, []);

  const applyOrderSelection = useCallback(
    (order: WorkOrder) => {
      setSelectedId(order.work_order_id);
      setForm(buildFormFromOrder(order));
      setIsBlockedUpdate(Boolean(order.hold_reason?.trim()));
      setShowInactiveActivationForm(false);
      setSaveStatus("");
    },
    [buildFormFromOrder],
  );

  useEffect(() => {
    async function load() {
      const today = localDateKey();
      const [wo, staffData, absenceData] = await Promise.all([
        getWorkOrders<WorkOrder>({
          select: WORK_ORDER_SELECT,
          isOpen: true,
          orderBy: { column: "work_order_id", ascending: false },
        }),
        getEngineers<StaffMember>({
          select: "id, name, role, restrictions",
          isActive: true,
          startedOn: today,
          orderBy: { column: "name" },
        }),
        getEngineerAbsences<Absence>({
          select: "engineer_id, absence_date",
          fromDate: today,
        }),
      ]);

      setShopStaff(staffData.filter((s) => s.role === "shop"));
      setOfficeStaff(staffData.filter((s) => s.role === "office"));
      setTodayAbsentEngineerIds(
        absenceData
          .filter((absence) => absence.absence_date === today)
          .map((absence) => absence.engineer_id),
      );
      setOrders(
        applySuggestedAssignmentsForCurrentStep(
          wo,
          staffData.filter((staffMember) => staffMember.role === "shop"),
          new Set(
            staffData
              .filter(
                (staffMember) =>
                  staffMember.role === "shop" &&
                  absenceData.some(
                    (absence) =>
                      absence.absence_date === today &&
                      absence.engineer_id === staffMember.id,
                  ),
              )
              .map((staffMember) => staffMember.name),
          ),
        ),
      );
      setLoading(false);

      const woParam = new URLSearchParams(window.location.search).get("wo");
      if (woParam) {
        const order = wo.find((o) => o.work_order_id === woParam);
        if (order) {
          setMode(order.is_active ? "active" : "inactive");
          applyOrderSelection(order);
        }
      }
    }

    void load();
  }, [applyOrderSelection]);

  const activeOrders = useMemo(
    () => orders.filter((o) => o.is_active),
    [orders],
  );

  const inactiveOrders = useMemo(
    () => orders.filter((o) => !o.is_active),
    [orders],
  );

  const visibleOrders = useMemo(() => {
    if (mode === "active") return activeOrders;
    if (mode === "inactive") return inactiveOrders;
    return [];
  }, [mode, activeOrders, inactiveOrders]);

  const selectedOrder = useMemo(
    () => orders.find((o) => o.work_order_id === selectedId),
    [orders, selectedId],
  );

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

  const dueDateRequired = form.priority === "Yes" || form.priority === "AOG";
  const inactiveActivationStepOptions = useMemo(
    () =>
      selectedOrder
        ? getCompletableStepsForType(selectedOrder.work_order_type)
        : [],
    [selectedOrder],
  );

  function displayDate(value: string | null): string {
    if (!value) return "—";
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("en-GB");
  }

  function aogPrioritySuffix(order: WorkOrder): string {
    return order.priority === "AOG" ? " — AOG" : "";
  }

  function clearPageAfterSave() {
    setMode(null);
    setSelectedId("");
    setForm(EMPTY_FORM);
    setIsBlockedUpdate(false);
    setShowInactiveActivationForm(false);
  }

  function selectOrder(id: string) {
    const order = orders.find((o) => o.work_order_id === id);
    if (!order) return;
    applyOrderSelection(order);
  }

  function changeMode(nextMode: "active" | "inactive") {
    setMode(nextMode);
    setSelectedId("");
    setForm(EMPTY_FORM);
    setIsBlockedUpdate(false);
    setShowInactiveActivationForm(false);
    setSaveStatus("");
  }

  function startInactiveActivation() {
    if (!selectedOrder || selectedOrder.is_active) return;

    setForm((prev) => ({
      ...prev,
      is_active: true,
    }));
    setShowInactiveActivationForm(true);
    setSaveStatus("");
  }

  function setBlockedChoice(blocked: boolean) {
    setIsBlockedUpdate(blocked);

    if (!blocked) {
      setForm((prev) => ({
        ...prev,
        hold_reason: "",
        required_next_action: "",
        action_owner: "",
      }));
    }
  }

  async function saveWorkOrder() {
    if (!selectedId || !selectedOrder) return;

    if (dueDateRequired && !form.due_date) {
      setSaveStatus("Due Date is required when Priority is Yes or AOG.");
      return;
    }

    if (isBlockedUpdate && !form.hold_reason.trim()) {
      setSaveStatus("Please enter a hold reason.");
      return;
    }

    if (todayAbsentShopEngineerNames.has(form.assigned_person_team)) {
      setSaveStatus(
        `${form.assigned_person_team} is absent today. Choose another engineer or Shop (default).`,
      );
      return;
    }

    const normalizedAssigned = normalizeAssignedPersonTeam(
      form.assigned_person_team,
    );
    const normalizedHoldReason = form.hold_reason.trim();
    const normalizedRequiredAction = form.required_next_action.trim();
    const normalizedActionOwner = form.action_owner.trim();

    setSaveStatus("Saving...");

    const isActivating = !selectedOrder.is_active && form.is_active;
    const preservedStep = selectedOrder.current_process_step?.trim() || "";
    const nextProcessStep =
      (isActivating ? form.activation_process_step.trim() : "") ||
      preservedStep ||
      getInitialProcessStep(selectedOrder.work_order_type);

    const payload = {
      due_date: form.due_date || null,
      priority: form.priority,
      assigned_person_team: isActivating
        ? autoAssignForStep(
            normalizedAssigned,
            nextProcessStep,
            shopStaff,
            todayAbsentShopEngineerNames,
          )
        : normalizedAssigned,
      hold_reason: isBlockedUpdate ? normalizedHoldReason : null,
      required_next_action:
        isBlockedUpdate && normalizedRequiredAction
          ? normalizedRequiredAction
          : null,
      action_owner:
        isBlockedUpdate && normalizedActionOwner ? normalizedActionOwner : null,
      action_status: isBlockedUpdate ? "Open" : null,
      action_closed: false,
      is_active: form.is_active,
      current_process_step: isActivating ? nextProcessStep : selectedOrder.current_process_step,
      last_manual_update: new Date().toISOString(),
    };

    const { data: savedOrder, error } = await updateWorkOrderAndFetch<WorkOrder>(
      selectedId,
      payload,
      WORK_ORDER_SELECT,
    );

    if (error) {
      setSaveStatus(`Error: ${error.message}`);
      return;
    }

    setOrders((prev) =>
      prev.map((o) =>
        o.work_order_id === selectedId && savedOrder ? savedOrder : o,
      ),
    );

    clearPageAfterSave();
    setSaveStatus("Saved.");
  }

  async function saveExtraAction() {
    const normalizedDescription = extraActionForm.description.trim();

    if (!normalizedDescription) {
      setExtraActionStatus("Please enter a description.");
      return;
    }

    if (todayAbsentShopEngineerNames.has(extraActionForm.responsible_person_team)) {
      setExtraActionStatus(
        `${extraActionForm.responsible_person_team} is absent today. Choose another engineer or Shop (default).`,
      );
      return;
    }

    setExtraActionStatus("Saving...");

    const { error } = await createExtraAction({
      description: normalizedDescription,
      responsible_person_team: normalizeAssignedPersonTeam(
        extraActionForm.responsible_person_team,
      ),
      due_date: extraActionForm.due_date || null,
    });

    if (error) {
      setExtraActionStatus(`Error: ${error.message}`);
      return;
    }

    setExtraActionForm(EMPTY_EXTRA_ACTION_FORM);
    setExtraActionStatus("Extra action saved.");
  }

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          backgroundColor: COLORS.pageBg,
          padding: "28px",
          color: COLORS.textSoft,
          fontFamily: FONT_STACK,
        }}
      >
        Loading...
      </div>
    );
  }

  const pageStyle: React.CSSProperties = {
    minHeight: "100vh",
    backgroundColor: COLORS.pageBg,
    padding: "32px 40px 40px",
    fontFamily: FONT_STACK,
    color: COLORS.text,
  };

  const shellStyle: React.CSSProperties = {
    maxWidth: "1440px",
  };

  const sectionCard: React.CSSProperties = {
    backgroundColor: COLORS.panelBg,
    border: `1px solid ${COLORS.border}`,
    borderRadius: "14px",
    padding: "16px 18px",
    boxShadow: COLORS.shadow,
  };

  const innerCard: React.CSSProperties = {
    backgroundColor: COLORS.cardBg,
    border: `1px solid ${COLORS.border}`,
    borderRadius: "14px",
    padding: "15px",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    border: `1px solid ${COLORS.borderStrong}`,
    borderRadius: "10px",
    fontSize: "14px",
    boxSizing: "border-box",
    backgroundColor: COLORS.inputBg,
    color: COLORS.text,
    minHeight: "42px",
    outline: "none",
  };

  const fieldTitleStyle: React.CSSProperties = {
    fontSize: "16px",
    fontWeight: 650,
    color: COLORS.heading,
    margin: 0,
    letterSpacing: "-0.015em",
  };

  const eyebrowStyle: React.CSSProperties = {
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: COLORS.textMuted,
    marginBottom: "6px",
  };

  const modeBtn = (
    kind: "active" | "inactive",
    active: boolean,
  ): React.CSSProperties => ({
    padding: "10px 16px",
    borderRadius: "10px",
    border: `1px solid ${active ? (kind === "active" ? "#d7e3ff" : "#ead1a6") : COLORS.border}`,
    backgroundColor: active
      ? kind === "active"
        ? COLORS.blueSoft
        : COLORS.amberSoft
      : COLORS.panelBg,
    color: active ? (kind === "active" ? COLORS.blue : COLORS.amber) : COLORS.textSoft,
    fontWeight: 700,
    fontSize: "13px",
    cursor: "pointer",
    boxShadow: active ? "0 1px 2px rgba(31, 41, 55, 0.04)" : "none",
  });

  const choiceBtn = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: "10px 12px",
    borderRadius: "10px",
    border: `1px solid ${active ? "#d7e3ff" : COLORS.border}`,
    backgroundColor: active ? COLORS.blueSoft : COLORS.panelBg,
    color: active ? COLORS.blue : COLORS.textSoft,
    fontWeight: 700,
    fontSize: "13px",
    cursor: "pointer",
  });

  const primaryBtn: React.CSSProperties = {
    padding: "11px 18px",
    backgroundColor: COLORS.blue,
    color: "white",
    border: `1px solid ${COLORS.blue}`,
    borderRadius: "10px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "14px",
    boxShadow: "0 8px 20px rgba(37, 85, 199, 0.18)",
  };

  const secondaryBtn: React.CSSProperties = {
    padding: "11px 18px",
    backgroundColor: COLORS.panelBg,
    color: COLORS.textSoft,
    border: `1px solid ${COLORS.borderStrong}`,
    borderRadius: "10px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "14px",
  };

  const showEditor = selectedOrder
    ? selectedOrder.is_active || showInactiveActivationForm
    : false;

  return (
    <main style={pageStyle}>
      <div style={shellStyle}>
        <PageHeader
          title="Office Update"
          description="Manage work order planning, add additional tasks when a work order is blocked, and activate or deactivate work orders as needed."
        />

        <section style={{ ...sectionCard, marginTop: "18px" }}>
          <h2 style={{ ...fieldTitleStyle, fontSize: "20px", marginBottom: "6px" }}>
            Work orders
          </h2>
          <div
            style={{
              fontSize: "14px",
              lineHeight: 1.5,
              color: COLORS.textSoft,
              marginBottom: "16px",
            }}
          >
            Choose whether you want to work with active or inactive work orders.
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: "16px",
            }}
          >
            <div style={innerCard}>
              <h2 style={{ ...fieldTitleStyle, fontSize: "20px", marginBottom: "6px" }}>
                Active work orders
              </h2>
              <div
                style={{
                  fontSize: "14px",
                  lineHeight: 1.5,
                  color: COLORS.textSoft,
                  marginBottom: "14px",
                }}
              >
                Open the update flow for work orders that are currently active in the shop.
              </div>
              <button
                type="button"
                onClick={() => changeMode("active")}
                style={modeBtn("active", mode === "active")}
              >
                Active ({activeOrders.length})
              </button>
            </div>

            <div style={innerCard}>
              <h2 style={{ ...fieldTitleStyle, fontSize: "20px", marginBottom: "6px" }}>
                Inactive work orders
              </h2>
              <div
                style={{
                  fontSize: "14px",
                  lineHeight: 1.5,
                  color: COLORS.textSoft,
                  marginBottom: "14px",
                }}
              >
                Review inactive work orders and activate them again when they are ready to work on.
              </div>
              <button
                type="button"
                onClick={() => changeMode("inactive")}
                style={modeBtn("inactive", mode === "inactive")}
              >
                Inactive ({inactiveOrders.length})
              </button>
            </div>
          </div>
        </section>

        {mode && (
          <section style={{ ...sectionCard, marginTop: "18px" }}>
            <h2
              style={{ ...fieldTitleStyle, fontSize: "20px", marginBottom: "4px" }}
            >
              {mode === "active"
                ? "Select active work order"
                : "Select inactive work order"}
            </h2>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.65fr 1fr",
                gap: "14px",
              }}
            >
              <div style={innerCard}>
                <div style={eyebrowStyle}>Search</div>
                <SearchableSelect
                  options={visibleOrders.map((o) => ({
                    value: o.work_order_id,
                    label: `${o.work_order_id} — ${o.customer || "No customer"} — ${o.part_number || "No PN"} — ${o.work_order_type || "Unknown type"}${aogPrioritySuffix(o)}`,
                  }))}
                  value={selectedId}
                  onChange={(v) => selectOrder(v)}
                  placeholder="Search by work order, customer or part number..."
                  style={{ marginTop: "2px" }}
                />
              </div>

              <div style={innerCard}>
                <div style={eyebrowStyle}>Browse list</div>
                <select
                  value={selectedId}
                  onChange={(e) => selectOrder(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">Select from list...</option>
                  {visibleOrders.map((o) => (
                    <option key={o.work_order_id} value={o.work_order_id}>
                      {o.work_order_id} — {o.customer || "No customer"} —{" "}
                      {o.part_number || "No PN"}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>
        )}

        {selectedOrder && (
          <>
            <section style={{ ...sectionCard, marginTop: "18px" }}>
              <div style={eyebrowStyle}>Selected work order</div>
              <h2 style={{ ...fieldTitleStyle, fontSize: "20px", marginBottom: "14px" }}>
                Current details
              </h2>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(8, 1fr)",
                  gap: "12px",
                }}
              >
                <InfoBox label="Work Order" value={selectedOrder.work_order_id} />
                <InfoBox label="Customer" value={selectedOrder.customer || "—"} />
                <InfoBox label="Part Number" value={selectedOrder.part_number || "—"} />
                <InfoBox
                  label="Work Order Type"
                  value={selectedOrder.work_order_type || "—"}
                />
                <InfoBox
                  label="Current Step"
                  value={selectedOrder.current_process_step || "—"}
                />
                <InfoBox label="Due Date" value={displayDate(selectedOrder.due_date)} />
                <InfoBox
                  label="Assigned"
                  value={normalizeAssignedPersonTeam(
                    selectedOrder.assigned_person_team,
                  )}
                />
                {selectedOrder.priority === "AOG" && (
                  <InfoBox label="Priority" value="AOG" />
                )}
              </div>
            </section>

            {!showEditor && (
              <section style={{ ...sectionCard, marginTop: "18px" }}>
                <div style={eyebrowStyle}>Activation</div>
                <h2 style={{ ...fieldTitleStyle, fontSize: "20px", marginBottom: "6px" }}>
                  Activate work order
                </h2>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.2fr 1fr",
                    gap: "14px",
                    alignItems: "start",
                  }}
                >
                  <div
                    style={{
                      padding: "14px",
                      backgroundColor: "#fffdfa",
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: "12px",
                    }}
                  >
                    <div style={eyebrowStyle}>What happens next</div>
                    <div
                      style={{
                        fontSize: "14px",
                        color: COLORS.text,
                        lineHeight: 1.5,
                      }}
                    >
                      Klik op <strong>Activate</strong> om hetzelfde update-menu te openen als bij
                      actieve work orders. Daar kun je daarna due date, priority, assignment en
                      blocked-informatie invullen voordat je opslaat.
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gap: "12px",
                    }}
                  >
                    <div
                      style={{
                        padding: "14px",
                        backgroundColor: COLORS.blueSoft,
                        border: "1px solid #d7e5ff",
                        borderRadius: "12px",
                        color: COLORS.blue,
                        fontWeight: 700,
                        fontSize: "13px",
                      }}
                    >
                      Step on activation:{" "}
                      <strong>
                        {form.activation_process_step ||
                          selectedOrder.current_process_step ||
                          getInitialProcessStep(selectedOrder.work_order_type)}
                      </strong>
                    </div>

                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <button type="button" onClick={startInactiveActivation} style={primaryBtn}>
                        Activate
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {showEditor && (
              <>
                <section style={{ marginTop: "18px" }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 0.8fr",
                      gap: "16px",
                    }}
                  >
                    <div style={sectionCard}>
                      <div style={eyebrowStyle}>Planning</div>
                      <h2
                        style={{
                          ...fieldTitleStyle,
                          fontSize: "20px",
                          marginBottom: "6px",
                        }}
                      >
                        Planning details
                      </h2>
                      <div style={{ display: "grid", gap: "10px" }}>
                        <div>
                          <div style={eyebrowStyle}>Due Date</div>
                          <input
                            type="date"
                            value={form.due_date}
                            onChange={(e) =>
                              setForm((prev) => ({
                                ...prev,
                                due_date: e.target.value,
                              }))
                            }
                            style={{
                              ...inputStyle,
                              borderColor:
                                dueDateRequired && !form.due_date
                                  ? "#c2410c"
                                  : COLORS.borderStrong,
                            }}
                          />
                          {dueDateRequired && !form.due_date && (
                            <div
                              style={{
                                marginTop: "6px",
                                fontSize: "12px",
                                color: COLORS.red,
                                fontWeight: 700,
                              }}
                            >
                              Due Date is required for Priority or AOG.
                            </div>
                          )}
                        </div>

                        <div>
                          <div style={eyebrowStyle}>Priority</div>
                          <select
                            value={form.priority}
                            onChange={(e) =>
                              setForm((prev) => ({
                                ...prev,
                                priority: e.target.value,
                              }))
                            }
                            style={inputStyle}
                          >
                            <option value="No">No</option>
                            <option value="Yes">PRIO</option>
                            <option value="AOG">AOG</option>
                          </select>
                        </div>

                        <div>
                          <div style={eyebrowStyle}>Assigned Person / Team</div>
                          <select
                            value={form.assigned_person_team}
                            onChange={(e) =>
                              setForm((prev) => ({
                                ...prev,
                                assigned_person_team: e.target.value,
                              }))
                            }
                            style={inputStyle}
                          >
                            <option value="">Shop (default)</option>
                            {shopStaff.map((s) => (
                              <option
                                key={s.id}
                                value={s.name}
                                disabled={todayAbsentEngineerIdSet.has(s.id)}
                              >
                                {s.name}
                                {todayAbsentEngineerIdSet.has(s.id)
                                  ? " (absent today)"
                                  : ""}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>

                    <div style={sectionCard}>
                      <div style={eyebrowStyle}>Corrective action</div>
                      <h2
                        style={{
                          ...fieldTitleStyle,
                          fontSize: "20px",
                          marginBottom: "6px",
                        }}
                      >
                        Blocked?
                      </h2>
                      <div style={{ display: "flex", gap: "10px", marginBottom: "14px" }}>
                        <button
                          type="button"
                          onClick={() => setBlockedChoice(false)}
                          style={choiceBtn(!isBlockedUpdate)}
                        >
                          No
                        </button>
                        <button
                          type="button"
                          onClick={() => setBlockedChoice(true)}
                          style={choiceBtn(isBlockedUpdate)}
                        >
                          Yes
                        </button>
                      </div>

                      {isBlockedUpdate ? (
                        <div
                          style={{
                            display: "grid",
                            gap: "10px",
                            padding: "14px",
                            backgroundColor: "#fffdfa",
                            border: `1px solid ${COLORS.border}`,
                            borderRadius: "12px",
                          }}
                        >
                          <div>
                            <div style={eyebrowStyle}>Hold Reason</div>
                            <input
                              value={form.hold_reason}
                              onChange={(e) =>
                                setForm((prev) => ({
                                  ...prev,
                                  hold_reason: e.target.value,
                                }))
                              }
                              placeholder="For example: awaiting customer approval..."
                              style={inputStyle}
                            />
                          </div>

                          <div>
                            <div style={eyebrowStyle}>Action Required</div>
                            <input
                              value={form.required_next_action}
                              onChange={(e) =>
                                setForm((prev) => ({
                                  ...prev,
                                  required_next_action: e.target.value,
                                }))
                              }
                              placeholder="What needs to happen?"
                              style={inputStyle}
                            />
                          </div>

                          <div>
                            <div style={eyebrowStyle}>Action Owner</div>
                            <select
                              value={form.action_owner}
                              onChange={(e) =>
                                setForm((prev) => ({
                                  ...prev,
                                  action_owner: e.target.value,
                                }))
                              }
                              style={inputStyle}
                            >
                              <option value="">Select owner...</option>
                              {officeStaff.length > 0 && (
                                <optgroup label="Office">
                                  {officeStaff.map((s) => (
                                    <option key={s.id} value={s.name}>
                                      {s.name}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                              {shopStaff.length > 0 && (
                                <optgroup label="Shop">
                                  {shopStaff.map((s) => (
                                    <option key={s.id} value={s.name}>
                                      {s.name}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                            </select>
                          </div>

                          <div
                            style={{
                              fontSize: "13px",
                              color: COLORS.textSoft,
                            }}
                          >
                            Status will be saved as <strong>Open</strong>.
                          </div>
                        </div>
                      ) : (
                        <div
                          style={{
                            padding: "12px",
                            borderRadius: "12px",
                            backgroundColor: COLORS.greenSoft,
                            border: "1px solid #cdeedc",
                            color: COLORS.green,
                            fontWeight: 700,
                            fontSize: "13px",
                          }}
                        >
                          No corrective action is currently set.
                        </div>
                      )}
                    </div>

                    <div style={sectionCard}>
                      <div style={eyebrowStyle}>Activation</div>
                      <h2
                        style={{
                          ...fieldTitleStyle,
                          fontSize: "20px",
                          marginBottom: "6px",
                        }}
                      >
                        Active status
                      </h2>
                      {!selectedOrder.is_active && (
                        <div style={{ marginBottom: "10px" }}>
                          <div style={eyebrowStyle}>Next Process Step On Activation</div>
                          <select
                            value={form.activation_process_step}
                            onChange={(e) =>
                              setForm((prev) => ({
                                ...prev,
                                activation_process_step: e.target.value,
                              }))
                            }
                            style={inputStyle}
                          >
                            {inactiveActivationStepOptions.map((step) => (
                              <option key={step} value={step}>
                                {step}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      <select
                        value={String(form.is_active)}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            is_active: e.target.value === "true",
                          }))
                        }
                        style={inputStyle}
                      >
                        <option value="true">Active</option>
                        <option value="false">Inactive</option>
                      </select>

                      <div
                        style={{
                          marginTop: "12px",
                          padding: "12px",
                          borderRadius: "12px",
                          backgroundColor: form.is_active
                            ? COLORS.blueSoft
                            : COLORS.amberSoft,
                          border: form.is_active
                            ? "1px solid #d7e5ff"
                            : "1px solid #e8c98f",
                          color: form.is_active ? COLORS.blue : COLORS.amber,
                          fontWeight: 700,
                          fontSize: "13px",
                        }}
                      >
                        {selectedOrder.is_active ? (
                          form.is_active ? (
                            "This work order will remain active."
                          ) : (
                            "This work order will be moved to Inactive after saving."
                          )
                        ) : form.is_active ? (
                          <>
                            This work order will be activated after saving.
                            <br />
                            Step on activation:{" "}
                            <strong>
                              {form.activation_process_step ||
                                selectedOrder.current_process_step ||
                                getInitialProcessStep(selectedOrder.work_order_type)}
                            </strong>
                          </>
                        ) : (
                          "This work order will remain inactive after saving."
                        )}
                      </div>
                    </div>
                  </div>
                </section>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: "10px",
                    marginTop: "18px",
                  }}
                >
                  {!selectedOrder.is_active && (
                    <button
                      type="button"
                      onClick={() => setShowInactiveActivationForm(false)}
                      style={secondaryBtn}
                    >
                      Cancel
                    </button>
                  )}
                  <button onClick={() => void saveWorkOrder()} style={primaryBtn}>
                    {selectedOrder.is_active ? "Save Work Order" : "Activate Work Order"}
                  </button>
                </div>
              </>
            )}
          </>
        )}

        <section style={{ ...sectionCard, marginTop: "18px" }}>
          <h2 style={{ ...fieldTitleStyle, fontSize: "20px", marginBottom: "6px" }}>
            Add an additional task
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.5fr 1fr 0.8fr auto",
              gap: "12px",
              alignItems: "end",
            }}
          >
            <div>
              <div style={eyebrowStyle}>Description</div>
              <input
                value={extraActionForm.description}
                onChange={(e) =>
                  setExtraActionForm((prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
                placeholder="What has to be done?"
                style={inputStyle}
              />
            </div>

            <div>
              <div style={eyebrowStyle}>Responsible Person / Team</div>
              <select
                value={extraActionForm.responsible_person_team}
                onChange={(e) =>
                  setExtraActionForm((prev) => ({
                    ...prev,
                    responsible_person_team: e.target.value,
                  }))
                }
                style={inputStyle}
              >
                <option value="">Shop (default)</option>
                {shopStaff.map((s) => (
                  <option
                    key={s.id}
                    value={s.name}
                    disabled={todayAbsentEngineerIdSet.has(s.id)}
                  >
                    {s.name}
                    {todayAbsentEngineerIdSet.has(s.id) ? " (absent today)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div style={eyebrowStyle}>Due Date</div>
              <input
                type="date"
                value={extraActionForm.due_date}
                onChange={(e) =>
                  setExtraActionForm((prev) => ({
                    ...prev,
                    due_date: e.target.value,
                  }))
                }
                style={inputStyle}
              />
            </div>

            <button
              type="button"
              onClick={() => void saveExtraAction()}
              style={primaryBtn}
            >
              Add action
            </button>
          </div>
        </section>

        {saveStatus && (
          <div
            style={{
              marginTop: "16px",
              padding: "12px 14px",
              backgroundColor: COLORS.cardBg,
              border: `1px solid ${COLORS.borderStrong}`,
              borderRadius: "12px",
              fontSize: "14px",
              color: COLORS.textSoft,
            }}
          >
            {saveStatus}
          </div>
        )}

        {extraActionStatus && (
          <div
            style={{
              marginTop: "16px",
              padding: "12px 14px",
              backgroundColor: COLORS.cardBg,
              border: `1px solid ${COLORS.borderStrong}`,
              borderRadius: "12px",
              fontSize: "14px",
              color: COLORS.textSoft,
            }}
          >
            {extraActionStatus}
          </div>
        )}
      </div>
    </main>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: "14px 14px 13px",
        backgroundColor: "#faf8f3",
        border: "1px solid #e2ddd1",
        borderRadius: "12px",
      }}
    >
      <div
        style={{
          fontSize: "11px",
          color: "#8b857a",
          marginBottom: "5px",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 700,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "15px",
          fontWeight: 700,
          color: "#1f2937",
          lineHeight: 1.3,
        }}
      >
        {value}
      </div>
    </div>
  );
}
