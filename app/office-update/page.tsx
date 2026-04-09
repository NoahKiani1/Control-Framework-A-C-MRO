"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

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
};

type Capacity = {
  capacity_pressure: string | null;
  cause_of_capacity_pressure: string | null;
  capacity_period: string | null;
  capacity_impact_note: string | null;
};

const CAPACITY_CAUSES = [
  "Engineer absent / injured",
  "Major customer priority",
  "AOG work order",
  "Too many due dates this week",
  "Waiting for specialist task",
  "Other",
];

export default function OfficeUpdatePage() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [activateId, setActivateId] = useState("");
  const [activateStatus, setActivateStatus] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState<Partial<WorkOrder>>({});
  const [capacity, setCapacity] = useState<Capacity>({
    capacity_pressure: "No",
    cause_of_capacity_pressure: null,
    capacity_period: null,
    capacity_impact_note: null,
  });
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState("");
  const [capSaveStatus, setCapSaveStatus] = useState("");

  useEffect(() => {
    async function load() {
      const { data: wo } = await supabase
        .from("work_orders")
        .select("work_order_id, customer, due_date, priority, assigned_person_team, hold_reason, required_next_action, action_owner, action_status, action_closed, is_active, work_order_type")
        .eq("is_open", true)
        .order("work_order_id", { ascending: false });

      const { data: cap } = await supabase
        .from("capacity_status")
        .select("*")
        .eq("id", 1)
        .single();

      setOrders((wo as WorkOrder[]) || []);
      if (cap) setCapacity(cap as Capacity);
      setLoading(false);
    }
    load();
  }, []);

  const inactiveOrders = orders.filter((o) => !o.is_active);
  const activeOrders = orders.filter((o) => o.is_active);

  async function activateOrder() {
    if (!activateId) return;
    setActivateStatus("Activeren...");

    const { error } = await supabase
      .from("work_orders")
      .update({ is_active: true, last_manual_update: new Date().toISOString() })
      .eq("work_order_id", activateId);

    if (error) {
      setActivateStatus(`Fout: ${error.message}`);
    } else {
      setActivateStatus("✅ Geactiveerd!");
      setOrders((prev) =>
        prev.map((o) =>
          o.work_order_id === activateId ? { ...o, is_active: true } : o
        )
      );
      setActivateId("");
    }
  }

  function selectOrder(id: string) {
    const order = orders.find((o) => o.work_order_id === id);
    if (!order) return;
    setSelectedId(id);
    setForm({
      due_date: order.due_date || "",
      priority: order.priority || "No",
      assigned_person_team: order.assigned_person_team || "",
      hold_reason: order.hold_reason || "",
      required_next_action: order.required_next_action || "",
      action_owner: order.action_owner || "",
      action_status: order.action_status || "Open",
      action_closed: order.action_closed || false,
      is_active: order.is_active,
    });
    setSaveStatus("");
  }

  function setActionStatus(status: string) {
    if (status === "Done") {
      setForm({
        ...form,
        action_status: "Done",
        action_closed: true,
        hold_reason: "",
        required_next_action: "",
      });
    } else {
      setForm({
        ...form,
        action_status: "Open",
        action_closed: false,
      });
    }
  }

  async function saveOrder() {
    if (!selectedId) return;
    setSaveStatus("Opslaan...");

    const { error } = await supabase
      .from("work_orders")
      .update({
        due_date: form.due_date || null,
        priority: form.priority,
        assigned_person_team: form.assigned_person_team || null,
        hold_reason: form.hold_reason || null,
        required_next_action: form.required_next_action || null,
        action_owner: form.action_owner || null,
        action_status: form.action_status,
        action_closed: form.action_closed,
        is_active: form.is_active,
        last_manual_update: new Date().toISOString(),
      })
      .eq("work_order_id", selectedId);

    if (error) {
      setSaveStatus(`Fout: ${error.message}`);
    } else {
      setSaveStatus("✅ Opgeslagen!");
      setOrders((prev) =>
        prev.map((o) =>
          o.work_order_id === selectedId ? { ...o, ...form } : o
        )
      );
    }
  }

  async function saveCapacity() {
    setCapSaveStatus("Opslaan...");

    const { error } = await supabase
      .from("capacity_status")
      .update({
        capacity_pressure: capacity.capacity_pressure,
        cause_of_capacity_pressure: capacity.capacity_pressure === "Yes" ? capacity.cause_of_capacity_pressure : null,
        capacity_period: capacity.capacity_pressure === "Yes" ? capacity.capacity_period : null,
        capacity_impact_note: capacity.capacity_pressure === "Yes" ? capacity.capacity_impact_note : null,
        last_updated: new Date().toISOString(),
      })
      .eq("id", 1);

    if (error) {
      setCapSaveStatus(`Fout: ${error.message}`);
    } else {
      setCapSaveStatus("✅ Opgeslagen!");
    }
  }

  if (loading) return <p style={{ padding: "2rem" }}>Laden...</p>;

  const labelStyle: React.CSSProperties = {
    display: "block",
    marginTop: "12px",
    fontWeight: "bold",
    fontSize: "13px",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px",
    border: "1px solid #ccc",
    borderRadius: "4px",
    fontSize: "14px",
    marginTop: "4px",
  };

  const selectStyle: React.CSSProperties = { ...inputStyle };

  const buttonStyle: React.CSSProperties = {
    padding: "10px 20px",
    backgroundColor: "#0070f3",
    color: "white",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    fontWeight: "bold",
    fontSize: "14px",
    marginTop: "16px",
  };

  const selectedOrder = orders.find((o) => o.work_order_id === selectedId);

  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif", maxWidth: "600px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Office Update</h1>
        <a href="/">← Home</a>
      </div>

      {/* Sectie 1: Activeren */}
      <section style={{ marginTop: "1.5rem", padding: "16px", backgroundColor: "#f0f8ff", border: "1px solid #aad", borderRadius: "6px" }}>
        <h2 style={{ margin: "0 0 8px" }}>Work Order activeren</h2>
        <p style={{ fontSize: "13px", color: "#666", margin: "0 0 8px" }}>
          Selecteer een niet-actieve work order om te activeren ({inactiveOrders.length} beschikbaar)
        </p>

        <select
          style={selectStyle}
          value={activateId}
          onChange={(e) => { setActivateId(e.target.value); setActivateStatus(""); }}
        >
          <option value="">-- Kies een niet-actieve work order --</option>
          {inactiveOrders.map((o) => (
            <option key={o.work_order_id} value={o.work_order_id}>
              {o.work_order_id} — {o.customer || "Geen klant"} — {o.work_order_type || "Onbekend type"}
            </option>
          ))}
        </select>

        {activateId && (
          <button
            style={{ ...buttonStyle, backgroundColor: "#16a34a", marginTop: "8px" }}
            onClick={activateOrder}
          >
            ✅ Activeer deze work order
          </button>
        )}

        {activateStatus && <p style={{ marginTop: "8px" }}><strong>{activateStatus}</strong></p>}
      </section>

      {/* Sectie 2: Actieve work order bewerken */}
      <section style={{ marginTop: "2rem" }}>
        <h2>Actieve Work Order bijwerken</h2>
        <p style={{ fontSize: "13px", color: "#666" }}>
          {activeOrders.length} actieve work orders
        </p>

        <label style={labelStyle}>Selecteer Work Order</label>
        <select
          style={selectStyle}
          value={selectedId}
          onChange={(e) => selectOrder(e.target.value)}
        >
          <option value="">-- Kies een actieve work order --</option>
          {activeOrders.map((o) => (
            <option key={o.work_order_id} value={o.work_order_id}>
              {o.work_order_id} — {o.customer || "Geen klant"} — {o.work_order_type || "Onbekend type"}
            </option>
          ))}
        </select>

        {selectedId && (
          <>
            {selectedOrder && (
              <p style={{ margin: "8px 0", color: "#666", fontSize: "13px" }}>
                Type: {selectedOrder.work_order_type || "Onbekend"} | Klant: {selectedOrder.customer || "–"}
              </p>
            )}

            <label style={labelStyle}>Actief</label>
            <select
              style={selectStyle}
              value={form.is_active ? "true" : "false"}
              onChange={(e) => setForm({ ...form, is_active: e.target.value === "true" })}
            >
              <option value="true">Ja — zichtbaar in Dashboard, Planning, Shop</option>
              <option value="false">Nee — terug naar Backlog</option>
            </select>

            <label style={labelStyle}>Due Date</label>
            <input
              type="date"
              style={inputStyle}
              value={form.due_date || ""}
              onChange={(e) => setForm({ ...form, due_date: e.target.value })}
            />

            <label style={labelStyle}>Priority</label>
            <select
              style={selectStyle}
              value={form.priority || "No"}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
            >
              <option value="No">No</option>
              <option value="Yes">Yes</option>
              <option value="AOG">AOG</option>
            </select>

            <label style={labelStyle}>Assigned Person/Team</label>
            <select
              style={selectStyle}
              value={form.assigned_person_team || ""}
              onChange={(e) => setForm({ ...form, assigned_person_team: e.target.value })}
            >
              <option value="">-- Kies --</option>
              <option value="Haddy">Haddy</option>
              <option value="Martijn">Martijn</option>
              <option value="Shop">Shop</option>
              <option value="Rens">Rens</option>
              <option value="Alissa">Alissa</option>
            </select>

            <label style={labelStyle}>Hold Reason (laat leeg als niet geblokkeerd)</label>
            <input
              type="text"
              style={inputStyle}
              value={form.hold_reason || ""}
              onChange={(e) => setForm({ ...form, hold_reason: e.target.value })}
              placeholder="Bv. Parts bestellen, RFQ Send, Wachten op klant..."
            />

            <label style={labelStyle}>Required Next Action</label>
            <input
              type="text"
              style={inputStyle}
              value={form.required_next_action || ""}
              onChange={(e) => setForm({ ...form, required_next_action: e.target.value })}
              placeholder="Wat moet er concreet gebeuren?"
            />

            <label style={labelStyle}>Action Owner</label>
            <input
              type="text"
              style={inputStyle}
              value={form.action_owner || ""}
              onChange={(e) => setForm({ ...form, action_owner: e.target.value })}
              placeholder="Wie is verantwoordelijk?"
            />

            <label style={labelStyle}>Action Status</label>
            <select
              style={selectStyle}
              value={form.action_status || "Open"}
              onChange={(e) => setActionStatus(e.target.value)}
            >
              <option value="Open">Open</option>
              <option value="Done">Done — maakt hold reason en actie automatisch leeg</option>
            </select>

            {form.hold_reason && (
              <p style={{ marginTop: "8px", padding: "8px 12px", backgroundColor: "#fff0f0", border: "1px solid #e88", borderRadius: "4px", fontSize: "13px" }}>
                ⚠ Deze work order is <strong>geblokkeerd</strong> vanwege: {form.hold_reason}
              </p>
            )}

            <button style={buttonStyle} onClick={saveOrder}>
              💾 Work Order opslaan
            </button>

            {saveStatus && <p style={{ marginTop: "8px" }}><strong>{saveStatus}</strong></p>}
          </>
        )}
      </section>

      {/* Sectie 3: Capaciteitsmanagement */}
      <section style={{ marginTop: "3rem", borderTop: "2px solid #eee", paddingTop: "1.5rem" }}>
        <h2>Capaciteitsmanagement</h2>

        <label style={labelStyle}>Capaciteitsdruk</label>
        <select
          style={selectStyle}
          value={capacity.capacity_pressure || "No"}
          onChange={(e) => setCapacity({ ...capacity, capacity_pressure: e.target.value })}
        >
          <option value="No">Nee</option>
          <option value="Yes">Ja</option>
        </select>

        {capacity.capacity_pressure === "Yes" && (
          <>
            <label style={labelStyle}>Oorzaak</label>
            <select
              style={selectStyle}
              value={capacity.cause_of_capacity_pressure || ""}
              onChange={(e) => setCapacity({ ...capacity, cause_of_capacity_pressure: e.target.value })}
            >
              <option value="">-- Kies oorzaak --</option>
              {CAPACITY_CAUSES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>

            <label style={labelStyle}>Periode</label>
            <select
              style={selectStyle}
              value={capacity.capacity_period || ""}
              onChange={(e) => setCapacity({ ...capacity, capacity_period: e.target.value })}
            >
              <option value="">-- Kies periode --</option>
              <option value="Today">Vandaag</option>
              <option value="This Week">Deze week</option>
            </select>

            <label style={labelStyle}>Toelichting</label>
            <input
              type="text"
              style={inputStyle}
              value={capacity.capacity_impact_note || ""}
              onChange={(e) => setCapacity({ ...capacity, capacity_impact_note: e.target.value })}
              placeholder="Korte toelichting..."
            />
          </>
        )}

        <button
          style={{ ...buttonStyle, backgroundColor: "#e67e22" }}
          onClick={saveCapacity}
        >
          💾 Capaciteit opslaan
        </button>

        {capSaveStatus && <p style={{ marginTop: "8px" }}><strong>{capSaveStatus}</strong></p>}
      </section>
    </main>
  );
}
