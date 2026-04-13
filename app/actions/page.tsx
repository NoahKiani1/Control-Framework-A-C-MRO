"use client";

import { useEffect, useState } from "react";
import { formatDate, isStale, latestUpdate } from "@/lib/work-order-rules";
import { supabase } from "@/lib/supabase";

type WorkOrder = {
  work_order_id: string;
  customer: string | null;
  part_number: string | null;
  hold_reason: string | null;
  required_next_action: string | null;
  action_owner: string | null;
  action_status: string | null;
  action_closed: boolean | null;
  last_manual_update: string | null;
  last_system_update: string | null;
};

export default function ActionsPage() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [filter, setFilter] = useState<"all" | "open" | "blocked">("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("work_orders")
        .select("work_order_id, customer, part_number, hold_reason, required_next_action, action_owner, action_status, action_closed, last_manual_update, last_system_update")
        .eq("is_open", true)
        .eq("is_active", true);
      setOrders((data as WorkOrder[]) || []);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <p style={{ padding: "2rem" }}>Loading...</p>;

  const filtered = orders.filter((o) => {
    const hasAction = o.hold_reason || o.required_next_action;
    if (!hasAction) return false;
    if (filter === "open") return o.action_status !== "Done";
    if (filter === "blocked") return !!o.hold_reason;
    return true;
  });

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

  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: "6px 14px",
    border: "1px solid #ccc",
    borderRadius: "4px",
    backgroundColor: active ? "#0070f3" : "white",
    color: active ? "white" : "#333",
    cursor: "pointer",
    fontWeight: active ? "bold" : "normal",
  });

  function rowColor(order: WorkOrder): string {
    if (order.hold_reason) return "#fff0f0";
    if (order.action_status === "Done") return "#f0fff0";
    return "white";
  }

  return (
    <main style={{ padding: "1.5rem", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Actions / Blockers</h1>
        <a href="/">← Home</a>
      </div>

      <div style={{ marginTop: "1rem", display: "flex", gap: "8px" }}>
        <button style={btnStyle(filter === "all")} onClick={() => setFilter("all")}>
          Alles ({orders.filter((o) => o.hold_reason || o.required_next_action).length})
        </button>
        <button style={btnStyle(filter === "open")} onClick={() => setFilter("open")}>
          Open acties ({orders.filter((o) => (o.hold_reason || o.required_next_action) && o.action_status !== "Done").length})
        </button>
      </div>

      <p style={{ marginTop: "0.5rem", color: "#666" }}>
        {filtered.length} resultaten
      </p>

      <div style={{ overflowX: "auto", marginTop: "0.5rem" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={headerStyle}>WO</th>
              <th style={headerStyle}>Customer</th>
              <th style={headerStyle}>Part Number</th>
              <th style={headerStyle}>Hold Reason</th>
              <th style={headerStyle}>Action Required</th>
              <th style={headerStyle}>Action Owner</th>
              <th style={headerStyle}>Action Status</th>
              <th style={headerStyle}>Action Closed</th>
              <th style={headerStyle}>Last Update</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => {
              const lastUpdate = latestUpdate(o.last_system_update, o.last_manual_update);
              return (
                <tr key={o.work_order_id} style={{ backgroundColor: rowColor(o) }}>
                  <td style={cellStyle}>{o.work_order_id}</td>
                  <td style={cellStyle}>{o.customer || "–"}</td>
                  <td style={cellStyle}>{o.part_number || "–"}</td>
                  <td style={{ ...cellStyle, fontWeight: o.hold_reason ? "bold" : "normal" }}>
                    {o.hold_reason || "–"}
                  </td>
                  <td style={cellStyle}>{o.required_next_action || "–"}</td>
                  <td style={cellStyle}>{o.action_owner || "–"}</td>
                  <td style={cellStyle}>{o.action_status || "Open"}</td>
                  <td style={cellStyle}>{o.action_closed ? "Yes" : "No"}</td>
                  <td style={cellStyle}>
                    {formatDate(lastUpdate)}
                    {isStale(lastUpdate) && (
                      <span className="stale-warning">⚠<span className="stale-tooltip">Not updated in over 2 weeks</span></span>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} style={{ ...cellStyle, textAlign: "center", color: "#999" }}>
                  No actions or blockers found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
