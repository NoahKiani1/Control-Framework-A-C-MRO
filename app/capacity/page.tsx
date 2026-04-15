"use client";

import { useEffect, useState } from "react";
import {
  deletePastEngineerAbsences,
  getEngineerAbsences,
  getEngineers,
} from "@/lib/engineers";
import { getWorkOrders } from "@/lib/work-orders";
import { calculateWeekCapacity, type WeekCapacity, type OrderCapacity } from "@/lib/capacity";
import { isRfqBlockedState } from "@/lib/work-order-rules";
import { RESTRICTION_LABELS, RESTRICTION_BLOCKED_STEPS } from "@/lib/restrictions";
import { PROCESS_STEPS } from "@/lib/process-steps";

type Engineer = {
  id: number;
  name: string;
  is_active: boolean;
  restrictions: string[] | null;
};

type Absence = {
  id: number;
  engineer_id: number;
  absence_date: string;
  reason: string | null;
  absence_group_id: string | null;
};

type WorkOrder = {
  work_order_id: string;
  customer: string | null;
  work_order_type: string | null;
  part_number: string | null;
  current_process_step: string | null;
  due_date: string | null;
  hold_reason: string | null;
  rfq_state: string | null;
};

type GroupedAbsence = {
  key: string;
  engineer_id: number;
  reason: string | null;
  start_date: string;
  end_date: string;
  days: number;
  ids: number[];
  group_id: string | null;
};

type ExcludedOrder = WorkOrder & {
  reason: string;
};

