"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { READY_TO_CLOSE_STEP } from "@/lib/process-steps";
import { canPerformStep } from "@/lib/restrictions";
import {
  formatDate,
  isBlocked,
  normalizeAssignedPersonTeam,
  normalizeRfqState,
  sortOrders,
} from "@/lib/work-order-rules";
import {
  getEngineerAbsences,
  getEngineerPhotoUrl,
  getEngineers,
} from "@/lib/engineers";
import { getWorkOrders } from "@/lib/work-orders";

type WorkOrder = {
  work_order_id: string;
  customer: string | null;
  part_number: string | null;
  work_order_type: string | null;
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

type Engineer = {
  id: number;
  name: string;
  photo_path: string | null;
  restrictions: string[] | null;
};

type Absence = {
  engineer_id: number;
  absence_date: string;
};

const NO_QUALIFIED_ENGINEER_REASON = "No Qualified Engineer Present";

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function applyTodayQualificationBlocks(
  orders: WorkOrder[],
  engineers: Engineer[],
  absences: Absence[],
  today: string,
): WorkOrder[] {
  const absentEngineerIds = new Set(
    absences
      .filter((absence) => absence.absence_date === today)
      .map((absence) => absence.engineer_id),
  );
  const presentEngineers = engineers.filter(
    (engineer) => !absentEngineerIds.has(engineer.id),
  );

  return orders.map((order) => {
    if (isBlocked(order) || !order.current_process_step) return order;

    const hasQualifiedEngineer = presentEngineers.some((engineer) =>
      canPerformStep(engineer.restrictions, order.current_process_step!),
    );

    if (hasQualifiedEngineer) return order;

    return {
      ...order,
      hold_reason: NO_QUALIFIED_ENGINEER_REASON,
    };
  });
}

function AssignedPerson({
  name,
  photoUrl,
}: {
  name: string | null;
  photoUrl: string | null;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const displayName = normalizeAssignedPersonTeam(name);

  if (!photoUrl || imageFailed) {
    return <>{displayName}</>;
  }

  return (
    <span style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Image
        src={photoUrl}
        alt={displayName}
        width={38}
        height={38}
        unoptimized
        onError={() => setImageFailed(true)}
        style={{
          width: "38px",
          height: "38px",
          borderRadius: "50%",
          objectFit: "contain",
          flexShrink: 0,
        }}
      />
    </span>
  );
}

export default function ShopPage() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [engineers, setEngineers] = useState<Engineer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const today = localDateKey();
      const [data, engineerData, absenceData] = await Promise.all([
        getWorkOrders<WorkOrder>({
          select:
            "work_order_id, customer, part_number, work_order_type, due_date, priority, assigned_person_team, current_process_step, hold_reason, rfq_state, required_next_action, last_manual_update, last_system_update",
          isOpen: true,
          isActive: true,
        }),
        getEngineers<Engineer>({
          select: "id, name, photo_path, restrictions",
          isActive: true,
          role: "shop",
        }),
        getEngineerAbsences<Absence>({
          select: "engineer_id, absence_date",
          fromDate: today,
        }),
      ]);

      const filtered = data.filter(
        (o) => o.current_process_step !== READY_TO_CLOSE_STEP,
      );
      const qualifiedFiltered = applyTodayQualificationBlocks(
        filtered,
        engineerData,
        absenceData,
        today,
      );

      setOrders(sortOrders(qualifiedFiltered));
      setEngineers(engineerData);
      setLoading(false);
    }

    load();

    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return <p style={{ padding: "2rem", fontSize: "24px" }}>Loading...</p>;

  const nonBlockedOrders = orders.filter((o) => !isBlocked(o));
  const blockedOrders = orders.filter((o) => isBlocked(o));
  const engineerByName = new Map(engineers.map((e) => [e.name, e]));

  const cellStyle: React.CSSProperties = {
    padding: "10px 14px",
    borderBottom: "2px solid #ddd",
    fontSize: "18px",
    whiteSpace: "normal",
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

  function holdReasonDisplay(o: WorkOrder): string {
    if (o.hold_reason) return o.hold_reason;
    const rfqState = normalizeRfqState(o.rfq_state);
    if (rfqState === "rfq rejected") return "RFQ Rejected";
    if (rfqState === "rfq send") return "Waiting for RFQ Approval";
    return "–";
  }

  function renderNonBlockedOrdersTable(list: WorkOrder[]) {
    return (
      <div style={{ overflowX: "auto", marginTop: "0.5rem" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "12%" }} />
            <col style={{ width: "18%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "8%" }} />
          </colgroup>
          <thead>
            <tr>
              <th style={headerStyle}>WO</th>
              <th style={headerStyle}>Customer</th>
              <th style={headerStyle}>Part Number</th>
              <th style={headerStyle}>Type</th>
              <th style={headerStyle}>Prio</th>
              <th style={headerStyle}>Due Date</th>
              <th style={headerStyle}>Next Process Step</th>
              <th style={headerStyle}>Assigned</th>
            </tr>
          </thead>
          <tbody>
            {list.map((o) => (
              <tr
                key={o.work_order_id}
                style={{ backgroundColor: rowColor(o) }}
              >
                <td style={{ ...cellStyle, fontWeight: "bold" }}>
                  {o.work_order_id}
                </td>
                <td style={cellStyle}>{o.customer || "–"}</td>
                <td style={cellStyle}>{o.part_number || "–"}</td>
                <td style={cellStyle}>{o.work_order_type || "–"}</td>
                <td style={cellStyle}>{prioLabel(o)}</td>
                <td style={cellStyle}>{formatDate(o.due_date)}</td>
                <td style={cellStyle}>{o.current_process_step || "–"}</td>
                <td style={{ ...cellStyle, textAlign: "center" }}>
                  {(() => {
                    const assignedPersonTeam = normalizeAssignedPersonTeam(
                      o.assigned_person_team,
                    );

                    return (
                      <AssignedPerson
                        name={assignedPersonTeam}
                        photoUrl={getEngineerPhotoUrl(
                          engineerByName.get(assignedPersonTeam)?.photo_path,
                        )}
                      />
                    );
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function renderBlockedOrdersTable(list: WorkOrder[]) {
    return (
      <div style={{ overflowX: "auto", marginTop: "0.5rem" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "12%" }} />
            <col style={{ width: "18%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "10%" }} />
          </colgroup>
          <thead>
            <tr>
              <th style={headerStyle}>WO</th>
              <th style={headerStyle}>Customer</th>
              <th style={headerStyle}>Part Number</th>
              <th style={headerStyle}>Type</th>
              <th style={headerStyle}>Prio</th>
              <th style={headerStyle}>Due Date</th>
              <th style={headerStyle}>Hold Reason</th>
              <th style={headerStyle}>Action Required</th>
            </tr>
          </thead>
          <tbody>
            {list.map((o) => (
              <tr
                key={o.work_order_id}
                style={{ backgroundColor: rowColor(o) }}
              >
                <td style={{ ...cellStyle, fontWeight: "bold" }}>
                  {o.work_order_id}
                </td>
                <td style={cellStyle}>{o.customer || "–"}</td>
                <td style={cellStyle}>{o.part_number || "–"}</td>
                <td style={cellStyle}>{o.work_order_type || "–"}</td>
                <td style={cellStyle}>{prioLabel(o)}</td>
                <td style={cellStyle}>{formatDate(o.due_date)}</td>
                <td style={cellStyle}>{holdReasonDisplay(o)}</td>
                <td style={cellStyle}>{o.required_next_action || "–"}</td>
              </tr>
            ))}
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
          Auto-refreshes every 30s
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
