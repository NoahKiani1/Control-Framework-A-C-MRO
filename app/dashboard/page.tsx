"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type WorkOrder = {
  work_order_id: string;
  customer: string | null;
  due_date: string | null;
  priority: string | null;
  assigned_person_team: string | null;
  current_process_step: string | null;
  hold_reason: string | null;
  rfq_state: string | null;
  required_next_action: string | null;
  action_owner: string | null;
  action_status: string | null;
  last_manual_update: string | null;
  last_system_update: string | null;
  work_order_type: string | null;
  is_open: boolean;
  is_active: boolean;
};

type Capacity = {
  capacity_pressure: string | null;
  cause_of_capacity_pressure: string | null;
  capacity_period: string | null;
  capacity_impact_note: string | null;
};

function sortOrders(orders: WorkOrder[]): WorkOrder[] {
  return [...orders].sort((a, b) => {
    const rank = (o: WorkOrder) => {
      if (o.hold_reason) return 5;
      if (o.priority === "AOG") return 1;
      if (o.priority === "Yes") return 2;
      if (o.due_date) return 3;
      return 4;
    };
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 3 && a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
    return 0;
  });
}

function latestUpdate(system: string | null, manual: string | null): string | null {
  if (!system && !manual) return null;
  if (!system) return manual;
  if (!manual) return system;
  return new Date(system) > new Date(manual) ? system : manual;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "–";
  const d = new Date(dateStr);
  return d.toLocaleDateString("nl-NL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function DashboardPage() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [capacity, setCapacity] = useState<Capacity | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data: wo } = await supabase
        .from("work_orders")
        .select("*")
        .eq("is_open", true)
        .eq("is_active", true);

      const { data: cap } = await supabase
        .from("capacity_status")
        .select("*")
        .eq("id", 1)
        .single();

      setOrders(sortOrders((wo as WorkOrder[]) || []));
      setCapacity(cap as Capacity);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <p style={{ padding: "2rem" }}>Laden...</p>;

  const readyToClose = orders.filter((o) => o.current_process_step === "EASA-Form 1");
  const activeOrders = orders.filter((o) => o.current_process_step !== "EASA-Form 1");

  const cellStyle: React.CSSProperties = {
    padding: "6px 10px",
    borderBottom: "1px solid #eee",
    fontSize: "13px",
    whiteSpace: "nowrap",
  };

  const headerStyle: React.CSSProperties = {
    ...cellStyle,
    fontWeight: "bold",
    backgroundColor: "#f5f5f5",
    position: "sticky",
    top: 0,
  };

  function rowColor(order: WorkOrder): string {
    if (order.priority === "AOG") return "#fff0f0";
    if (order.priority === "Yes") return "#fff8e0";
    if (order.hold_reason) return "#f0f0f0";
    return "white";
  }

  return (
    <main style={{ padding: "1.5rem", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Office Dashboard</h1>
        <a href="/">← Home</a>
      </div>

      {readyToClose.length > 0 && (
        <div style={{
          marginTop: "1rem",
          padding: "16px",
          backgroundColor: "#f0fdf4",
          border: "1px solid #86efac",
          borderRadius: "8px",
        }}>
          <h3 style={{ margin: "0 0 8px", color: "#166534" }}>
            ✅ Klaar om te sluiten in AcMP ({readyToClose.length})
          </h3>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={{ ...cellStyle, fontWeight: "bold", backgroundColor: "#dcfce7" }}>WO</th>
                <th style={{ ...cellStyle, fontWeight: "bold", backgroundColor: "#dcfce7" }}>Klant</th>
                <th style={{ ...cellStyle, fontWeight: "bold", backgroundColor: "#dcfce7" }}>Type</th>
              </tr>
            </thead>
            <tbody>
              {readyToClose.map((o) => (
                <tr key={o.work_order_id} style={{ backgroundColor: "#f0fdf4" }}>
                  <td style={{ ...cellStyle, fontWeight: "bold" }}>{o.work_order_id}</td>
                  <td style={cellStyle}>{o.customer || "–"}</td>
                  <td style={cellStyle}>{o.work_order_type || "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {capacity && capacity.capacity_pressure === "Yes" && (
        <div style={{
          marginTop: "1rem",
          padding: "12px 16px",
          backgroundColor: "#fff0f0",
          border: "1px solid #e88",
          borderRadius: "6px",
        }}>
          <strong>⚠ Capaciteitsdruk: {capacity.capacity_period}</strong>
          <br />
          Oorzaak: {capacity.cause_of_capacity_pressure || "–"}
          <br />
          {capacity.capacity_impact_note && <>Toelichting: {capacity.capacity_impact_note}</>}
        </div>
      )}

      <p style={{ marginTop: "1rem", color: "#666" }}>
        {activeOrders.length} actieve work orders
      </p>

      <div style={{ overflowX: "auto", marginTop: "0.5rem" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={headerStyle}>WO</th>
              <th style={headerStyle}>Klant</th>
              <th style={headerStyle}>Due Date</th>
              <th style={headerStyle}>Prio</th>
              <th style={headerStyle}>Toegewezen</th>
              <th style={headerStyle}>Processtap</th>
              <th style={headerStyle}>Blocked</th>
              <th style={headerStyle}>Hold Reason</th>
              <th style={headerStyle}>RFQ</th>
              <th style={headerStyle}>Actie nodig</th>
              <th style={headerStyle}>Actie-eigenaar</th>
              <th style={headerStyle}>Actie status</th>
              <th style={headerStyle}>Laatste update</th>
            </tr>
          </thead>
          <tbody>
            {activeOrders.map((o) => {
              const lastUpdate = latestUpdate(o.last_system_update, o.last_manual_update);
              return (
                <tr key={o.work_order_id} style={{ backgroundColor: rowColor(o) }}>
                  <td style={cellStyle}>{o.work_order_id}</td>
                  <td style={cellStyle}>{o.customer || "–"}</td>
                  <td style={cellStyle}>{formatDate(o.due_date)}</td>
                  <td style={cellStyle}>{o.priority || "No"}</td>
                  <td style={cellStyle}>{o.assigned_person_team || "–"}</td>
                  <td style={cellStyle}>{o.current_process_step || "–"}</td>
                  <td style={cellStyle}>{o.hold_reason ? "Ja" : "Nee"}</td>
                  <td style={cellStyle}>{o.hold_reason || "–"}</td>
                  <td style={cellStyle}>{o.rfq_state && o.rfq_state !== "undefined" ? o.rfq_state : "No RFQ"}</td>
                  <td style={cellStyle}>{o.required_next_action || "–"}</td>
                  <td style={cellStyle}>{o.action_owner || "–"}</td>
                  <td style={cellStyle}>{o.action_status || "Open"}</td>
                  <td style={cellStyle}>{formatDate(lastUpdate)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}