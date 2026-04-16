"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getCompletableStepsForType,
  getLastCompletedStep,
  getNextProcessStepAfterCompleted,
  hasOptionalSteps,
} from "@/lib/process-steps";
import { getWorkOrders, updateWorkOrder } from "@/lib/work-orders";
import { SearchableSelect } from "@/app/components/searchable-select";

type WorkOrder = {
  work_order_id: string;
  customer: string | null;
  part_number: string | null;
  work_order_type: string | null;
  current_process_step: string | null;
  hold_reason: string | null;
  required_next_action: string | null;
  action_owner: string | null;
  action_status: string | null;
  action_closed: boolean | null;
  priority: string | null;
  assigned_person_team: string | null;
  magnetic_test_required: boolean | null;
};

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

export default function ShopUpdatePage() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [completedStep, setCompletedStep] = useState("");
  const [stepTouched, setStepTouched] = useState(false);
  const [holdReason, setHoldReason] = useState("");
  const [requiredNextAction, setRequiredNextAction] = useState("");
  const [magneticTestRequired, setMagneticTestRequired] = useState(false);
  const [isBlockedUpdate, setIsBlockedUpdate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState("");

  useEffect(() => {
    async function load() {
      const data = await getWorkOrders<WorkOrder>({
        select:
          "work_order_id, customer, part_number, work_order_type, current_process_step, hold_reason, required_next_action, action_owner, action_status, action_closed, priority, assigned_person_team, magnetic_test_required",
        isOpen: true,
        isActive: true,
        orderBy: { column: "work_order_id", ascending: false },
      });

      setOrders(data);
      setLoading(false);
    }

    void load();
  }, []);

  const selectedOrder = useMemo(
    () => orders.find((o) => o.work_order_id === selectedId),
    [orders, selectedId],
  );

  const showMagneticTestOption =
    selectedOrder && hasOptionalSteps(selectedOrder.work_order_type);

  const completableSteps = getCompletableStepsForType(
    selectedOrder?.work_order_type || null,
    magneticTestRequired,
  );

  const previewNextStep =
    selectedOrder && completedStep
      ? getNextProcessStepAfterCompleted(
        selectedOrder.work_order_type,
        completedStep,
        magneticTestRequired,
      )
      : null;

  function priorityLabel(order: WorkOrder): string {
    if (order.priority === "AOG") return "AOG";
    if (order.priority === "Yes") return "Priority";
    return "Normal";
  }

  function selectOrder(id: string) {
    const order = orders.find((o) => o.work_order_id === id);
    if (!order) return;

    const mtRequired = order.magnetic_test_required ?? false;
    const hasBlocker = Boolean(order.hold_reason?.trim());

    setSelectedId(id);
    setMagneticTestRequired(mtRequired);
    setCompletedStep(
      getLastCompletedStep(
        order.work_order_type,
        order.current_process_step,
        mtRequired,
      ),
    );
    setStepTouched(false);
    setHoldReason(order.hold_reason || "");
    setRequiredNextAction(order.required_next_action || "");
    setIsBlockedUpdate(hasBlocker);
    setSaveStatus("");
  }

  function handleMagneticTestToggle(checked: boolean) {
    setMagneticTestRequired(checked);

    if (!selectedOrder) return;

    setCompletedStep(
      getLastCompletedStep(
        selectedOrder.work_order_type,
        selectedOrder.current_process_step,
        checked,
      ),
    );
    setStepTouched(false);
  }

  function handleCompletedStepChange(value: string) {
    setCompletedStep(value);
    setStepTouched(true);
  }

  function setBlockedChoice(blocked: boolean) {
    setIsBlockedUpdate(blocked);

    if (!blocked) {
      setHoldReason("");
      setRequiredNextAction("");
    }
  }

  async function saveUpdate() {
    if (!selectedId || !selectedOrder) return;

    if (!completedStep) {
      setSaveStatus("Please choose the completed step.");
      return;
    }

    if (isBlockedUpdate && !holdReason.trim()) {
      setSaveStatus("Please enter a hold reason.");
      return;
    }

    const nextProcessStep =
      getNextProcessStepAfterCompleted(
        selectedOrder.work_order_type,
        completedStep,
        magneticTestRequired,
      ) ?? completedStep;

    const normalizedHoldReason = holdReason.trim();
    const normalizedRequiredNextAction = requiredNextAction.trim();

    setSaveStatus("Saving...");

    const payload = {
      current_process_step: nextProcessStep,
      hold_reason: isBlockedUpdate ? normalizedHoldReason : null,
      required_next_action:
        isBlockedUpdate && normalizedRequiredNextAction
          ? normalizedRequiredNextAction
          : null,
      action_owner: isBlockedUpdate ? selectedOrder.action_owner || null : null,
      action_status: isBlockedUpdate ? "Open" : null,
      action_closed: false,
      magnetic_test_required: magneticTestRequired,
      last_manual_update: new Date().toISOString(),
    };

    const { error } = await updateWorkOrder(selectedId, payload);

    if (error) {
      setSaveStatus(`Error: ${error.message}`);
      return;
    }

    setOrders((prev) =>
      prev.map((o) =>
        o.work_order_id === selectedId
          ? {
            ...o,
            ...payload,
          }
          : o,
      ),
    );

    const savedId = selectedId;

    setSelectedId("");
    setCompletedStep("");
    setStepTouched(false);
    setHoldReason("");
    setRequiredNextAction("");
    setMagneticTestRequired(false);
    setIsBlockedUpdate(false);
    setSaveStatus(`✅ ${savedId} updated. Select the next work order.`);
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
    transition: "all 0.15s ease",
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
            🛠️
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
              Shop Update
            </h1>

            <p
              style={{
                margin: "10px 0 0",
                fontSize: "15px",
                color: COLORS.textSoft,
                maxWidth: "720px",
              }}
            >
              Select a work order, confirm the current details, then save the
              completed step or, if applicable, indicate why you cannot proceed with
              the work order.
            </p>
          </div>
        </div>

        {/* SELECT WORK ORDER */}
        <section style={sectionCard}>
          <div style={eyebrowStyle}>Select work order</div>
          <h2 style={{ ...fieldTitleStyle, fontSize: "20px", marginBottom: "4px" }}>
            Search or browse active work orders
          </h2>
          <p style={{ ...subtitleStyle, marginBottom: "14px" }}>
            {orders.length} active work orders available.
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
                options={orders.map((o) => ({
                  value: o.work_order_id,
                  label: `${o.work_order_id} — PN: ${o.part_number || "–"} — ${o.customer || "–"} — ${o.work_order_type || "–"} — ${priorityLabel(o)}`,
                }))}
                value={selectedId}
                onChange={(v) => selectOrder(v)}
                placeholder="Search by work order, part number or customer..."
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
                {orders.map((o) => (
                  <option key={o.work_order_id} value={o.work_order_id}>
                    {o.work_order_id} — {o.part_number || "–"} —{" "}
                    {o.customer || "–"}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {selectedOrder && (
          <>
            {/* SELECTED WORK ORDER */}
            <section style={{ ...sectionCard, marginTop: "18px" }}>
              <div style={eyebrowStyle}>Selected work order</div>
              <h2 style={{ ...fieldTitleStyle, fontSize: "20px", marginBottom: "14px" }}>
                Current work order details
              </h2>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(6, 1fr)",
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
                <InfoBox
                  label="Assigned"
                  value={selectedOrder.assigned_person_team || "—"}
                />
              </div>
            </section>

            {/* UPDATE AREA */}
            <section style={{ marginTop: "18px" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "16px",
                }}
              >
                {/* COMPLETED STEP */}
                <div style={sectionCard}>
                  <div style={eyebrowStyle}>Step update</div>
                  <h2
                    style={{ ...fieldTitleStyle, fontSize: "20px", marginBottom: "6px" }}
                  >
                    Completed Step
                  </h2>
                  <p style={{ ...subtitleStyle, marginBottom: "14px" }}>
                    Choose the completed step. The next step will be set
                    automatically.
                  </p>

                  {showMagneticTestOption && (
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "11px 12px",
                        backgroundColor: magneticTestRequired
                          ? COLORS.amberSoft
                          : COLORS.cardBg,
                        border: magneticTestRequired
                          ? `1px solid #e8c98f`
                          : `1px solid ${COLORS.border}`,
                        borderRadius: "10px",
                        cursor: "pointer",
                        fontSize: "14px",
                        color: COLORS.text,
                        marginBottom: "12px",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={magneticTestRequired}
                        onChange={(e) => handleMagneticTestToggle(e.target.checked)}
                        style={{ width: "16px", height: "16px", accentColor: "#d29b2d" }}
                      />
                      Magnetic Test required
                    </label>
                  )}

                  {completableSteps.length > 0 ? (
                    <>
                      <select
                        value={completedStep}
                        onChange={(e) => handleCompletedStepChange(e.target.value)}
                        style={inputStyle}
                      >
                        <option value="">Select completed step...</option>
                        {completableSteps.map((step) => (
                          <option key={step} value={step}>
                            {step}
                          </option>
                        ))}
                      </select>

                      {stepTouched && completedStep && previewNextStep && (
                        <div
                          style={{
                            marginTop: "12px",
                            padding: "10px 12px",
                            borderRadius: "10px",
                            backgroundColor: COLORS.blueSoft,
                            border: "1px solid #d7e5ff",
                            color: COLORS.blue,
                            fontWeight: 700,
                            fontSize: "13px",
                          }}
                        >
                          Next step: {previewNextStep}
                        </div>
                      )}

                      {stepTouched && completedStep && !previewNextStep && (
                        <div
                          style={{
                            marginTop: "12px",
                            padding: "10px 12px",
                            borderRadius: "10px",
                            backgroundColor: COLORS.greenSoft,
                            border: "1px solid #cdeedc",
                            color: COLORS.green,
                            fontWeight: 700,
                            fontSize: "13px",
                          }}
                        >
                          Final step completed — ready to close
                        </div>
                      )}
                    </>
                  ) : (
                    <div
                      style={{
                        padding: "10px 12px",
                        backgroundColor: COLORS.redSoft,
                        border: "1px solid #f0c9ba",
                        borderRadius: "10px",
                        color: COLORS.red,
                        fontWeight: 700,
                        fontSize: "13px",
                      }}
                    >
                      No steps available — work order type is not set.
                    </div>
                  )}
                </div>

                {/* BLOCKED */}
                <div style={sectionCard}>
                  <div style={eyebrowStyle}>Blocker update</div>
                  <h2
                    style={{ ...fieldTitleStyle, fontSize: "20px", marginBottom: "6px" }}
                  >
                    Blocked?
                  </h2>
                  <p style={{ ...subtitleStyle, marginBottom: "14px" }}>
                    Only complete this section if the work cannot continue.
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

                  {isBlockedUpdate && (
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
                      <input
                        value={holdReason}
                        onChange={(e) => setHoldReason(e.target.value)}
                        placeholder="Hold reason..."
                        style={inputStyle}
                      />
                      <input
                        value={requiredNextAction}
                        onChange={(e) => setRequiredNextAction(e.target.value)}
                        placeholder="Action required..."
                        style={inputStyle}
                      />
                      <div
                        style={{
                          fontSize: "13px",
                          color: COLORS.textSoft,
                          paddingTop: "2px",
                        }}
                      >
                        Status will be saved as <strong>Open</strong>.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* SAVE */}
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginTop: "18px",
              }}
            >
              <button onClick={() => void saveUpdate()} style={primaryBtn}>
                Save Update
              </button>
            </div>
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