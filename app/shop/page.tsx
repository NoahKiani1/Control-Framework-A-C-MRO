"use client";

import { useEffect, useState } from "react";
import {
  blockReason,
  formatDate,
  isBlocked,
  latestUpdate,
  isStale,
  rfqDisplay,
  sortOrders,
} from "@/lib/work-order-rules";
import { getWorkOrders } from "@/lib/work-orders";

type WorkOrder = {
  work_order_id: string;
  customer: string | null;
  part_number: string | null;
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

export default function ShopPage() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const data = await getWorkOrders<WorkOrder>({
        select:
          "work_order_id, customer, part_number, due_date, priority, assigned_person_team, current_process_step, hold_reason, rfq_state, required_next_action, last_manual_update, last_system_update",
        isOpen: true,
        isActive: true,
      });

      const filtered = data.filter(
        (o) => o.current_process_step !== "EASA-Form 1",
      );

      setOrders(sortOrders(filtered));
      setLoading(false);
    }

    load();

    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return <p style={{ padding: "2rem", fontSize: "24px" }}>Loading...</p>;

  const nonBlockedOrders = orders.filter((o) => !isBlocked(o));
  const blockedOrders = orders.filter((o) => isBlocked(o));

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
    if (isBlocked(order)) return "#f0f0f0";
    return "white";
  }

  function prioLabel(order: WorkOrder): string {
    if (order.priority === "AOG") return "🔴 AOG";
    if (order.priority === "Yes") return "🟡 Prio";
    return "–";
  }

  function renderNonBlockedOrdersTable(list: WorkOrder[]) {
    return (
      <div style={{ overflowX: "auto", marginTop: "0.5rem" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={headerStyle}>WO</th>
              <th style={headerStyle}>Customer</th>
              <th style={headerStyle}>Part Number</th>
              <th style={headerStyle}>Prio</th>
              <th style={headerStyle}>Due Date</th>
              <th style={headerStyle}>Assigned</th>
              <th style={headerStyle}>Current Step</th>
              <th style={headerStyle}>RFQ</th>
              <th style={headerStyle}>Last Update</th>
            </tr>
          </thead>
          <tbody>
            {list.map((o) => {
              const lastUpdate = latestUpdate(
                o.last_system_update,
                o.last_manual_update,
              );

              return (
                <tr
                  key={o.work_order_id}
                  style={{ backgroundColor: rowColor(o) }}
                >
                  <td style={{ ...cellStyle, fontWeight: "bold" }}>
                    {o.work_order_id}
                  </td>
                  <td style={cellStyle}>{o.customer || "–"}</td>
                  <td style={cellStyle}>{o.part_number || "–"}</td>
                  <td style={cellStyle}>{prioLabel(o)}</td>
                  <td style={cellStyle}>{formatDate(o.due_date)}</td>
                  <td style={cellStyle}>{o.assigned_person_team || "–"}</td>
                  <td style={cellStyle}>{o.current_process_step || "–"}</td>
                  <td style={{ ...cellStyle, color: rfqDisplay(o.rfq_state).color }}>
                    {rfqDisplay(o.rfq_state).label}
                  </td>
                  <td style={cellStyle}>
                    {formatDate(lastUpdate)}
                    {isStale(lastUpdate) && (
                      <span className="stale-warning">⚠<span className="stale-tooltip">Not updated in over 2 weeks</span></span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  function renderBlockedOrdersTable(list: WorkOrder[]) {
    return (
      <div style={{ overflowX: "auto", marginTop: "0.5rem" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={headerStyle}>WO</th>
              <th style={headerStyle}>Customer</th>
              <th style={headerStyle}>Part Number</th>
              <th style={headerStyle}>Prio</th>
              <th style={headerStyle}>Due Date</th>
              <th style={headerStyle}>Assigned</th>
              <th style={headerStyle}>Current Step</th>
              <th style={headerStyle}>Hold Reason</th>
              <th style={headerStyle}>RFQ</th>
              <th style={headerStyle}>Action Required</th>
              <th style={headerStyle}>Last Update</th>
            </tr>
          </thead>
          <tbody>
            {list.map((o) => {
              const lastUpdate = latestUpdate(
                o.last_system_update,
                o.last_manual_update,
              );

              return (
                <tr
                  key={o.work_order_id}
                  style={{ backgroundColor: rowColor(o) }}
                >
                  <td style={{ ...cellStyle, fontWeight: "bold" }}>
                    {o.work_order_id}
                  </td>
                  <td style={cellStyle}>{o.customer || "–"}</td>
                  <td style={cellStyle}>{o.part_number || "–"}</td>
                  <td style={cellStyle}>{prioLabel(o)}</td>
                  <td style={cellStyle}>{formatDate(o.due_date)}</td>
                  <td style={cellStyle}>{o.assigned_person_team || "–"}</td>
                  <td style={cellStyle}>{o.current_process_step || "–"}</td>
                  <td style={cellStyle}>{blockReason(o)}</td>
                  <td style={{ ...cellStyle, color: rfqDisplay(o.rfq_state).color }}>
                    {rfqDisplay(o.rfq_state).label}
                  </td>
                  <td style={cellStyle}>{o.required_next_action || "–"}</td>
                  <td style={cellStyle}>
                    {formatDate(lastUpdate)}
                    {isStale(lastUpdate) && (
                      <span className="stale-warning">⚠<span className="stale-tooltip">Not updated in over 2 weeks</span></span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <main style={{ padding: "1.5rem", fontFamily: "sans-serif" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "28px" }}>🛠 Shop Wall Screen</h1>
        <span style={{ fontSize: "14px", color: "#888" }}>
          Ververst automatisch elke 30s
        </span>
      </div>

      <p style={{ marginTop: "1rem", color: "#666", fontSize: "16px" }}>
        {orders.length} active work orders
      </p>

      <section style={{ marginTop: "1rem" }}>
        <h2 style={{ marginBottom: "0.25rem", fontSize: "22px" }}>
          Non-blocked work orders ({nonBlockedOrders.length})
        </h2>
        {renderNonBlockedOrdersTable(nonBlockedOrders)}
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2 style={{ marginBottom: "0.25rem", fontSize: "22px" }}>
          Blocked work orders ({blockedOrders.length})
        </h2>
        {renderBlockedOrdersTable(blockedOrders)}
      </section>
    </main>
  );
}