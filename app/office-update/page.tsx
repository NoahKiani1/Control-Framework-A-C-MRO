"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getEngineerAbsences, getEngineers } from "@/lib/engineers";
import { getWorkOrders, updateWorkOrderAndFetch } from "@/lib/work-orders";
import { autoAssignForStep } from "@/lib/auto-assign";
import {
  DEFAULT_ASSIGNED_PERSON_TEAM,
  normalizeAssignedPersonTeam,
} from "@/lib/work-order-rules";
import { SearchableSelect } from "@/app/components/searchable-select";

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
};

type FormState = {
  due_date: string;
  priority: string;
  assigned_person_team: string;
  hold_reason: string;
  required_next_action: string;
  action_owner: string;
  is_active: boolean;
};

type Mode = "active" | "inactive" | null;

const EMPTY_FORM: FormState = {
  due_date: "",
  priority: "No",
  assigned_person_team: "",
  hold_reason: "",
  required_next_action: "",
  action_owner: "",
  is_active: true,
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
  pageBg: "#f7f2e8",
  panelBg: "#fcfaf6",
  cardBg: "#ffffff",
  border: "#ddd3c3",
  borderStrong: "#cdbfa9",
  text: "#1f2937",
  textSoft: "#6b7280",
  textMuted: "#8b857a",
  heading: "#1d2a3a",
  blue: "#2f5fd7",
  blueSoft: "#eef4ff",
  green: "#18794e",
  greenSoft: "#eefbf3",
  amber: "#b7791f",
  amberSoft: "#fff7e8",
  red: "#c2410c",
  redSoft: "#fff1eb",
  inputBg: "#fffdf9",
};

