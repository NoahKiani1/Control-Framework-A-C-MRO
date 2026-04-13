"use client";

import { useEffect, useState } from "react";
import { formatDate, latestUpdate, rfqDisplay } from "@/lib/work-order-rules";
import { getWorkOrders } from "@/lib/work-orders";

type WorkOrder = {
  work_order_id: string;
  customer: string | null;
  rfq_state: string | null;
  work_order_type: string | null;
  last_system_update: string | null;
  last_manual_update: string | null;
};

export default function BacklogPage() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const data = await getWorkOrders<WorkOrder>({
        select:
          "work_order_id, customer, rfq_state, work_order_type, last_system_update, last_manual_update",
        isOpen: true,
        isActive: false,
        orderBy: { column: "last_system_update", ascending: false },
      });
      setOrders(data);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <p style={{ padding: "2rem" }}>Loading...</p>;

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

  return (
    <main style={{ padding: "1.5rem", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Backlog</h1>
        <a href="/">← Home</a>
      </div>

      <p style={{ marginTop: "1rem", color: "#666" }}>
        {orders.length} inactive open work orders
      </p>

      <div style={{ overflowX: "auto", marginTop: "0.5rem" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={headerStyle}>WO</th>
              <th style={headerStyle}>Customer</th>
              <th style={headerStyle}>Type</th>
              <th style={headerStyle}>RFQ</th>
              <th style={headerStyle}>Last Update</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const lastUpdate = latestUpdate(o.last_system_update, o.last_manual_update);

              return (
                <tr key={o.work_order_id}>
                  <td style={cellStyle}>{o.work_order_id}</td>
                  <td style={cellStyle}>{o.customer || "–"}</td>
                  <td style={cellStyle}>{o.work_order_type || "–"}</td>
                  <td style={{ ...cellStyle, color: rfqDisplay(o.rfq_state).color }}>
                    {rfqDisplay(o.rfq_state).label}
                  </td>
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
