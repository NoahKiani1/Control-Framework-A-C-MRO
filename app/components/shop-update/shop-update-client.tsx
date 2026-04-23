"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  getCompletableStepsForType,
  getLastCompletedStep,
  getNextProcessStepAfterCompleted,
  hasOptionalSteps,
  READY_TO_CLOSE_STEP,
} from "@/lib/process-steps";
import {
  applySuggestedAssignmentsForCurrentStep,
  autoAssignForStep,
} from "@/lib/auto-assign";
import { getEngineerAbsences, getEngineers } from "@/lib/engineers";
import { formatDate, normalizeAssignedPersonTeam } from "@/lib/work-order-rules";
import { getWorkOrders, updateWorkOrder } from "@/lib/work-orders";
import {
  ExtraAction,
  deleteExtraAction,
  getExtraActions,
  sortExtraActionsByDueDate,
} from "@/lib/extra-actions";
import { SearchableSelect } from "@/app/components/searchable-select";
import { PageHeader } from "@/app/components/page-header";

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

type StaffMember = {
  id: number;
  name: string;
  restrictions: string[] | null;
  employment_start_date?: string | null;
};

type Absence = {
  engineer_id: number;
  absence_date: string;
};

type ShopUpdateClientProps = {
  variant: "desktop" | "tablet";
};

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
  amberSoft: "#fff6e8",
  red: "#b42318",
  redSoft: "#fff2ef",
  inputBg: "#fffdf9",
  shadow: "0 1px 2px rgba(31, 41, 55, 0.04), 0 4px 12px rgba(31, 41, 55, 0.04)",
};

const FONT_STACK = "var(--font-inter), var(--font-geist-sans), sans-serif";

