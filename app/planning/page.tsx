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
  last_manual_update: string | null;
  last_system_update: string | null;
};

function isBlocked(o: WorkOrder): boolean {
  if (o.hold_reason) return true;
  if (o.rfq_state === "RFQ Send" || o.rfq_state === "RFQ Rejected") return true;
  return false;
}

function sortOrders(orders: WorkOrder[]): WorkOrder[] {
  return [...orders].sort((a, b) => {
    const rank = (o: WorkOrder) => {
      if (isBlocked(o)) return 5;
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

function blockReason(o: WorkOrder): string {
  if (o.hold_reason) return o.hold_reason;
  if (o.rfq_state === "RFQ Send") return "RFQ verstuurd";
  if (o.rfq_state === "RFQ Rejected") return "RFQ afgewezen";
  return "–";
}

export default function PlanningPage() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("work_orders")
        .select("work_order_id, customer, due_date, priority, assigned_person_team, current_process_step, hold_reason, rfq_state, last_manual_update, last_system_update")
        .eq("is_open", true)
        .eq("is_active", true);
      const filtered = ((data as WorkOrder[]) || []).filter((o) => o.current_process_step !== "EASA-Form 1");
      setOrders(sortOrders(filtered));
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <p style={{ padding: "2rem" }}>Laden...</p>;

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
    if (isBlocked(order)) return "#f0f0f0";
    return "white";
  }

  return (
    <main style={{ padding: "1.5rem", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Shared Planning</h1>
        <a href="/">← Home</a>
      </div>

      <p style={{ marginTop: "1rem", color: "#666" }}>
        {orders.length} actieve work orders
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
              <th style={headerStyle}>Laatste update</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const lastUpdate = latestUpdate(o.last_system_update, o.last_manual_update);
              return (
                <tr key={o.work_order_id} style={{ backgroundColor: rowColor(o) }}>
                  <td style={cellStyle}>{o.work_order_id}</td>
                  <td style={cellStyle}>{o.customer || "–"}</td>
                  <td style={cellStyle}>{formatDate(o.due_date)}</td>
                  <td style={cellStyle}>{o.priority || "No"}</td>
                  <td style={cellStyle}>{o.assigned_person_team || "–"}</td>
                  <td style={cellStyle}>{o.current_process_step || "–"}</td>
                  <td style={cellStyle}>{isBlocked(o) ? "Ja" : "Nee"}</td>
                  <td style={cellStyle}>{blockReason(o)}</td>
                  <td style={cellStyle}>{o.rfq_state && o.rfq_state !== "undefined" ? o.rfq_state : "No RFQ"}</td>
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