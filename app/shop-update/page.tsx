"use client";

import { useEffect, useState } from "react";
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

export default function ShopUpdatePage() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [completedStep, setCompletedStep] = useState("");
  const [holdReason, setHoldReason] = useState("");
  const [requiredNextAction, setRequiredNextAction] = useState("");
  const [actionStatus, setActionStatus] = useState("");
  const [magneticTestRequired, setMagneticTestRequired] = useState(false);
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

  function selectOrder(id: string) {
    const order = orders.find((o) => o.work_order_id === id);
    if (!order) return;

    const mtRequired = order.magnetic_test_required ?? false;
    const hasHold = Boolean(order.hold_reason?.trim());

    setSelectedId(id);
    setMagneticTestRequired(mtRequired);
    setCompletedStep(
      getLastCompletedStep(
        order.work_order_type,
        order.current_process_step,
        mtRequired,
      ),
    );
    setHoldReason(order.hold_reason || "");
    setRequiredNextAction(hasHold ? order.required_next_action || "" : "");
    setActionStatus(hasHold ? order.action_status || "Open" : "");
    setSaveStatus("");
  }

  function handleMagneticTestToggle(checked: boolean) {
    setMagneticTestRequired(checked);

    const order = orders.find((o) => o.work_order_id === selectedId);
    if (order) {
      setCompletedStep(
        getLastCompletedStep(
          order.work_order_type,
          order.current_process_step,
          checked,
        ),
      );
    }
  }

  function updateHoldReason(value: string) {
    const trimmed = value.trim();

    if (!trimmed) {
      setHoldReason("");
      setRequiredNextAction("");
      setActionStatus("");
      return;
    }

    const isNewAction = !holdReason.trim() || actionStatus === "Done";

    setHoldReason(value);
    setActionStatus(isNewAction ? "Open" : actionStatus || "Open");
  }

  function handleActionStatusChange(status: string) {
    if (status === "Done") {
      setActionStatus("Done");
      setHoldReason("");
      setRequiredNextAction("");
      return;
    }

    setActionStatus(status);
  }

  async function saveUpdate() {
    if (!selectedId) return;

    const selectedOrder = orders.find((o) => o.work_order_id === selectedId);
    if (!selectedOrder) return;

    if (!completedStep) {
      setSaveStatus("Please choose the completed step.");
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
    const shouldStoreActionFields = Boolean(normalizedHoldReason);

    setSaveStatus("Saving...");

    const payload = {
      current_process_step: nextProcessStep,
      hold_reason: shouldStoreActionFields ? normalizedHoldReason : null,
      required_next_action:
        shouldStoreActionFields && normalizedRequiredNextAction
          ? normalizedRequiredNextAction
          : null,
      action_owner: shouldStoreActionFields ? selectedOrder.action_owner || null : null,
      action_status: shouldStoreActionFields ? actionStatus || "Open" : null,
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

    // Reset form for the next update
    const savedId = selectedId;
    setSelectedId("");
    setCompletedStep("");
    setHoldReason("");
    setRequiredNextAction("");
    setActionStatus("");
    setMagneticTestRequired(false);
    setSaveStatus(`✅ ${savedId} updated! Select the next work order.`);
  }

  if (loading) return <div style={{ padding: "24px" }}>Loading...</div>;

  const selectedOrder = orders.find((o) => o.work_order_id === selectedId);
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

  const hasHoldReason = Boolean(holdReason.trim());

  const labelStyle: React.CSSProperties = {
    display: "block",
    marginTop: "12px",
    fontWeight: "bold",
    fontSize: "14px",
  };

  const selectStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px",
    border: "1px solid #ccc",
    borderRadius: "4px",
    fontSize: "16px",
    marginTop: "4px",
  };

  const inputStyle: React.CSSProperties = {
    ...selectStyle,
  };

  const helperStyle: React.CSSProperties = {
    marginTop: "4px",
    fontSize: "12px",
    color: "#666",
  };

  const buttonStyle: React.CSSProperties = {
    padding: "12px 24px",
    backgroundColor: "#0070f3",
    color: "white",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    fontWeight: "bold",
    fontSize: "16px",
    marginTop: "16px",
    width: "100%",
  };

  function prioLabel(order: WorkOrder): string {
    if (order.priority === "AOG") return " AOG";
    if (order.priority === "Yes") return " Prio";
    return "";
  }

  return (
    <div style={{ maxWidth: "700px", margin: "0 auto", padding: "24px" }}>
      <h1>📍 Shop Update</h1>

      <p>
        Update the completed shop step or report a blocker. ({orders.length} active
        orders)
      </p>

      <label style={labelStyle}>Select Work Order</label>
      <SearchableSelect
        options={orders.map((o) => ({
          value: o.work_order_id,
          label: `${o.work_order_id} — PN: ${o.part_number || "No PN"} — ${o.customer || "No customer"} — ${o.work_order_type || "No type"}${prioLabel(o)}`,
        }))}
        value={selectedId}
        onChange={(v) => selectOrder(v)}
        placeholder="Type WO number, part number or customer..."
        style={{ marginTop: "4px" }}
      />
      <select
        value={selectedId}
        onChange={(e) => selectOrder(e.target.value)}
        style={{ ...selectStyle, marginTop: "6px" }}
      >
        <option value="">-- Or browse the list --</option>
        {orders.map((o) => (
          <option key={o.work_order_id} value={o.work_order_id}>
            {o.work_order_id} — {"PN: "} {o.part_number || "No PN"} —{" "}
            {o.customer || "No customer"} — {o.work_order_type || "No type"}
            {prioLabel(o)}
          </option>
        ))}
      </select>

      {selectedId && selectedOrder && (
        <>
          {showMagneticTestOption && (
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginTop: "12px",
                padding: "10px 12px",
                backgroundColor: magneticTestRequired ? "#fef3c7" : "#f9fafb",
                border: magneticTestRequired
                  ? "1px solid #f59e0b"
                  : "1px solid #e5e7eb",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "14px",
              }}
            >
              <input
                type="checkbox"
                checked={magneticTestRequired}
                onChange={(e) => handleMagneticTestToggle(e.target.checked)}
                style={{ width: "16px", height: "16px" }}
              />
              Magnetic Test required for this work order
            </label>
          )}

          <label style={labelStyle}>
            Completed Step
            {completableSteps.length > 0 ? (
              <>
                <select
                  value={completedStep}
                  onChange={(e) => setCompletedStep(e.target.value)}
                  style={selectStyle}
                >
                  <option value="">-- Choose completed step --</option>
                  {completableSteps.map((step) => (
                    <option key={step} value={step}>
                      {step}
                    </option>
                  ))}
                </select>

                {completedStep && previewNextStep && (
                  <div style={{ ...helperStyle, fontWeight: "bold" }}>
                    → Next step after saving: {previewNextStep}
                  </div>
                )}

                {completedStep && !previewNextStep && (
                  <div style={{ ...helperStyle, fontWeight: "bold", color: "#059669" }}>
                    ✓ Final step — order will be ready to close
                  </div>
                )}
              </>
            ) : (
              <div
                style={{
                  marginTop: "6px",
                  padding: "10px",
                  backgroundColor: "#fff4e5",
                  borderRadius: "6px",
                  color: "#8a5a00",
                }}
              >
                ⚠ No completable steps available — work order type is not set.
              </div>
            )}
          </label>

          {/* Blocker / Corrective Action section */}
          <div
            style={{
              marginTop: "16px",
              padding: "14px 16px",
              backgroundColor: hasHoldReason ? "#fef2f2" : "#f9fafb",
              border: hasHoldReason ? "1px solid #fca5a5" : "1px solid #e5e7eb",
              borderRadius: "8px",
            }}
          >
            <div
              style={{
                fontSize: "14px",
                fontWeight: 700,
                color: hasHoldReason ? "#dc2626" : "#374151",
                marginBottom: "4px",
              }}
            >
              {hasHoldReason ? "⚠ Work order cannot continue" : "Problem or blocker?"}
            </div>
            <div style={{ fontSize: "12px", color: "#666", marginBottom: "10px" }}>
              Only fill this in if work on this order cannot continue — e.g. part
              damaged, tooling unavailable, waiting for customer approval. The order
              will be blocked until the action is resolved.
            </div>

            <label style={{ ...labelStyle, marginTop: 0 }}>
              Reason work cannot continue
              <input
                value={holdReason}
                onChange={(e) => updateHoldReason(e.target.value)}
                placeholder="E.g. Part damaged, tooling unavailable, waiting for approval..."
                style={inputStyle}
              />
            </label>

            {hasHoldReason && (
              <>
                <label style={labelStyle}>
                  What needs to happen to resolve this?
                  <input
                    value={requiredNextAction}
                    onChange={(e) => setRequiredNextAction(e.target.value)}
                    placeholder="E.g. Order new part, contact customer..."
                    style={inputStyle}
                  />
                </label>

                <label style={labelStyle}>
                  Action Status
                  <select
                    value={actionStatus}
                    onChange={(e) => handleActionStatusChange(e.target.value)}
                    style={selectStyle}
                  >
                    <option value="Open">Open — still waiting</option>
                    <option value="Done">Done — resolved, order can continue</option>
                  </select>
                </label>
              </>
            )}
          </div>

          <button onClick={() => void saveUpdate()} style={buttonStyle}>
            Save update
          </button>

          {saveStatus && (
            <div
              style={{
                marginTop: "12px",
                padding: "10px",
                backgroundColor: "#f5f5f5",
                borderRadius: "6px",
                fontSize: "14px",
              }}
            >
              {saveStatus}
            </div>
          )}
        </>
      )}
    </div>
  );
}
