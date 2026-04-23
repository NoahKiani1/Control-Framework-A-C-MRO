"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RequireRole } from "@/app/components/require-role";
import { PageHeader } from "@/app/components/page-header";
import { formatDate, latestUpdate, rfqDisplay } from "@/lib/work-order-rules";
import { getWorkOrders } from "@/lib/work-orders";

type WorkOrder = {
  work_order_id: string;
  customer: string | null;
  part_number: string | null;
  rfq_state: string | null;
  work_order_type: string | null;
  last_system_update: string | null;
  last_manual_update: string | null;
};

const ui = {
  pageBg: "#f2efe9",
  surface: "#ffffff",
  surfaceMuted: "#faf8f3",
  border: "#e2ddd1",
  borderStrong: "#ccc4b4",
  text: "#1f2937",
  muted: "#5f6b7c",
  blue: "#2555c7",
  blueSoft: "#eef3ff",
  blueBorder: "#d7e3ff",
  shadow: "0 1px 2px rgba(31, 41, 55, 0.04), 0 4px 12px rgba(31, 41, 55, 0.04)",
};

const FONT_STACK = 'var(--font-inter), var(--font-geist-sans), sans-serif';

function BacklogPageContent() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const data = await getWorkOrders<WorkOrder>({
        select:
          "work_order_id, customer, part_number, rfq_state, work_order_type, last_system_update, last_manual_update",
        isOpen: true,
        isActive: false,
        orderBy: [
          { column: "last_system_update", ascending: false },
          { column: "work_order_id", ascending: false },
        ],
      });

      setOrders(data);
      setLoading(false);
    }

    void load();
  }, []);

  const pageStyle: React.CSSProperties = {
    minHeight: "100vh",
    backgroundColor: ui.pageBg,
    padding: "32px 40px 40px",
    fontFamily: FONT_STACK,
    color: ui.text,
  };

  if (loading) {
    return (
      <main style={pageStyle}>
        <div style={{ color: ui.muted, fontSize: "14px" }}>Loading...</div>
      </main>
    );
  }

  const shellStyle: React.CSSProperties = {
    maxWidth: "1440px",
  };

  const sectionCardStyle: React.CSSProperties = {
    backgroundColor: ui.surface,
    border: `1px solid ${ui.border}`,
    borderRadius: "14px",
    boxShadow: ui.shadow,
    padding: "16px 18px",
  };

  const sectionHeaderStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "14px",
    marginBottom: "12px",
    flexWrap: "wrap",
  };

  const sectionTitleStyle: React.CSSProperties = {
    margin: 0,
    fontSize: "16px",
    fontWeight: 650,
    color: ui.text,
    letterSpacing: "-0.015em",
  };

  const sectionDescriptionStyle: React.CSSProperties = {
    margin: "3px 0 0",
    fontSize: "13px",
    color: ui.muted,
    lineHeight: 1.5,
  };

  const countBadgeStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    padding: "3px 9px",
    borderRadius: "999px",
    border: `1px solid ${ui.border}`,
    backgroundColor: ui.surfaceMuted,
    color: ui.muted,
    fontSize: "12px",
    fontWeight: 650,
    lineHeight: 1.2,
    whiteSpace: "nowrap",
  };

  const tableWrapStyle: React.CSSProperties = {
    overflowX: "auto",
    borderRadius: "10px",
    border: `1px solid ${ui.border}`,
    backgroundColor: ui.surface,
  };

  const tableStyle: React.CSSProperties = {
    borderCollapse: "separate",
    borderSpacing: 0,
    width: "100%",
    minWidth: "1120px",
  };

  const cellStyle: React.CSSProperties = {
    padding: "10px 14px",
    borderBottom: `1px solid ${ui.border}`,
    fontSize: "14px",
    lineHeight: 1.45,
    overflowWrap: "anywhere",
    verticalAlign: "top",
    textAlign: "left",
    color: ui.text,
    backgroundColor: "transparent",
  };

  const headerStyle: React.CSSProperties = {
    ...cellStyle,
    fontWeight: 650,
    color: ui.muted,
    backgroundColor: ui.surfaceMuted,
    fontSize: "13px",
    letterSpacing: "0.02em",
    position: "sticky",
    top: 0,
    zIndex: 1,
  };

  const actionLinkStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "8px 12px",
    borderRadius: "999px",
    border: `1px solid ${ui.blueBorder}`,
    backgroundColor: ui.blueSoft,
    color: ui.blue,
    fontSize: "12px",
    fontWeight: 700,
    lineHeight: 1.2,
    textDecoration: "none",
    whiteSpace: "nowrap",
  };

  return (
    <main style={pageStyle}>
      <div style={shellStyle}>
        <PageHeader
          title="Inactive Work Orders"
          description={`${orders.length} inactive open work orders. Review the backlog of work orders that are open but not currently active on the shop floor.`}
        />

        <section style={sectionCardStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={sectionTitleStyle}>Backlog overview</h2>
              <p style={sectionDescriptionStyle}>
                Open inactive work orders with a direct shortcut into Office Update
                for activation.
              </p>
            </div>
            <span style={countBadgeStyle}>
              {orders.length} order{orders.length !== 1 ? "s" : ""}
            </span>
          </div>

          {orders.length > 0 ? (
            <div style={tableWrapStyle}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={{ ...headerStyle, borderTopLeftRadius: "10px" }}>WO</th>
                    <th style={headerStyle}>Customer</th>
                    <th style={headerStyle}>PN</th>
                    <th style={headerStyle}>Type</th>
                    <th style={headerStyle}>RFQ</th>
                    <th style={headerStyle}>Last Update</th>
                    <th style={{ ...headerStyle, borderTopRightRadius: "10px" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order, index) => {
                    const lastUpdate = latestUpdate(
                      order.last_system_update,
                      order.last_manual_update,
                    );
                    const rfq = rfqDisplay(order.rfq_state);
                    const isLast = index === orders.length - 1;
                    const rowCellStyle = isLast
                      ? { ...cellStyle, borderBottom: 0 }
                      : cellStyle;

                    return (
                      <tr key={order.work_order_id}>
                        <td style={{ ...rowCellStyle, fontWeight: 650 }}>
                          {order.work_order_id}
                        </td>
                        <td style={rowCellStyle}>{order.customer || "-"}</td>
                        <td style={rowCellStyle}>{order.part_number || "-"}</td>
                        <td style={rowCellStyle}>{order.work_order_type || "-"}</td>
                        <td style={{ ...rowCellStyle, color: rfq.color }}>{rfq.label}</td>
                        <td style={rowCellStyle}>{formatDate(lastUpdate)}</td>
                        <td style={rowCellStyle}>
                          <Link
                            href={`/office-update?wo=${order.work_order_id}`}
                            prefetch={false}
                            style={actionLinkStyle}
                          >
                            Make active
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div
              style={{
                padding: "14px",
                borderRadius: "10px",
                backgroundColor: ui.surface,
                border: `1px dashed ${ui.borderStrong}`,
                color: ui.muted,
                fontSize: "13px",
              }}
            >
              No inactive work orders.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default function BacklogPage() {
  return (
    <RequireRole allowedRoles={["office"]}>
      <BacklogPageContent />
    </RequireRole>
  );
}
