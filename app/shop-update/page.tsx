"use client";

import { useEffect, useState } from "react";
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

const PROCESS_STEPS: Record<string, string[]> = {
  "Wheel Repair": ["Intake", "Disassembly", "Cleaning", "Inspection", "Eddy Current", "Repair", "Assembly", "EASA-Form 1"],
  "Wheel Overhaul": ["Intake", "Disassembly", "Cleaning", "Paint Blasting", "Inspection", "Penetrant NDT Inspection", "Eddy Current", "Repair", "Painting", "Assembly", "EASA-Form 1"],
  "Brake Repair": ["Intake", "Disassembly", "Cleaning", "Inspection", "Eddy Current", "Repair", "Assembly", "EASA-Form 1"],
  "Brake Overhaul": ["Intake", "Disassembly", "Cleaning", "Paint Blasting", "Inspection", "Penetrant NDT Inspection", "Eddy Current", "Repair", "Painting", "Assembly", "EASA-Form 1"],
  "Battery": ["Disassembly", "Cleaning", "Inspection", "Repair", "Assembly", "EASA-Form 1"],
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
        .select("work_order_id, customer, work_order_type, current_process_step, hold_reason, priority, assigned_person_team")
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
    setProcessStep(order.current_process_step || "");
    setHoldReason(order.hold_reason || "");
    setSaveStatus("");
  }

  async function saveUpdate() {
    if (!selectedId) return;
    setSaveStatus("Opslaan...");

    const { error } = await supabase
      .from("work_orders")
      .update({
        current_process_step: processStep || null,
        hold_reason: holdReason || null,
        last_manual_update: new Date().toISOString(),
      })
      .eq("work_order_id", selectedId);

    if (error) {
      setSaveStatus(`Fout: ${error.message}`);
    } else {
      setSaveStatus("✅ Opgeslagen!");
      setOrders((prev) =>
        prev.map((o) =>
          o.work_order_id === selectedId
            ? { ...o, current_process_step: processStep || null, hold_reason: holdReason || null }
            : o
        )
      );
    }
  }

  if (loading) return <p style={{ padding: "2rem" }}>Laden...</p>;

  const selectedOrder = orders.find((o) => o.work_order_id === selectedId);
  const steps = selectedOrder?.work_order_type
    ? PROCESS_STEPS[selectedOrder.work_order_type] || []
    : [];

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
        Update de processtap of meld een blokkade. ({orders.length} actieve orders)
      </p>

      <label style={labelStyle}>Selecteer Work Order</label>
      <select
        style={selectStyle}
        value={selectedId}
        onChange={(e) => selectOrder(e.target.value)}
      >
        <option value="">-- Kies een work order --</option>
        {orders.map((o) => (
          <option key={o.work_order_id} value={o.work_order_id}>
            {o.work_order_id} — {o.customer || "Geen klant"}{prioLabel(o)}
          </option>
        ))}
      </select>

      {selectedId && selectedOrder && (
        <>
          <div style={{
            marginTop: "12px",
            padding: "10px 14px",
            backgroundColor: "#f5f5f5",
            borderRadius: "6px",
            fontSize: "14px",
          }}>
            <strong>{selectedOrder.work_order_id}</strong> — {selectedOrder.customer || "–"}
            <br />
            Type: {selectedOrder.work_order_type || "Onbekend"}
            {selectedOrder.assigned_person_team && <> | Toegewezen: {selectedOrder.assigned_person_team}</>}
            {selectedOrder.current_process_step && <> | Huidige stap: <strong>{selectedOrder.current_process_step}</strong></>}
          </div>

          <label style={labelStyle}>Processtap</label>
          {steps.length > 0 ? (
            <select
              style={selectStyle}
              value={processStep}
              onChange={(e) => setProcessStep(e.target.value)}
            >
              <option value="">-- Kies stap --</option>
              {steps.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          ) : (
            <p style={{ color: "#e67e22", fontSize: "14px", marginTop: "4px" }}>
              ⚠ Geen processtappen beschikbaar — work order type is niet ingesteld.
            </p>
          )}

          <label style={labelStyle}>Hold Reason (laat leeg als niet geblokkeerd)</label>
          <input
            type="text"
            style={inputStyle}
            value={holdReason}
            onChange={(e) => setHoldReason(e.target.value)}
            placeholder="Bv. Onderdeel beschadigd, tooling niet beschikbaar..."
          />

          {holdReason && (
            <p style={{ marginTop: "8px", padding: "8px 12px", backgroundColor: "#fff0f0", border: "1px solid #e88", borderRadius: "4px", fontSize: "13px" }}>
              ⚠ Deze work order wordt <strong>geblokkeerd</strong>
            </p>
          )}

          <button style={buttonStyle} onClick={saveUpdate}>
            💾 Update opslaan
          </button>

          {saveStatus && <p style={{ marginTop: "8px", textAlign: "center" }}><strong>{saveStatus}</strong></p>}
        </>
      )}
    </main>
  );
}
