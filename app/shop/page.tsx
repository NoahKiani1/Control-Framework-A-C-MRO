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
  last_manual_update: string | null;
  last_system_update: string | null;
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

export default function ShopPage() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("work_orders")
        .select("work_order_id, customer, due_date, priority, assigned_person_team, current_process_step, hold_reason, rfq_state, required_next_action, last_manual_update, last_system_update")
        .eq("is_open", true)
        .eq("is_active", true);
      setOrders(sortOrders((data as WorkOrder[]) || []));
      setLoading(false);
    }
    load();

    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return <p style={{ padding: "2rem", fontSize: "24px" }}>Laden...</p>;

  const cellStyle: React.CSSProperties = {
    padding: "10px 14px",
    borderBottom: "2px solid #ddd",
    fontSize: "18px",
    whiteSpace: "nowrap",
  };

  const headerStyle: React.CSSProperties = {
    ...cellStyle,
    fontWeight: "bold",
    backgroundColor: "#f5f5f5",
    position: "sticky",
    top: 0,
    fontSize: "16px",
  };

  function rowColor(order: WorkOrder): string {
    if (order.priority === "AOG") return "#fff0f0";
    if (order.priority === "Yes") return "#fff8e0";
    if (order.hold_reason) return "#f0f0f0";
    return "white";
  }

  function prioLabel(order: WorkOrder): string {
    if (order.priority === "AOG") return "🔴 AOG";
    if (order.priority === "Yes") return "🟡 Prio";
    return "–";
  }

  return (
    <main style={{ padding: "1.5rem", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0, fontSize: "28px" }}>🛠 Shop Wall Screen</h1>
        <span style={{ fontSize: "14px", color: "#888" }}>Ververst automatisch elke 30s</span>
      </div>

      <p style={{ marginTop: "1rem", color: "#666", fontSize: "16px" }}>
        {orders.length} actieve work orders
      </p>

      <div style={{ overflowX: "auto", marginTop: "0.5rem" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={headerStyle}>WO</th>
              <th style={headerStyle}>Klant</th>
              <th style={headerStyle}>Prio</th>
              <th style={headerStyle}>Due Date</th>
              <th style={headerStyle}>Toegewezen</th>
              <th style={headerStyle}>Processtap</th>
              <th style={headerStyle}>Blocked</th>
              <th style={headerStyle}>Hold Reason</th>
              <th style={headerStyle}>RFQ</th>
              <th style={headerStyle}>Actie nodig</th>
              <th style={headerStyle}>Laatste update</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const lastUpdate = latestUpdate(o.last_system_update, o.last_manual_update);
              return (
                <tr key={o.work_order_id} style={{ backgroundColor: rowColor(o) }}>
                  <td style={{ ...cellStyle, fontWeight: "bold" }}>{o.work_order_id}</td>
                  <td style={cellStyle}>{o.customer || "–"}</td>
                  <td style={cellStyle}>{prioLabel(o)}</td>
                  <td style={cellStyle}>{formatDate(o.due_date)}</td>
                  <td style={cellStyle}>{o.assigned_person_team || "–"}</td>
                  <td style={cellStyle}>{o.current_process_step || "–"}</td>
                  <td style={{ ...cellStyle, fontWeight: o.hold_reason ? "bold" : "normal" }}>
                    {o.hold_reason ? "⛔ Ja" : "Nee"}
                  </td>
                  <td style={cellStyle}>{o.hold_reason || "–"}</td>
                  <td style={cellStyle}>{o.rfq_state && o.rfq_state !== "undefined" ? o.rfq_state : "No RFQ"}</td>
                  <td style={cellStyle}>{o.required_next_action || "–"}</td>
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