export function ShopUpdateClient({ variant }: ShopUpdateClientProps) {
  const isTablet = variant === "tablet";
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [shopStaff, setShopStaff] = useState<StaffMember[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [completedStep, setCompletedStep] = useState("");
  const [stepTouched, setStepTouched] = useState(false);
  const [holdReason, setHoldReason] = useState("");
  const [requiredNextAction, setRequiredNextAction] = useState("");
  const [magneticTestRequired, setMagneticTestRequired] = useState(false);
  const [isBlockedUpdate, setIsBlockedUpdate] = useState(false);
  const [todayAbsentEngineerIds, setTodayAbsentEngineerIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState("");
  const [extraActions, setExtraActions] = useState<ExtraAction[]>([]);
  const [extraActionToClose, setExtraActionToClose] = useState<ExtraAction | null>(null);
  const [extraActionCloseStatus, setExtraActionCloseStatus] = useState("");
  const [isClosingExtraAction, setIsClosingExtraAction] = useState(false);

  useEffect(() => {
    async function load() {
      const today = localDateKey();
      const [data, staffData, absenceData, extras] = await Promise.all([
        getWorkOrders<WorkOrder>({
          select:
            "work_order_id, customer, part_number, work_order_type, current_process_step, hold_reason, required_next_action, action_owner, action_status, action_closed, priority, assigned_person_team, magnetic_test_required",
          isOpen: true,
          isActive: true,
          orderBy: { column: "work_order_id", ascending: false },
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
      setOrders(
        applySuggestedAssignmentsForCurrentStep(
          data.filter((order) => order.current_process_step !== READY_TO_CLOSE_STEP),
          staffData,
          new Set(
            staffData
              .filter((engineer) =>
                absenceData.some(
                  (absence) =>
                    absence.absence_date === today &&
                    absence.engineer_id === engineer.id,
                ),
              )
              .map((engineer) => engineer.name),
          ),
        ),
      );
      setShopStaff(staffData);
      setTodayAbsentEngineerIds(
        absenceData
          .filter((absence) => absence.absence_date === today)
          .map((absence) => absence.engineer_id),
      );
      setLoading(false);
    }

    void load();
  }, []);

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

  function aogPrioritySuffix(order: WorkOrder): string {
    return order.priority === "AOG" ? " - AOG" : "";
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
    const assignedPersonTeam = autoAssignForStep(
      selectedOrder.assigned_person_team,
      nextProcessStep,
      shopStaff,
      todayAbsentShopEngineerNames,
    );

    setSaveStatus("Saving...");

    const payload = {
      current_process_step: nextProcessStep,
      assigned_person_team: assignedPersonTeam,
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
    setSaveStatus(`${savedId} updated. Select the next work order.`);
  }

  const pageStyle: CSSProperties = {
    minHeight: "100vh",
    backgroundColor: COLORS.pageBg,
    padding: isTablet ? "28px 22px 44px" : "32px 40px 40px",
    fontFamily: FONT_STACK,
    color: COLORS.text,
  };

  const shellStyle: CSSProperties = {
    width: "100%",
    maxWidth: isTablet ? "760px" : "1440px",
    margin: isTablet ? "0 auto" : undefined,
  };

  const sectionCard: CSSProperties = {
    backgroundColor: COLORS.panelBg,
    border: `1px solid ${COLORS.border}`,
    borderRadius: isTablet ? "22px" : "14px",
    padding: isTablet ? "22px" : "16px 18px",
    boxShadow: COLORS.shadow,
  };

  const innerCard: CSSProperties = {
    backgroundColor: COLORS.cardBg,
    border: `1px solid ${COLORS.border}`,
    borderRadius: isTablet ? "18px" : "14px",
    padding: isTablet ? "18px" : "15px",
  };

  const inputStyle: CSSProperties = {
    width: "100%",
    padding: isTablet ? "16px 16px" : "10px 12px",
    border: `1px solid ${COLORS.borderStrong}`,
    borderRadius: isTablet ? "14px" : "10px",
    fontSize: isTablet ? "18px" : "14px",
    boxSizing: "border-box",
    backgroundColor: COLORS.inputBg,
    color: COLORS.text,
    minHeight: isTablet ? "58px" : "42px",
    outline: "none",
  };

  const subtitleStyle: CSSProperties = {
    margin: "4px 0 0",
    fontSize: isTablet ? "16px" : "14px",
    color: COLORS.textSoft,
    lineHeight: 1.5,
  };

  const fieldTitleStyle: CSSProperties = {
    fontSize: isTablet ? "22px" : "16px",
    fontWeight: 650,
    color: COLORS.heading,
    margin: 0,
    letterSpacing: "-0.015em",
  };

  const eyebrowStyle: CSSProperties = {
    fontSize: isTablet ? "12px" : "11px",
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: COLORS.textMuted,
    marginBottom: "6px",
  };

  const choiceBtn = (active: boolean): CSSProperties => ({
    flex: 1,
    padding: isTablet ? "17px 16px" : "10px 12px",
    borderRadius: isTablet ? "15px" : "10px",
    border: `1px solid ${active ? "#d7e3ff" : COLORS.border}`,
    backgroundColor: active ? COLORS.blueSoft : COLORS.panelBg,
    color: active ? COLORS.blue : COLORS.textSoft,
    fontWeight: 700,
    fontSize: isTablet ? "17px" : "13px",
    cursor: "pointer",
    boxShadow: active ? "0 1px 2px rgba(31, 41, 55, 0.04)" : "none",
    minHeight: isTablet ? "58px" : undefined,
  });

  const primaryBtn: CSSProperties = {
    padding: isTablet ? "17px 24px" : "11px 18px",
    backgroundColor: COLORS.blue,
    color: "white",
    border: `1px solid ${COLORS.blue}`,
    borderRadius: isTablet ? "16px" : "10px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: isTablet ? "18px" : "14px",
    boxShadow: "0 8px 20px rgba(37, 85, 199, 0.18)",
    minHeight: isTablet ? "60px" : undefined,
  };

  if (loading) {
    return (
      <div style={{ ...pageStyle, color: COLORS.textSoft }}>
        Loading...
      </div>
    );
  }

  const workOrderOptions = orders.map((o) => ({
    value: o.work_order_id,
    label: `${o.work_order_id} - PN: ${o.part_number || "-"} - ${o.customer || "-"} - ${o.work_order_type || "-"}${aogPrioritySuffix(o)}`,
  }));

  return (
    <main style={pageStyle}>
      <div style={shellStyle}>
        <PageHeader
          title={isTablet ? "Shop Form" : "Shop Update"}
          description={
            isTablet
              ? "Touch-friendly shop update for portrait iPad. Select a work order, confirm the completed step, and save the update."
              : "Select a work order, confirm the current details, then save the completed step or, if applicable, indicate why you cannot proceed with the work order."
          }
        />

        <section style={{ ...sectionCard, marginBottom: isTablet ? "22px" : "18px" }}>
          <h2 style={{ ...fieldTitleStyle, fontSize: isTablet ? "25px" : "20px", marginBottom: "4px" }}>
            Search for a work order to update
          </h2>
          <p style={{ ...subtitleStyle, marginBottom: isTablet ? "18px" : "14px" }}>
            {orders.length} active work orders available.
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: isTablet ? "1fr" : "1.65fr 1fr",
              gap: isTablet ? "16px" : "14px",
            }}
          >
            <div style={innerCard}>
              <div style={eyebrowStyle}>Search</div>
              <SearchableSelect
                options={workOrderOptions}
                value={selectedId}
                onChange={(v) => selectOrder(v)}
                placeholder="Search by work order, part number or customer..."
                style={{ marginTop: "2px" }}
                inputStyle={
                  isTablet
                    ? {
                        padding: "16px",
                        borderRadius: "14px",
                        fontSize: "18px",
                        minHeight: "58px",
                        backgroundColor: COLORS.inputBg,
                        borderColor: COLORS.borderStrong,
                      }
                    : undefined
                }
                optionStyle={
                  isTablet
                    ? {
                        padding: "15px 16px",
                        fontSize: "17px",
                      }
                    : undefined
                }
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
                    {o.work_order_id} - {o.part_number || "-"} - {o.customer || "-"}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section style={{ ...sectionCard, marginBottom: selectedOrder ? 0 : undefined }}>
          <h2 style={{ ...fieldTitleStyle, fontSize: isTablet ? "25px" : "20px", marginBottom: "4px" }}>
            Complete an additional task
          </h2>
          <p style={{ ...subtitleStyle, marginBottom: isTablet ? "18px" : "14px" }}>
            {extraActions.length === 0
              ? "No additional tasks outstanding."
              : `${extraActions.length} additional task${extraActions.length !== 1 ? "s" : ""} outstanding.`}
          </p>

          {extraActions.length > 0 && (
            <div style={{ display: "grid", gap: isTablet ? "14px" : "10px" }}>
              {extraActions.map((action) => (
                <div
                  key={action.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: isTablet ? "1fr" : "1.7fr 1fr 0.8fr auto",
                    gap: isTablet ? "14px" : "12px",
                    alignItems: "center",
                    padding: isTablet ? "18px" : "12px 14px",
                    borderRadius: isTablet ? "18px" : "12px",
                    border: `1px solid ${COLORS.border}`,
                    backgroundColor: COLORS.cardBg,
                  }}
                >
                  <div>
                    <div style={eyebrowStyle}>Description</div>
                    <div style={{ fontSize: isTablet ? "18px" : "15px", fontWeight: 600, color: COLORS.text }}>
                      {action.description}
                    </div>
                  </div>
                  <div>
                    <div style={eyebrowStyle}>Responsible</div>
                    <div style={{ fontSize: isTablet ? "16px" : "14px", color: COLORS.text }}>
                      {normalizeAssignedPersonTeam(action.responsible_person_team)}
                    </div>
                  </div>
                  <div>
                    <div style={eyebrowStyle}>Due date</div>
                    <div style={{ fontSize: isTablet ? "16px" : "14px", color: COLORS.text }}>
                      {formatDate(action.due_date)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openCloseExtraActionConfirmation(action)}
                    style={{ ...primaryBtn, width: isTablet ? "100%" : undefined }}
                  >
                    Complete
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {selectedOrder && (
          <>
            <section style={{ ...sectionCard, marginTop: isTablet ? "22px" : "18px" }}>
              <div style={eyebrowStyle}>Selected work order</div>
              <h2 style={{ ...fieldTitleStyle, fontSize: isTablet ? "25px" : "20px", marginBottom: isTablet ? "18px" : "14px" }}>
                Current work order details
              </h2>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isTablet ? "1fr 1fr" : "repeat(6, 1fr)",
                  gap: isTablet ? "14px" : "12px",
                }}
              >
                <InfoBox label="Work Order" value={selectedOrder.work_order_id} large={isTablet} />
                <InfoBox label="Customer" value={selectedOrder.customer || "-"} large={isTablet} />
                <InfoBox label="Part Number" value={selectedOrder.part_number || "-"} large={isTablet} />
                <InfoBox label="Work Order Type" value={selectedOrder.work_order_type || "-"} large={isTablet} />
                <InfoBox label="Current Step" value={selectedOrder.current_process_step || "-"} large={isTablet} />
                <InfoBox
                  label="Assigned"
                  value={normalizeAssignedPersonTeam(selectedOrder.assigned_person_team)}
                  large={isTablet}
                />
              </div>
            </section>

            <section style={{ marginTop: isTablet ? "22px" : "18px" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isTablet ? "1fr" : "1fr 1fr",
                  gap: isTablet ? "22px" : "16px",
                }}
              >
                <div style={sectionCard}>
                  <div style={eyebrowStyle}>Step update</div>
                  <h2 style={{ ...fieldTitleStyle, fontSize: isTablet ? "25px" : "20px", marginBottom: "6px" }}>
                    Completed Step
                  </h2>

                  {showMagneticTestOption && (
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: isTablet ? "12px" : "8px",
                        padding: isTablet ? "16px" : "11px 12px",
                        backgroundColor: magneticTestRequired ? COLORS.amberSoft : COLORS.cardBg,
                        border: magneticTestRequired
                          ? "1px solid #e8c98f"
                          : `1px solid ${COLORS.border}`,
                        borderRadius: isTablet ? "16px" : "10px",
                        cursor: "pointer",
                        fontSize: isTablet ? "17px" : "14px",
                        color: COLORS.text,
                        marginBottom: isTablet ? "16px" : "12px",
                        minHeight: isTablet ? "58px" : undefined,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={magneticTestRequired}
                        onChange={(e) => handleMagneticTestToggle(e.target.checked)}
                        style={{
                          width: isTablet ? "24px" : "16px",
                          height: isTablet ? "24px" : "16px",
                          accentColor: "#d29b2d",
                        }}
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

                      {stepTouched &&
                        completedStep &&
                        previewNextStep &&
                        previewNextStep !== READY_TO_CLOSE_STEP && (
                          <StatusNote color="blue" large={isTablet}>
                            Next step: {previewNextStep}
                          </StatusNote>
                        )}

                      {stepTouched &&
                        completedStep &&
                        previewNextStep === READY_TO_CLOSE_STEP && (
                          <StatusNote color="green" large={isTablet}>
                            Final step completed - ready to close
                          </StatusNote>
                        )}
                    </>
                  ) : (
                    <StatusNote color="red" large={isTablet}>
                      No steps available - work order type is not set.
                    </StatusNote>
                  )}
                </div>

                <div style={sectionCard}>
                  <div style={eyebrowStyle}>Blocker update</div>
                  <h2 style={{ ...fieldTitleStyle, fontSize: isTablet ? "25px" : "20px", marginBottom: "6px" }}>
                    Blocked?
                  </h2>
                  <p style={{ ...subtitleStyle, marginBottom: isTablet ? "18px" : "14px" }}>
                    Only complete this section if the work cannot continue.
                  </p>

                  <div style={{ display: "flex", gap: isTablet ? "14px" : "10px", marginBottom: isTablet ? "18px" : "14px" }}>
                    <button type="button" onClick={() => setBlockedChoice(false)} style={choiceBtn(!isBlockedUpdate)}>
                      No
                    </button>
                    <button type="button" onClick={() => setBlockedChoice(true)} style={choiceBtn(isBlockedUpdate)}>
                      Yes
                    </button>
                  </div>

                  {isBlockedUpdate && (
                    <div
                      style={{
                        display: "grid",
                        gap: isTablet ? "14px" : "10px",
                        padding: isTablet ? "18px" : "14px",
                        backgroundColor: "#fffdfa",
                        border: `1px solid ${COLORS.border}`,
                        borderRadius: isTablet ? "18px" : "12px",
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
                      <div style={{ fontSize: isTablet ? "15px" : "13px", color: COLORS.textSoft, paddingTop: "2px" }}>
                        Status will be saved as <strong>Open</strong>.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginTop: isTablet ? "24px" : "18px",
              }}
            >
              <button
                onClick={() => void saveUpdate()}
                style={{ ...primaryBtn, width: isTablet ? "100%" : undefined }}
              >
                Save Update
              </button>
            </div>
          </>
        )}

        {saveStatus && (
          <div
            style={{
              marginTop: "16px",
              padding: isTablet ? "16px 18px" : "12px 14px",
              backgroundColor: COLORS.cardBg,
              border: `1px solid ${COLORS.borderStrong}`,
              borderRadius: isTablet ? "16px" : "12px",
              fontSize: isTablet ? "16px" : "14px",
              color: COLORS.textSoft,
            }}
          >
            {saveStatus}
          </div>
        )}
      </div>

      {extraActionToClose && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(31, 41, 55, 0.28)",
            display: "grid",
            placeItems: "center",
            padding: isTablet ? "22px" : "24px",
            zIndex: 60,
          }}
          onMouseDown={closeCloseExtraActionConfirmation}
        >
          <div
            style={{
              width: "100%",
              maxWidth: isTablet ? "620px" : "520px",
              backgroundColor: "#fcfaf6",
              border: `1px solid ${COLORS.borderStrong}`,
              borderRadius: isTablet ? "24px" : "18px",
              boxShadow: "0 20px 50px rgba(31, 41, 55, 0.18)",
              padding: isTablet ? "22px" : "18px",
            }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div style={{ marginBottom: "14px" }}>
              <div style={eyebrowStyle}>Complete additional task</div>
              <h2
                style={{
                  margin: 0,
                  fontSize: isTablet ? "26px" : "22px",
                  fontWeight: 750,
                  letterSpacing: "-0.025em",
                  color: COLORS.text,
                  lineHeight: 1.1,
                }}
              >
                {extraActionToClose.description}
              </h2>
            </div>

            <div style={{ ...innerCard, display: "grid", gap: isTablet ? "14px" : "10px" }}>
              <div>
                <div style={eyebrowStyle}>Responsible</div>
                <div style={{ fontSize: isTablet ? "17px" : "14px", color: COLORS.text }}>
                  {normalizeAssignedPersonTeam(extraActionToClose.responsible_person_team)}
                </div>
              </div>
              <div>
                <div style={eyebrowStyle}>Due date</div>
                <div style={{ fontSize: isTablet ? "17px" : "14px", color: COLORS.text }}>
                  {formatDate(extraActionToClose.due_date)}
                </div>
              </div>

              <StatusNote color="red" large={isTablet}>
                This cannot be undone. The task will be permanently removed.
              </StatusNote>

              {extraActionCloseStatus && (
                <StatusNote
                  color={extraActionCloseStatus.startsWith("Error:") ? "red" : "neutral"}
                  large={isTablet}
                >
                  {extraActionCloseStatus}
                </StatusNote>
              )}
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: isTablet ? "14px" : "10px",
                marginTop: isTablet ? "18px" : "14px",
              }}
            >
              <button
                type="button"
                onClick={closeCloseExtraActionConfirmation}
                style={{
                  padding: isTablet ? "16px 20px" : "10px 14px",
                  borderRadius: isTablet ? "15px" : "10px",
                  border: `1px solid ${COLORS.borderStrong}`,
                  backgroundColor: COLORS.panelBg,
                  color: COLORS.text,
                  fontSize: isTablet ? "17px" : "14px",
                  fontWeight: 700,
                  cursor: "pointer",
                  minHeight: isTablet ? "58px" : undefined,
                }}
                disabled={isClosingExtraAction}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmCloseExtraAction()}
                style={primaryBtn}
                disabled={isClosingExtraAction}
              >
                Complete task
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function InfoBox({
  label,
  value,
  large = false,
}: {
  label: string;
  value: string;
  large?: boolean;
}) {
  return (
    <div
      style={{
        padding: large ? "17px" : "14px 14px 13px",
        backgroundColor: COLORS.cardBg,
        border: `1px solid ${COLORS.border}`,
        borderRadius: large ? "16px" : "12px",
      }}
    >
      <div
        style={{
          fontSize: large ? "12px" : "11px",
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
          fontSize: large ? "17px" : "15px",
          fontWeight: 700,
          color: COLORS.text,
          lineHeight: 1.3,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function StatusNote({
  children,
  color,
  large = false,
}: {
  children: React.ReactNode;
  color: "blue" | "green" | "red" | "neutral";
  large?: boolean;
}) {
  const palette = {
    blue: {
      backgroundColor: COLORS.blueSoft,
      border: "1px solid #d7e5ff",
      color: COLORS.blue,
    },
    green: {
      backgroundColor: COLORS.greenSoft,
      border: "1px solid #cdeedc",
      color: COLORS.green,
    },
    red: {
      backgroundColor: COLORS.redSoft,
      border: "1px solid #f0c9ba",
      color: COLORS.red,
    },
    neutral: {
      backgroundColor: COLORS.cardBg,
      border: `1px solid ${COLORS.border}`,
      color: COLORS.textSoft,
    },
  }[color];

  return (
    <div
      style={{
        marginTop: color === "red" || color === "neutral" ? 0 : large ? "16px" : "12px",
        padding: large ? "15px 16px" : "10px 12px",
        borderRadius: large ? "15px" : "10px",
        fontSize: large ? "16px" : "13px",
        fontWeight: 700,
        lineHeight: 1.45,
        ...palette,
      }}
    >
      {children}
    </div>
  );
}
