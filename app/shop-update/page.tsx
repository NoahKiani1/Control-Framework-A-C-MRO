"use client";

import { useEffect, useState } from "react";
import { getProcessStepsForType } from "@/lib/process-steps";
import { supabase } from "@/lib/supabase";

type WorkOrder = {
  work_order_id: string;
  customer: string | null;
  work_order_type: string | null;
  current_process_step: string | null;
  hold_reason: string | null;
  priority: string | null;
  assigned_person_team: string | null;
};

export default function ShopUpdatePage() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [processStep, setProcessStep] = useState("");
  const [holdReason, setHoldReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState("");

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("work_orders")
        .select(
          "work_order_id, customer, work_order_type, current_process_step, hold_reason, priority, assigned_person_team",
        )
        .eq("is_open", true)
        .eq("is_active", true)
        .order("work_order_id", { ascending: false });

      setOrders((data as WorkOrder[]) || []);
      setLoading(false);
    }

    load();
  }, []);

  function selectOrder(id: string) {
    const order = orders.find((o) => o.work_order_id === id);
    if (!order) return;

    setSelectedId(id);
    setProcessStep(order.current_process_step === "Intake" ? "" : order.current_process_step || "");
    setHoldReason(order.hold_reason || "");
    setSaveStatus("");
  }

  async function saveUpdate() {
    if (!selectedId) return;

    const selectedOrder = orders.find((o) => o.work_order_id === selectedId);
    const nextProcessStep = processStep || selectedOrder?.current_process_step || null;

    setSaveStatus("Saving...");

    const { error } = await supabase
      .from("work_orders")
      .update({
        current_process_step: nextProcessStep,
        hold_reason: holdReason || null,
        last_manual_update: new Date().toISOString(),
      })
      .eq("work_order_id", selectedId);

    if (error) {
      setSaveStatus(`Error: ${error.message}`);
    } else {
      setSaveStatus("✅ Saved!");
      setOrders((prev) =>
        prev.map((o) =>
          o.work_order_id === selectedId
            ? {
                ...o,
                current_process_step: nextProcessStep,
                hold_reason: holdReason || null,
              }
            : o,
        ),
      );
    }
  }

  if (loading) return <p style={{ padding: "2rem" }}>Loading...</p>;

  const selectedOrder = orders.find((o) => o.work_order_id === selectedId);
  const allSteps = getProcessStepsForType(selectedOrder?.work_order_type || null);
  const selectableSteps = allSteps.filter((s) => s !== "Intake");

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

  const inputStyle: React.CSSProperties = { ...selectStyle };

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
    if (order.priority === "AOG") return " 🔴 AOG";
    if (order.priority === "Yes") return " 🟡 Prio";
    return "";
  }

  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif", maxWidth: "500px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>🛠 Shop Update</h1>
        <a href="/">← Home</a>
      </div>

      <p style={{ color: "#666", marginTop: "8px" }}>
        Update the process step or report a blocker. ({orders.length} active orders)
      </p>

      <label style={labelStyle}>Select Work Order</label>
      <select
        style={selectStyle}
        value={selectedId}
        onChange={(e) => selectOrder(e.target.value)}
      >
        <option value="">-- Choose a work order --</option>
        {orders.map((o) => (
          <option key={o.work_order_id} value={o.work_order_id}>
            {o.work_order_id} — {o.customer || "No customer"}{prioLabel(o)}
          </option>
        ))}
      </select>

      {selectedId && selectedOrder && (
        <>
          <div
            style={{
              marginTop: "12px",
              padding: "10px 14px",
              backgroundColor: "#f5f5f5",
              borderRadius: "6px",
              fontSize: "14px",
            }}
          >
            <strong>{selectedOrder.work_order_id}</strong> — {selectedOrder.customer || "–"}
            <br />
            Type: {selectedOrder.work_order_type || "Unknown"}
            {selectedOrder.assigned_person_team && <> | Assigned: {selectedOrder.assigned_person_team}</>}
            {selectedOrder.current_process_step && (
              <>
                {" "}
                | Current step: <strong>{selectedOrder.current_process_step}</strong>
              </>
            )}
          </div>

          <label style={labelStyle}>Process Step</label>
          {selectableSteps.length > 0 ? (
            <>
              <select
                style={selectStyle}
                value={processStep}
                onChange={(e) => setProcessStep(e.target.value)}
              >
                <option value="">-- Choose next step --</option>
                {selectableSteps.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>

              <div style={helperStyle}>
                <strong>Intake</strong> is automatically set when a new work order becomes active.
              </div>
            </>
          ) : (
            <p style={{ color: "#e67e22", fontSize: "14px", marginTop: "4px" }}>
              ⚠ No process steps available — work order type is not set.
            </p>
          )}

          <label style={labelStyle}>Hold Reason (leave empty if not blocked)</label>
          <input
            type="text"
            style={inputStyle}
            value={holdReason}
            onChange={(e) => setHoldReason(e.target.value)}
            placeholder="E.g. Part damaged, tooling unavailable..."
          />

          {holdReason && (
            <p
              style={{
                marginTop: "8px",
                padding: "8px 12px",
                backgroundColor: "#fff0f0",
                border: "1px solid #e88",
                borderRadius: "4px",
                fontSize: "13px",
              }}
            >
              ⚠ This work order will be <strong>blocked</strong>
            </p>
          )}

          <button style={buttonStyle} onClick={saveUpdate}>
            💾 Save update
          </button>

          {saveStatus && (
            <p style={{ marginTop: "8px", textAlign: "center" }}>
              <strong>{saveStatus}</strong>
            </p>
          )}
        </>
      )}
    </main>
  );
}