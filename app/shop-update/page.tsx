"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getCompletableStepsForType,
  getLastCompletedStep,
  getNextProcessStepAfterCompleted,
  hasOptionalSteps,
} from "@/lib/process-steps";
import { getWorkOrders, updateWorkOrder } from "@/lib/work-orders";

type WorkOrder = {
  work_order_id: string;
  customer: string | null;
  work_order_type: string | null;
  current_process_step: string | null;
  hold_reason: string | null;
  priority: string | null;
  assigned_person_team: string | null;
  magnetic_test_required: boolean | null;
};

export default function ShopUpdatePage() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [completedStep, setCompletedStep] = useState("");
  const [holdReason, setHoldReason] = useState("");
  const [magneticTestRequired, setMagneticTestRequired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState("");

  useEffect(() => {
    async function load() {
      const data = await getWorkOrders<WorkOrder>({
        select:
          "work_order_id, customer, work_order_type, current_process_step, hold_reason, priority, assigned_person_team, magnetic_test_required",
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
    setSaveStatus("");
  }

  function handleMagneticTestToggle(checked: boolean) {
    setMagneticTestRequired(checked);

    // Re-compute pre-selection with the new flag
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

  async function saveUpdate() {
    if (!selectedId) return;

    const selectedOrder = orders.find((o) => o.work_order_id === selectedId);
    if (!selectedOrder) return;

    if (!completedStep) {
      setSaveStatus("Please choose the completed step.");
      return;
    }

    // null means the completed step was the final step (EASA-Form 1);
    // keep current_process_step at that step so the order shows as "ready to close"
    const nextProcessStep =
      getNextProcessStepAfterCompleted(
        selectedOrder.work_order_type,
        completedStep,
        magneticTestRequired,
      ) ?? completedStep;

    setSaveStatus("Saving...");

    const { error } = await updateWorkOrder(selectedId, {
      current_process_step: nextProcessStep,
      hold_reason: holdReason || null,
      magnetic_test_required: magneticTestRequired,
      last_manual_update: new Date().toISOString(),
    });

    if (error) {
      setSaveStatus(`Error: ${error.message}`);
      return;
    }

    setSaveStatus("✅ Saved!");

    setOrders((prev) =>
      prev.map((o) =>
        o.work_order_id === selectedId
          ? {
              ...o,
              current_process_step: nextProcessStep,
              hold_reason: holdReason || null,
              magnetic_test_required: magneticTestRequired,
            }
          : o,
      ),
    );
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
        <Link href="/">← Home</Link>
      </p>

      <p>
        Update the completed shop step or report a blocker. ({orders.length} active orders)
      </p>

      <label style={labelStyle}>
        Select Work Order
        <select
          value={selectedId}
          onChange={(e) => selectOrder(e.target.value)}
          style={selectStyle}
        >
          <option value="">-- Choose a work order --</option>
          {orders.map((o) => (
            <option key={o.work_order_id} value={o.work_order_id}>
              {o.work_order_id} — {o.customer || "No customer"}
              {prioLabel(o)}
            </option>
          ))}
        </select>
      </label>

      {selectedId && selectedOrder && (
        <>
          <div
            style={{
              marginTop: "12px",
              padding: "12px",
              backgroundColor: "#f7f7f7",
              borderRadius: "8px",
              fontSize: "14px",
            }}
          >
            <strong>{selectedOrder.work_order_id}</strong> —{" "}
            {selectedOrder.customer || "–"}
            <br />
            Type: {selectedOrder.work_order_type || "Unknown"}
            {selectedOrder.assigned_person_team && (
              <> | Assigned: {selectedOrder.assigned_person_team}</>
            )}
            {selectedOrder.current_process_step && (
              <> | Current step: {selectedOrder.current_process_step}</>
            )}
          </div>

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

                <div style={helperStyle}>
                  Select the step that has just been completed. The work order
                  will automatically move to the next required step.
                </div>

                {completedStep && previewNextStep && (
                  <div style={{ ...helperStyle, fontWeight: "bold" }}>
                    → Current step after saving: {previewNextStep}
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

          <label style={labelStyle}>
            Hold Reason (leave empty if not blocked)
            <input
              value={holdReason}
              onChange={(e) => setHoldReason(e.target.value)}
              placeholder="E.g. Part damaged, tooling unavailable..."
              style={inputStyle}
            />
          </label>

          {holdReason && (
            <div style={{ ...helperStyle, color: "#b45309" }}>
              ⚠ This work order will be blocked
            </div>
          )}

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
