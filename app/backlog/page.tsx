"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type WorkOrder = {
  work_order_id: string;
  customer: string | null;
  rfq_state: string | null;
  work_order_type: string | null;
  last_system_update: string | null;
};

export default function BacklogPage() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("work_orders")
        .select("work_order_id, customer, rfq_state, work_order_type, last_system_update")
        .eq("is_open", true)
        .eq("is_active", false)
        .order("last_system_update", { ascending: false });
      setOrders((data as WorkOrder[]) || []);
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
        <a href="/">? Home</a>
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
              <th style={headerStyle}>Last System Update</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.work_order_id}>
                <td style={cellStyle}>{o.work_order_id}</td>
                <td style={cellStyle}>{o.customer || "�"}</td>
                <td style={cellStyle}>{o.work_order_type || "�"}</td>
                <td style={cellStyle}>{o.rfq_state && o.rfq_state !== "undefined" ? o.rfq_state : "No RFQ"}</td>
                <td style={cellStyle}>{o.last_system_update ? new Date(o.last_system_update).toLocaleDateString("en-GB") : "�"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