export default function CapacityPage() {
  const [engineers, setEngineers] = useState<Engineer[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [allOrders, setAllOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);


  const [weeks, setWeeks] = useState<WeekCapacity[]>([]);
  const [orderDetails, setOrderDetails] = useState<OrderCapacity[]>([]);
  const [overdueOrders, setOverdueOrders] = useState<OrderCapacity[]>([]);

  const [showInfoBanner, setShowInfoBanner] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("capacity-info-banner-dismissed") !== "true";
  });

  async function loadData() {
    const today = new Date().toISOString().split("T")[0];
    await deletePastEngineerAbsences(today);

    const engData = await getEngineers<Engineer>({
      select: "*",
      isActive: true,
      role: "shop",
      orderBy: { column: "name" },
    });

    const allAbsData = await getEngineerAbsences<Absence>({
      select: "*",
      fromDate: new Date().toISOString().split("T")[0],
      orderBy: { column: "absence_date", ascending: true },
    });

    const shopEngineerIds = new Set(engData.map((e) => e.id));
    const absData = allAbsData.filter((a) => shopEngineerIds.has(a.engineer_id));

    const woData = await getWorkOrders<WorkOrder>({
      select:
        "work_order_id, customer, work_order_type, part_number, current_process_step, due_date, hold_reason, rfq_state",
      isOpen: true,
      isActive: true,
    });

    setEngineers(engData);
    setAbsences(absData);
    setAllOrders(woData);

    const absenceDates = absData.map((a) => {
      const d = new Date(a.absence_date);
      d.setHours(0, 0, 0, 0);
      return d;
    });

    const result = calculateWeekCapacity(woData, engData.length, absenceDates);
    setWeeks(result.weeks);
    setOrderDetails(result.orderDetails);
    setOverdueOrders(result.overdueOrders);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
  }, []);


  if (loading) return <p style={{ padding: "2rem" }}>Loading...</p>;

  // --- Derived data ---

  const excludedOrders: ExcludedOrder[] = allOrders
    .filter((o) => {
      if (!o.due_date) return true;
      if (o.hold_reason) return true;
      if (isRfqBlockedState(o.rfq_state)) return true;
      if (o.current_process_step === "EASA-Form 1") return true;
      return false;
    })
    .map((o) => {
      let reason = "";
      if (!o.due_date) reason = "No due date";
      else if (o.hold_reason) reason = `Blocked: ${o.hold_reason}`;
      else if (isRfqBlockedState(o.rfq_state)) reason = "RFQ blocked";
      else if (o.current_process_step === "EASA-Form 1") reason = "Ready to close (EASA-Form 1)";
      return { ...o, reason };
    });

  const ordersNoDueDate = excludedOrders.filter((o) => !o.due_date);
  const ordersBlocked = excludedOrders.filter((o) => o.due_date && (o.hold_reason || isRfqBlockedState(o.rfq_state)));
  const ordersEasa = excludedOrders.filter((o) => o.due_date && o.current_process_step === "EASA-Form 1" && !o.hold_reason && !isRfqBlockedState(o.rfq_state));

  // --- Restriction warnings ---
  // For each day in the 3-week window, check if any capability is unavailable
  // because all present engineers have that restriction.

  type RestrictionWarning = {
    restriction: string;
    label: string;
    blockedSteps: string[];
    unavailableDates: string[];
    affectedOrders: { work_order_id: string; customer: string | null; current_step: string | null; due_date: string | null }[];
  };

  const restrictionWarnings: RestrictionWarning[] = (() => {
    const allDays: Date[] = weeks.flatMap((w) => w.workDays);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const warnings: RestrictionWarning[] = [];

    for (const [restriction, label] of Object.entries(RESTRICTION_LABELS)) {
      const blockedSteps = RESTRICTION_BLOCKED_STEPS[restriction] || [];

      // Find days where no present engineer can do this
      const unavailableDates: string[] = [];

      for (const day of allDays) {
        if (day < today) continue;
        const dayStr = day.toISOString().split("T")[0];

        // Which engineers are present this day?
        const absentIds = new Set(
          absences.filter((a) => a.absence_date === dayStr).map((a) => a.engineer_id),
        );
        const presentEngineers = engineers.filter((e) => !absentIds.has(e.id));

        if (presentEngineers.length === 0) {
          unavailableDates.push(dayStr);
          continue;
        }

        // Can any present engineer do this?
        const anyoneCanDo = presentEngineers.some(
          (e) => !(e.restrictions || []).includes(restriction),
        );

        if (!anyoneCanDo) {
          unavailableDates.push(dayStr);
        }
      }

      if (unavailableDates.length === 0) continue;

      // Find affected orders: orders that still need one of the blocked steps
      const affected = allOrders
        .filter((o) => {
          if (!o.work_order_type || !o.current_process_step) return false;
          const steps = PROCESS_STEPS[o.work_order_type];
          if (!steps) return false;

          const currentIdx = steps.indexOf(o.current_process_step);
          if (currentIdx === -1) return false;

          // Check if any blocked step is at or after the current step
          return blockedSteps.some((bs) => {
            const bsIdx = steps.indexOf(bs);
            return bsIdx >= currentIdx;
          });
        })
        .map((o) => ({
          work_order_id: o.work_order_id,
          customer: o.customer,
          current_step: o.current_process_step,
          due_date: o.due_date,
        }));

      if (affected.length === 0) continue;

      warnings.push({
        restriction,
        label,
        blockedSteps,
        unavailableDates,
        affectedOrders: affected,
      });
    }

    return warnings;
  })();

  function getActiveEngineersForWeek(week: WeekCapacity): number {
    const absentIds = new Set<number>();
    for (const day of week.workDays) {
      const dayStr = day.toISOString().split("T")[0];
      for (const a of absences) {
        if (a.absence_date === dayStr) {
          absentIds.add(a.engineer_id);
        }
      }
    }
    return Math.max(0, engineers.length - absentIds.size);
  }

  function getOrderCountForWeek(week: WeekCapacity): number {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return orderDetails.filter((o) => {
      if (o.is_overdue && week.weekLabel === "This week") return true;
      const dueDate = new Date(o.due_date);
      dueDate.setHours(0, 0, 0, 0);
      return week.workDays.some((d) => d >= today && d <= dueDate);
    }).length;
  }

  // --- Format helpers ---

  function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  function formatShortDate(date: Date): string {
    return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }

  function weekDateRange(week: WeekCapacity): string {
    if (week.workDays.length === 0) return "";
    const first = week.workDays[0];
    const last = week.workDays[week.workDays.length - 1];
    return `${formatShortDate(first)} – ${formatShortDate(last)}`;
  }

  function statusColor(status: string): string {
    if (status === "red") return "#dc2626";
    if (status === "orange") return "#ea580c";
    return "#16a34a";
  }

  function statusBg(status: string): string {
    if (status === "red") return "#fef2f2";
    if (status === "orange") return "#fff7ed";
    return "#f0fdf4";
  }

  function statusBorder(status: string): string {
    if (status === "red") return "#fca5a5";
    if (status === "orange") return "#fdba74";
    return "#86efac";
  }

  function statusLabel(status: string): string {
    if (status === "red") return "Overloaded";
    if (status === "orange") return "Nearly full";
    return "On track";
  }

  function statusEmoji(status: string): string {
    if (status === "red") return "🔴";
    if (status === "orange") return "🟠";
    return "🟢";
  }

  // --- Grouped absences ---

  const groupedAbsences: GroupedAbsence[] = Object.values(
    absences.reduce((acc, a) => {
      const key = a.absence_group_id || `single-${a.id}`;

      if (!acc[key]) {
        acc[key] = {
          key,
          engineer_id: a.engineer_id,
          reason: a.reason,
          start_date: a.absence_date,
          end_date: a.absence_date,
          days: 0,
          ids: [],
          group_id: a.absence_group_id,
        };
      }

      if (a.absence_date < acc[key].start_date) acc[key].start_date = a.absence_date;
      if (a.absence_date > acc[key].end_date) acc[key].end_date = a.absence_date;

      acc[key].days += 1;
      acc[key].ids.push(a.id);

      return acc;
    }, {} as Record<string, GroupedAbsence>)
  ).sort((a, b) => a.start_date.localeCompare(b.start_date));

  // Split absences: within 3-week capacity window vs later
  const threeWeekCutoff = (() => {
    if (weeks.length === 0) return "";
    const lastWeek = weeks[weeks.length - 1];
    if (lastWeek.workDays.length === 0) return "";
    const lastDay = lastWeek.workDays[lastWeek.workDays.length - 1];
    return lastDay.toISOString().split("T")[0];
  })();

  const absencesThisWindow = groupedAbsences.filter(
    (a) => !threeWeekCutoff || a.start_date <= threeWeekCutoff,
  );
  const absencesLater = groupedAbsences.filter(
    (a) => threeWeekCutoff && a.start_date > threeWeekCutoff,
  );

  // --- Styles ---

  const cellStyle: React.CSSProperties = {
    padding: "6px 10px",
    borderBottom: "1px solid #eee",
    fontSize: "13px",
    overflowWrap: "anywhere",
    verticalAlign: "top",
    textAlign: "left",
  };
  const headerCellStyle: React.CSSProperties = { ...cellStyle, fontWeight: "bold", backgroundColor: "#f5f5f5" };

  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif", maxWidth: "960px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Capacity Management</h1>
      </div>

      {/* Info banner */}
      {showInfoBanner && (
        <section
          style={{
            marginTop: "1rem",
            padding: "16px 18px",
            backgroundColor: "#f0f4ff",
            border: "1px solid #c7d2fe",
            borderRadius: "8px",
            fontSize: "13px",
            lineHeight: "1.7",
            color: "#374151",
            position: "relative",
          }}
        >
          <button
            onClick={() => {
              setShowInfoBanner(false);
              localStorage.setItem("capacity-info-banner-dismissed", "true");
            }}
            style={{
              position: "absolute",
              top: "8px",
              right: "10px",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "16px",
              color: "#9ca3af",
              padding: "2px 6px",
            }}
            title="Dismiss"
          >
            ✕
          </button>

          <strong style={{ color: "#4338ca", fontSize: "14px" }}>ℹ How this page works</strong>

          <div style={{ marginTop: "10px" }}>
            <strong>Planned hours</strong> — Each work order has estimated hours based on data per
            part number. When there is insufficient data for a part number, a fallback value per work
            order type is used (e.g. Wheel Repair = 5.0h, Brake Overhaul = 12.2h). The remaining hours
            are estimated from the current process step — earlier steps mean more work left. These
            hours are then spread evenly across the working days between today and the due date.
          </div>

          <div style={{ marginTop: "8px" }}>
            <strong>Available hours</strong> — Based on <strong>{engineers.length} shop
            engineer{engineers.length !== 1 ? "s" : ""}</strong>, working Mon–Thu 8h and Fri 6h,
            minus any planned shop engineer absences listed at the bottom of this page.
          </div>

          <div style={{ marginTop: "8px" }}>
            <strong>Utilization %</strong> — Planned hours ÷ available hours × 100.
            {" "}<span style={{ color: "#16a34a" }}>🟢 Under 80% = on track.</span>
            {" "}<span style={{ color: "#ea580c" }}>🟠 80–99% = nearly full.</span>
            {" "}<span style={{ color: "#dc2626" }}>🔴 100% or more = overloaded.</span>
          </div>

          <div style={{ marginTop: "8px" }}>
            <strong>Remaining</strong> (in the table below) = estimated hours left based on the
            current step. <strong>Per day</strong> = remaining hours ÷ work days until the due date.
            Overdue orders have all their remaining hours loaded onto the current week.
          </div>

          <div
            style={{
              marginTop: "12px",
              padding: "10px 14px",
              backgroundColor: "#fefce8",
              border: "1px solid #fde68a",
              borderRadius: "6px",
              lineHeight: "1.6",
            }}
          >
            <strong style={{ color: "#92400e" }}>Not included in this calculation:</strong>
            <br />
            • Orders without a due date ({ordersNoDueDate.length}) — assign one
            via <a href="/office-update" style={{ color: "#b45309", fontWeight: "bold" }}>Office Update</a> to
            include them
            <br />
            • Blocked orders ({ordersBlocked.length}) — on hold or waiting for RFQ
            <br />
            • Orders at EASA-Form 1 ({ordersEasa.length}) — ready to close, no work remaining
          </div>
        </section>
      )}

      {/* Weekly Overview */}
      <section style={{ marginTop: "1.5rem" }}>
        <h2 style={{ marginBottom: "12px" }}>Weekly Overview</h2>

        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
          {weeks.map((w, i) => {
            const activeEngs = getActiveEngineersForWeek(w);
            const orderCount = getOrderCountForWeek(w);

            return (
              <div
                key={i}
                style={{
                  flex: "1",
                  minWidth: "240px",
                  padding: "16px",
                  backgroundColor: statusBg(w.status),
                  border: `2px solid ${statusBorder(w.status)}`,
                  borderRadius: "10px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <h3 style={{ margin: 0, color: statusColor(w.status), fontSize: "16px" }}>
                    {w.weekLabel}
                  </h3>
                  <span style={{ fontSize: "12px", color: "#888" }}>
                    {weekDateRange(w)}
                  </span>
                </div>

                <div
                  style={{
                    marginTop: "8px",
                    display: "inline-block",
                    padding: "2px 10px",
                    borderRadius: "12px",
                    fontSize: "12px",
                    fontWeight: "bold",
                    color: statusColor(w.status),
                    backgroundColor: `${statusColor(w.status)}18`,
                  }}
                >
                  {statusEmoji(w.status)} {statusLabel(w.status)}
                </div>

                <p
                  style={{
                    margin: "10px 0 0",
                    fontSize: "28px",
                    fontWeight: "bold",
                    color: statusColor(w.status),
                    lineHeight: 1,
                  }}
                >
                  {w.percentage}%
                </p>

                <div style={{ marginTop: "10px", fontSize: "13px", color: "#555" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                    <span>Planned hours</span>
                    <strong>{w.requiredHours}h</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                    <span>Available hours</span>
                    <strong>{w.availableHours}h</strong>
                  </div>
                </div>

                <div
                  style={{
                    marginTop: "10px",
                    paddingTop: "8px",
                    borderTop: `1px solid ${statusBorder(w.status)}`,
                    fontSize: "12px",
                    color: "#777",
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <span>{activeEngs}/{engineers.length} engineers</span>
                  <span>{orderCount} order{orderCount !== 1 ? "s" : ""}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Overdue warning */}
      {overdueOrders.length > 0 && (
        <section
          style={{
            marginTop: "1.5rem",
            padding: "14px 16px",
            backgroundColor: "#fef2f2",
            border: "1px solid #fca5a5",
            borderRadius: "8px",
          }}
        >
          <strong style={{ color: "#dc2626", fontSize: "14px" }}>
            ⚠ {overdueOrders.length} work order{overdueOrders.length !== 1 ? "s" : ""} past due date
          </strong>
          <p style={{ margin: "6px 0 8px", fontSize: "13px", color: "#7f1d1d" }}>
            Their full remaining hours have been added to the current week&apos;s planned hours.
          </p>
          <ul style={{ margin: 0, paddingLeft: "20px" }}>
            {overdueOrders.map((o) => (
              <li key={o.work_order_id} style={{ fontSize: "13px", padding: "2px 0" }}>
                <strong>{o.work_order_id}</strong> — {o.customer || "–"} — due {formatDate(o.due_date)} — {o.remaining_hours}h remaining
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Restriction warnings */}
      {restrictionWarnings.length > 0 && restrictionWarnings.map((w) => (
        <section
          key={w.restriction}
          style={{
            marginTop: "1.5rem",
            padding: "14px 16px",
            backgroundColor: "#fffbeb",
            border: "1px solid #fde68a",
            borderRadius: "8px",
          }}
        >
          <strong style={{ color: "#92400e", fontSize: "14px" }}>
            ⚠ {w.label} — unavailable on {w.unavailableDates.length} day{w.unavailableDates.length !== 1 ? "s" : ""}
          </strong>
          <p style={{ margin: "6px 0 4px", fontSize: "13px", color: "#78350f" }}>
            On these dates no available engineer can perform{" "}
            <strong>{w.blockedSteps.join(", ")}</strong>:
          </p>
          <p style={{ margin: "0 0 10px", fontSize: "13px", color: "#92400e", fontWeight: "bold" }}>
            {w.unavailableDates.map((d) => formatDate(d)).join(", ")}
          </p>

          <p style={{ margin: "0 0 4px", fontSize: "13px", color: "#78350f" }}>
            {w.affectedOrders.length} order{w.affectedOrders.length !== 1 ? "s" : ""} still
            {w.affectedOrders.length !== 1 ? " need" : " needs"} this — make sure{" "}
            {w.restriction === "certification" ? "certification is" : "these steps are"}{" "}
            done on a day when a qualified engineer is present:
          </p>
          <ul style={{ margin: 0, paddingLeft: "20px" }}>
            {w.affectedOrders.map((o) => (
              <li key={o.work_order_id} style={{ fontSize: "13px", padding: "2px 0" }}>
                <strong>{o.work_order_id}</strong> — {o.customer || "–"}
                {" "}(now at {o.current_step || "–"})
                {o.due_date ? ` — due ${formatDate(o.due_date)}` : " — no due date"}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {/* Order details table */}
      {orderDetails.length > 0 && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2 style={{ marginBottom: "4px" }}>
            Orders included in calculation ({orderDetails.length})
          </h2>
          <p style={{ margin: "0 0 8px", fontSize: "13px", color: "#666" }}>
            Only active, non-blocked orders with a due date and not yet at EASA-Form 1.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
              <thead>
                <tr>
                  <th style={headerCellStyle}>WO</th>
                  <th style={headerCellStyle}>Customer</th>
                  <th style={headerCellStyle}>Part Number</th>
                  <th style={headerCellStyle}>Type</th>
                  <th style={headerCellStyle}>Due Date</th>
                  <th style={headerCellStyle}>Remaining</th>
                  <th style={headerCellStyle}>Per day</th>
                </tr>
              </thead>
              <tbody>
                {orderDetails.map((o) => (
                  <tr key={o.work_order_id} style={{ backgroundColor: o.is_overdue ? "#fef2f2" : "white" }}>
                    <td style={{ ...cellStyle, fontWeight: o.is_overdue ? "bold" : "normal" }}>
                      {o.work_order_id}
                    </td>
                    <td style={cellStyle}>{o.customer || "–"}</td>
                    <td style={cellStyle}>{o.part_number || "–"}</td>
                    <td style={cellStyle}>{o.work_order_type || "–"}</td>
                    <td style={cellStyle}>
                      {formatDate(o.due_date)}
                      {o.is_overdue && (
                        <span style={{ color: "#dc2626", fontWeight: "bold", marginLeft: "4px" }}>OVERDUE</span>
                      )}
                    </td>
                    <td style={cellStyle}>{o.remaining_hours}h</td>
                    <td style={cellStyle}>
                      {o.is_overdue ? (
                        <span style={{ color: "#dc2626" }}>{o.remaining_hours}h (all this week)</span>
                      ) : (
                        <span>{o.hours_per_day}h/day</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Excluded orders (blocked + EASA) — collapsible */}
      {(ordersBlocked.length > 0 || ordersEasa.length > 0) && (
        <section style={{ marginTop: "1.5rem" }}>
          <details>
            <summary
              style={{
                cursor: "pointer",
                fontSize: "14px",
                fontWeight: "bold",
                color: "#666",
                padding: "8px 0",
              }}
            >
              {ordersBlocked.length + ordersEasa.length} other order{ordersBlocked.length + ordersEasa.length !== 1 ? "s" : ""} excluded from calculation
            </summary>
            <div style={{ overflowX: "auto", marginTop: "8px" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
                <thead>
                  <tr>
                    <th style={headerCellStyle}>WO</th>
                    <th style={headerCellStyle}>Customer</th>
                    <th style={headerCellStyle}>Type</th>
                    <th style={headerCellStyle}>Reason excluded</th>
                  </tr>
                </thead>
                <tbody>
                  {[...ordersBlocked, ...ordersEasa].map((o) => (
                    <tr key={o.work_order_id} style={{ backgroundColor: "#fafafa" }}>
                      <td style={cellStyle}>{o.work_order_id}</td>
                      <td style={cellStyle}>{o.customer || "–"}</td>
                      <td style={cellStyle}>{o.work_order_type || "–"}</td>
                      <td style={cellStyle}>{o.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      )}

      {/* Shop engineer absences */}
      <section style={{ marginTop: "2rem", borderTop: "2px solid #eee", paddingTop: "1.5rem" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <div>
            <h2 style={{ margin: 0 }}>Shop Engineer Absences (Next 3 Weeks)</h2>
            <p style={{ color: "#666", fontSize: "14px", margin: "6px 0 0" }}>
              Manage all shop engineer absences on the{" "}
              <a href="/staff" style={{ color: "#0070f3" }}>Staff Management</a> page.
            </p>
          </div>

          {absencesLater.length > 0 && (
            <a href="/staff#later-upcoming-absences" style={{ color: "#0070f3", fontSize: "13px" }}>
              View {absencesLater.length} later upcoming absence{absencesLater.length !== 1 ? "s" : ""} →
            </a>
          )}
        </div>

        {absencesThisWindow.length > 0 ? (
          <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed", marginTop: "12px" }}>
            <thead>
              <tr>
                <th style={headerCellStyle}>Engineer</th>
                <th style={headerCellStyle}>From</th>
                <th style={headerCellStyle}>Until (inclusive)</th>
                <th style={headerCellStyle}>Days</th>
                <th style={headerCellStyle}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {absencesThisWindow.map((a) => {
                const eng = engineers.find((e) => e.id === a.engineer_id);
                return (
                  <tr key={a.key}>
                    <td style={cellStyle}>{eng?.name || "Unknown"}</td>
                    <td style={cellStyle}>{formatDate(a.start_date)}</td>
                    <td style={cellStyle}>{formatDate(a.end_date)}</td>
                    <td style={cellStyle}>{a.days}</td>
                    <td style={cellStyle}>{a.reason || "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p style={{ color: "#666", fontSize: "14px", marginTop: "12px" }}>
            No shop engineer absences planned in the next 3 weeks.
          </p>
        )}
      </section>
    </main>
  );
}
