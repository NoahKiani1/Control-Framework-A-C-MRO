"use client";

import { useEffect, useState } from "react";
import { formatDate, isStale, latestUpdate } from "@/lib/work-order-rules";
import { getWorkOrders, updateWorkOrder } from "@/lib/work-orders";

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

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const data = await getWorkOrders<WorkOrder>({
        select:
          "work_order_id, customer, part_number, hold_reason, required_next_action, action_owner, action_status, action_closed, last_manual_update, last_system_update",
        isOpen: true,
        isActive: true,
      });
      setOrders(data);
      setLoading(false);
    }
    load();
  }, []);

  async function closeAction(order: WorkOrder) {
    const confirmed = window.confirm(
      `Close action for ${order.work_order_id}?\n\n` +
        `This will clear the hold reason and unblock the work order.\n` +
        `This action cannot be undone.`,
    );

    if (!confirmed) return;

    const payload: Record<string, unknown> = {
      action_status: "Done",
      action_closed: true,
      hold_reason: null,
      required_next_action: null,
      action_owner: null,
      last_manual_update: new Date().toISOString(),
    };

    const { error } = await updateWorkOrder(order.work_order_id, payload);
    if (error) return;

    setOrders((prev) =>
      prev.map((o) =>
        o.work_order_id === order.work_order_id
          ? {
              ...o,
              action_status: "Done",
              action_closed: true,
              hold_reason: null,
              required_next_action: null,
              action_owner: null,
            }
          : o,
      ),
    );
  }

  if (loading) return <p style={{ padding: "2rem" }}>Loading...</p>;

  const filtered = orders.filter((o) => o.hold_reason || o.required_next_action);

  const cellStyle: React.CSSProperties = {
    padding: "6px 10px",
    borderBottom: "1px solid #eee",
    fontSize: "13px",
    overflowWrap: "anywhere",
    verticalAlign: "top",
    textAlign: "left",
  };

  const headerStyle: React.CSSProperties = {
    ...cellStyle,
    fontWeight: "bold",
    backgroundColor: "#f5f5f5",
    position: "sticky",
    top: 0,
  };

  function rowColor(order: WorkOrder): string {
    if (order.hold_reason) return "#fff0f0";
    if (order.action_status === "Done") return "#f0fff0";
    return "white";
  }

  return (
    <main style={{ padding: "1.5rem", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Actions / Blockers</h1>
      </div>

      <p style={{ marginTop: "0.5rem", color: "#666" }}>
        {filtered.length} results
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
              <th style={headerStyle}>Status</th>
              <th style={headerStyle}>Last Update</th>
              <th style={headerStyle}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => {
              const lastUpdate = latestUpdate(o.last_system_update, o.last_manual_update);
              const isDone = o.action_status === "Done";
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
                  <td style={cellStyle}>
                    <span
                      style={{
                        padding: "3px 8px",
                        fontSize: "12px",
                        fontWeight: 600,
                        borderRadius: "4px",
                        backgroundColor: isDone ? "#dcfce7" : "#fef3c7",
                        color: isDone ? "#16a34a" : "#92400e",
                        display: "inline-block",
                      }}
                    >
                      {isDone ? "Closed" : "Open"}
                    </span>
                  </td>
                  <td style={cellStyle}>
                    {formatDate(lastUpdate)}
                    {isStale(lastUpdate) && (
                      <span className="stale-warning">⚠<span className="stale-tooltip">Not updated in over 2 weeks</span></span>
                    )}
                  </td>
                  <td style={cellStyle}>
                    {!isDone && (
                      <button
                        onClick={() => void closeAction(o)}
                        style={{
                          padding: "4px 10px",
                          fontSize: "12px",
                          fontWeight: 600,
                          border: "1px solid #dc2626",
                          borderRadius: "4px",
                          cursor: "pointer",
                          backgroundColor: "white",
                          color: "#dc2626",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Close action
                      </button>
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
