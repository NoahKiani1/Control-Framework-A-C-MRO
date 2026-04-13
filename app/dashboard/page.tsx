"use client";

import { useEffect, useState } from "react";
import {
  blockReason,
  formatDate,
  isBlocked,
  isStale,
  latestUpdate,
  rfqDisplay,
  sortOrders,
} from "@/lib/work-order-rules";
import { getWorkOrders } from "@/lib/work-orders";

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

function hasAction(o: WorkOrder): boolean {
  return !!(o.hold_reason || o.required_next_action);
}

export default function DashboardPage() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const wo = await getWorkOrders<WorkOrder>({
        select: "*",
        isOpen: true,
        isActive: true,
      });

      setOrders(sortOrders(wo));
      setLoading(false);
    }

    load();
  }, []);

  if (loading) return <p style={{ padding: "2rem" }}>Loading...</p>;

  const readyToClose = orders.filter(
    (o) => o.current_process_step === "EASA-Form 1",
  );
  const activeOrders = orders.filter(
    (o) => o.current_process_step !== "EASA-Form 1",
  );

  const nonBlockedOrders = activeOrders.filter((o) => !isBlocked(o));
  const blockedOrders = activeOrders.filter((o) => isBlocked(o));

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

  function renderNonBlockedOrdersTable(list: WorkOrder[]) {
    return (
      <div style={{ overflowX: "auto", marginTop: "0.5rem" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={headerStyle}>WO</th>
              <th style={headerStyle}>Customer</th>
              <th style={headerStyle}>Due Date</th>
              <th style={headerStyle}>Prio</th>
              <th style={headerStyle}>Assigned</th>
              <th style={headerStyle}>Process Step</th>
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
                  <td style={cellStyle}>{o.work_order_id}</td>
                  <td style={cellStyle}>{o.customer || "–"}</td>
                  <td style={cellStyle}>{formatDate(o.due_date)}</td>
                  <td style={cellStyle}>{o.priority || "No"}</td>
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
              <th style={headerStyle}>Due Date</th>
              <th style={headerStyle}>Prio</th>
              <th style={headerStyle}>Assigned</th>
              <th style={headerStyle}>Process Step</th>
              <th style={headerStyle}>Hold Reason</th>
              <th style={headerStyle}>RFQ</th>
              <th style={headerStyle}>Action Required</th>
              <th style={headerStyle}>Action Owner</th>
              <th style={headerStyle}>Action Status</th>
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
                  <td style={cellStyle}>{o.work_order_id}</td>
                  <td style={cellStyle}>{o.customer || "–"}</td>
                  <td style={cellStyle}>{formatDate(o.due_date)}</td>
                  <td style={cellStyle}>{o.priority || "No"}</td>
                  <td style={cellStyle}>{o.assigned_person_team || "–"}</td>
                  <td style={cellStyle}>{o.current_process_step || "–"}</td>
                  <td style={cellStyle}>
                    {blockReason(o, {
                      rfqSentLabel: "RFQ sent — awaiting customer",
                    })}
                  </td>
                  <td style={{ ...cellStyle, color: rfqDisplay(o.rfq_state).color }}>
                    {rfqDisplay(o.rfq_state).label}
                  </td>
                  <td style={cellStyle}>{o.required_next_action || "–"}</td>
                  <td style={cellStyle}>{o.action_owner || "–"}</td>
                  <td style={cellStyle}>
                    {hasAction(o) ? o.action_status || "Open" : "–"}
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

  return (
    <main style={{ padding: "1.5rem", fontFamily: "sans-serif" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h1 style={{ margin: 0 }}>Office Dashboard</h1>
        <a href="/">← Home</a>
      </div>

      {readyToClose.length > 0 && (
        <div
          style={{
            marginTop: "1rem",
            padding: "16px",
            backgroundColor: "#f0fdf4",
            border: "1px solid #86efac",
            borderRadius: "8px",
          }}
        >
          <h3 style={{ margin: "0 0 8px", color: "#166534" }}>
            ✅ Ready to close in AcMP ({readyToClose.length})
          </h3>
          <table style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th
                  style={{
                    ...cellStyle,
                    fontWeight: "bold",
                    backgroundColor: "#dcfce7",
                  }}
                >
                  WO
                </th>
                <th
                  style={{
                    ...cellStyle,
                    fontWeight: "bold",
                    backgroundColor: "#dcfce7",
                  }}
                >
                  Customer
                </th>
                <th
                  style={{
                    ...cellStyle,
                    fontWeight: "bold",
                    backgroundColor: "#dcfce7",
                  }}
                >
                  Type
                </th>
              </tr>
            </thead>
            <tbody>
              {readyToClose.map((o) => (
                <tr
                  key={o.work_order_id}
                  style={{ backgroundColor: "#f0fdf4" }}
                >
                  <td style={{ ...cellStyle, fontWeight: "bold" }}>
                    {o.work_order_id}
                  </td>
                  <td style={cellStyle}>{o.customer || "–"}</td>
                  <td style={cellStyle}>{o.work_order_type || "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ marginTop: "1rem", color: "#666" }}>
        {activeOrders.length} active work orders
      </p>

      <section style={{ marginTop: "1rem" }}>
        <h2 style={{ marginBottom: "0.25rem" }}>
          Non-blocked work orders ({nonBlockedOrders.length})
        </h2>
        {renderNonBlockedOrdersTable(nonBlockedOrders)}
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2 style={{ marginBottom: "0.25rem" }}>
          Blocked work orders ({blockedOrders.length})
        </h2>
        {renderBlockedOrdersTable(blockedOrders)}
      </section>
    </main>
  );
}