export default function OfficeUpdatePage() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [shopStaff, setShopStaff] = useState<StaffMember[]>([]);
  const [officeStaff, setOfficeStaff] = useState<StaffMember[]>([]);
  const [todayAbsentEngineerIds, setTodayAbsentEngineerIds] = useState<number[]>([]);
  const [mode, setMode] = useState<Mode>(null);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [isBlockedUpdate, setIsBlockedUpdate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState("");

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
      is_active: order.is_active,
    };
  }, []);

  const applyOrderSelection = useCallback(
    (order: WorkOrder) => {
      setSelectedId(order.work_order_id);
      setForm(buildFormFromOrder(order));
      setIsBlockedUpdate(Boolean(order.hold_reason?.trim()));
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
      setOrders(wo);
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

  async function saveActiveOrder() {
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

    const payload = {
      due_date: form.due_date || null,
      priority: form.priority,
      assigned_person_team: normalizedAssigned,
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

  async function activateInactiveOrder() {
    if (!selectedId || !selectedOrder) return;

    const preservedStep = selectedOrder.current_process_step?.trim() || "";
    const nextProcessStep = preservedStep || "Intake";

    setSaveStatus("Activating...");

    const payload = {
      is_active: true,
      current_process_step: nextProcessStep,
      assigned_person_team: autoAssignForStep(
        selectedOrder.assigned_person_team,
        nextProcessStep,
        shopStaff,
        todayAbsentShopEngineerNames,
      ),
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

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          backgroundColor: COLORS.pageBg,
          padding: "28px",
          color: COLORS.textSoft,
          fontFamily: "sans-serif",
        }}
      >
        Loading...
      </div>
    );
  }

  const pageStyle: React.CSSProperties = {
    minHeight: "100vh",
    backgroundColor: COLORS.pageBg,
    padding: "28px 32px 40px",
    fontFamily: "sans-serif",
    color: COLORS.text,
  };

  const shellStyle: React.CSSProperties = {
    maxWidth: "1220px",
    margin: "0 auto",
  };

  const sectionCard: React.CSSProperties = {
    backgroundColor: COLORS.panelBg,
    border: `1px solid ${COLORS.borderStrong}`,
    borderRadius: "18px",
    padding: "18px",
    boxShadow: "0 8px 24px rgba(73, 52, 18, 0.05)",
  };

  const innerCard: React.CSSProperties = {
    backgroundColor: COLORS.cardBg,
    border: `1px solid ${COLORS.border}`,
    borderRadius: "14px",
    padding: "16px",
    boxShadow: "0 2px 6px rgba(0,0,0,0.03)",
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

  const subtitleStyle: React.CSSProperties = {
    margin: "4px 0 0",
    fontSize: "14px",
    color: COLORS.textSoft,
  };

  const fieldTitleStyle: React.CSSProperties = {
    fontSize: "15px",
    fontWeight: 700,
    color: COLORS.heading,
    margin: 0,
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
    padding: "11px 16px",
    borderRadius: "12px",
    border: active
      ? `2px solid ${kind === "active" ? COLORS.blue : COLORS.amber}`
      : `1px solid ${COLORS.borderStrong}`,
    backgroundColor: active
      ? kind === "active"
        ? COLORS.blueSoft
        : COLORS.amberSoft
      : COLORS.cardBg,
    color: active
      ? kind === "active"
        ? COLORS.blue
        : COLORS.amber
      : COLORS.textSoft,
    fontWeight: 800,
    fontSize: "14px",
    cursor: "pointer",
    transition: "all 0.15s ease",
  });

  const choiceBtn = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: "10px 12px",
    borderRadius: "10px",
    border: active
      ? `2px solid ${COLORS.blue}`
      : `1px solid ${COLORS.borderStrong}`,
    backgroundColor: active ? COLORS.blueSoft : COLORS.cardBg,
    color: active ? COLORS.blue : COLORS.textSoft,
    fontWeight: 700,
    fontSize: "14px",
    cursor: "pointer",
  });

  const primaryBtn: React.CSSProperties = {
    padding: "12px 28px",
    backgroundColor: COLORS.blue,
    color: "white",
    border: "none",
    borderRadius: "12px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "15px",
    boxShadow: "0 8px 20px rgba(47,95,215,0.22)",
  };

  return (
    <div style={pageStyle}>
      <div style={shellStyle}>
        <div
          style={{
            marginBottom: "20px",
            display: "flex",
            alignItems: "center",
            gap: "16px",
          }}
        >
          <div
            style={{
              width: "68px",
              height: "68px",
              borderRadius: "18px",
              backgroundColor: "#fffdfa",
              border: "1px solid #d6cbb8",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 6px 18px rgba(73, 52, 18, 0.08)",
              flexShrink: 0,
              fontSize: "34px",
              lineHeight: 1,
            }}
          >
            💻
          </div>

          <div>
            <h1
              style={{
                margin: 0,
                fontSize: "34px",
                lineHeight: 1.05,
                fontWeight: 800,
                color: COLORS.heading,
                letterSpacing: "-0.03em",
              }}
            >
              Office Update
            </h1>

            <p
              style={{
                margin: "10px 0 0",
                fontSize: "15px",
                color: COLORS.textSoft,
                maxWidth: "760px",
              }}
            >
              Here you can manage the work order planning, add additional tasks
              when a work order is blocked, and activate or deactivate work
              orders as needed.
            </p>
          </div>
        </div>

        <section style={sectionCard}>
          <h2 style={{ ...fieldTitleStyle, fontSize: "20px", marginBottom: "10px" }}>
            Choose an active or inactive work order to update
          </h2>

          <div style={{ display: "flex", gap: "12px" }}>
            <button
              type="button"
              onClick={() => changeMode("active")}
              style={modeBtn("active", mode === "active")}
            >
              Active ({activeOrders.length})
            </button>

            <button
              type="button"
              onClick={() => changeMode("inactive")}
              style={modeBtn("inactive", mode === "inactive")}
            >
              Inactive ({inactiveOrders.length})
            </button>
          </div>

          {mode && (
            <div
              style={{
                marginTop: "18px",
                paddingTop: "18px",
                borderTop: `1px solid ${COLORS.border}`,
              }}
            >
              <div style={eyebrowStyle}>
                {mode === "active" ? "Active work orders" : "Inactive work orders"}
              </div>

              <h2
                style={{ ...fieldTitleStyle, fontSize: "20px", marginBottom: "4px" }}
              >
                Select work order
              </h2>

              <p style={{ ...subtitleStyle, marginBottom: "14px" }}>
                Search or browse only within the currently selected group.
              </p>

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
            </div>
          )}
        </section>

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

            {mode === "active" ? (
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
                      <p style={{ ...subtitleStyle, marginBottom: "14px" }}>
                        Update due date, priority, and assignment.
                      </p>

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
                            <option value="Yes">Yes</option>
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
                      <p style={{ ...subtitleStyle, marginBottom: "14px" }}>
                        Only use this when the work order cannot continue.
                      </p>

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
                      <p style={{ ...subtitleStyle, marginBottom: "14px" }}>
                        Keep this work order active or move it back to Inactive.
                      </p>

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
                        {form.is_active
                          ? "This work order will remain active."
                          : "This work order will be moved to Inactive after saving."}
                      </div>
                    </div>
                  </div>
                </section>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    marginTop: "18px",
                  }}
                >
                  <button onClick={() => void saveActiveOrder()} style={primaryBtn}>
                    Save Work Order
                  </button>
                </div>
              </>
            ) : (
              <>
                <section style={{ ...sectionCard, marginTop: "18px" }}>
                  <div style={eyebrowStyle}>Activation</div>
                  <h2
                    style={{
                      ...fieldTitleStyle,
                      fontSize: "20px",
                      marginBottom: "6px",
                    }}
                  >
                    Activate work order
                  </h2>
                  <p style={{ ...subtitleStyle, marginBottom: "14px" }}>
                    This inactive work order can be activated and moved back into
                    the live flow.
                  </p>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.2fr 1fr",
                      gap: "14px",
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
                      <div style={eyebrowStyle}>What happens on activation</div>
                      <div
                        style={{
                          fontSize: "14px",
                          color: COLORS.text,
                          lineHeight: 1.5,
                        }}
                      >
                        If the work order already has a process step, that step
                        is kept. Otherwise it starts at <strong>Intake</strong>.
                      </div>
                    </div>

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
                      Current stored step:{" "}
                      <strong>{selectedOrder.current_process_step || "Intake"}</strong>
                    </div>
                  </div>
                </section>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    marginTop: "18px",
                  }}
                >
                  <button onClick={() => void activateInactiveOrder()} style={primaryBtn}>
                    Activate Work Order
                  </button>
                </div>
              </>
            )}
          </>
        )}

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
      </div>
    </div>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: "14px 14px 13px",
        backgroundColor: "#fffdfa",
        border: "1px solid #ddd3c3",
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
