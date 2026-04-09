"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { calculateWeekCapacity, type WeekCapacity, type OrderCapacity } from "@/lib/capacity";

type Engineer = {
  id: number;
  name: string;
  is_active: boolean;
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

export default function CapacityPage() {
  const [engineers, setEngineers] = useState<Engineer[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const [newEngineerName, setNewEngineerName] = useState("");
  const [absenceEngineerId, setAbsenceEngineerId] = useState("");
  const [absenceDate, setAbsenceDate] = useState("");
  const [absenceEndDate, setAbsenceEndDate] = useState("");
  const [absenceReason, setAbsenceReason] = useState("");
  const [saveStatus, setSaveStatus] = useState("");

  const [weeks, setWeeks] = useState<WeekCapacity[]>([]);
  const [orderDetails, setOrderDetails] = useState<OrderCapacity[]>([]);
  const [overdueOrders, setOverdueOrders] = useState<OrderCapacity[]>([]);

  async function loadData() {
    const { data: eng } = await supabase
      .from("engineers")
      .select("*")
      .eq("is_active", true)
      .order("name");

    const { data: abs } = await supabase
      .from("engineer_absences")
      .select("*")
      .gte("absence_date", new Date().toISOString().split("T")[0])
      .order("absence_date", { ascending: true });

    const { data: wo } = await supabase
      .from("work_orders")
      .select("work_order_id, customer, work_order_type, current_process_step, due_date, hold_reason, rfq_state")
      .eq("is_open", true)
      .eq("is_active", true);

    const engData = (eng as Engineer[]) || [];
    const absData = (abs as Absence[]) || [];
    const woData = (wo as WorkOrder[]) || [];

    setEngineers(engData);
    setAbsences(absData);
    setOrders(woData);

    // Bereken capaciteit
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
    loadData();
  }, []);

  async function addEngineer() {
    if (!newEngineerName.trim()) return;
    await supabase.from("engineers").insert({ name: newEngineerName.trim() });
    setNewEngineerName("");
    loadData();
  }

  async function removeEngineer(id: number) {
    await supabase.from("engineers").update({ is_active: false }).eq("id", id);
    loadData();
  }

  async function addAbsence() {
    if (!absenceEngineerId || !absenceDate) return;

    const start = new Date(absenceDate);
    const end = absenceEndDate ? new Date(absenceEndDate) : new Date(absenceDate);

    const dates: string[] = [];
    const current = new Date(start);

    while (current <= end) {
      const day = current.getDay();
      if (day >= 1 && day <= 5) {
        dates.push(current.toISOString().split("T")[0]);
      }
      current.setDate(current.getDate() + 1);
    }

    if (dates.length === 0) return;

    const groupId = crypto.randomUUID();

    const rows = dates.map((d) => ({
      engineer_id: parseInt(absenceEngineerId),
      absence_date: d,
      reason: absenceReason || null,
      absence_group_id: groupId,
    }));

    const { error } = await supabase.from("engineer_absences").upsert(rows, {
      onConflict: "engineer_id,absence_date",
    });

    if (error) {
      setSaveStatus(`Fout: ${error.message}`);
    } else {
      setSaveStatus(`✅ ${dates.length} dag(en) toegevoegd`);
      setAbsenceDate("");
      setAbsenceEndDate("");
      setAbsenceReason("");
      loadData();
    }
  }

  async function removeAbsence(groupId: string | null, ids: number[]) {
    if (groupId) {
      await supabase
        .from("engineer_absences")
        .delete()
        .eq("absence_group_id", groupId);
    } else {
      await supabase
        .from("engineer_absences")
        .delete()
        .in("id", ids);
    }

    loadData();
  }

  if (loading) return <p style={{ padding: "2rem" }}>Laden...</p>;

  function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleDateString("nl-NL", { day: "2-digit", month: "2-digit", year: "numeric" });
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

  const labelStyle: React.CSSProperties = { display: "block", marginTop: "10px", fontWeight: "bold", fontSize: "13px" };
  const inputStyle: React.CSSProperties = { width: "100%", padding: "8px", border: "1px solid #ccc", borderRadius: "4px", fontSize: "14px", marginTop: "4px" };
  const buttonStyle: React.CSSProperties = { padding: "8px 16px", backgroundColor: "#0070f3", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "bold", fontSize: "13px", marginTop: "8px" };
  const cellStyle: React.CSSProperties = { padding: "6px 10px", borderBottom: "1px solid #eee", fontSize: "13px" };

  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif", maxWidth: "900px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Capaciteitsmanagement</h1>
        <a href="/">← Home</a>
      </div>

      {/* Weekoverzicht */}
      <section style={{ marginTop: "1.5rem" }}>
        <h2>Weekoverzicht</h2>
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
          {weeks.map((w, i) => (
            <div
              key={i}
              style={{
                flex: "1",
                minWidth: "220px",
                padding: "16px",
                backgroundColor: statusBg(w.status),
                border: `2px solid ${statusBorder(w.status)}`,
                borderRadius: "8px",
              }}
            >
              <h3 style={{ margin: "0 0 8px", color: statusColor(w.status) }}>
                {w.weekLabel}
              </h3>
              <p style={{ margin: "4px 0", fontSize: "14px" }}>
                Benodigd: <strong>{w.requiredHours}u</strong>
              </p>
              <p style={{ margin: "4px 0", fontSize: "14px" }}>
                Beschikbaar: <strong>{w.availableHours}u</strong>
              </p>
              <p
                style={{
                  margin: "8px 0 0",
                  fontSize: "20px",
                  fontWeight: "bold",
                  color: statusColor(w.status),
                }}
              >
                {w.percentage}%
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Overdue warning */}
      {overdueOrders.length > 0 && (
        <section
          style={{
            marginTop: "1.5rem",
            padding: "12px 16px",
            backgroundColor: "#fef2f2",
            border: "1px solid #fca5a5",
            borderRadius: "6px",
          }}
        >
          <strong style={{ color: "#dc2626" }}>
            ⚠ {overdueOrders.length} work order(s) met overschreden due date!
          </strong>
          <ul style={{ margin: "8px 0 0", paddingLeft: "20px" }}>
            {overdueOrders.map((o) => (
              <li key={o.work_order_id} style={{ fontSize: "13px" }}>
                {o.work_order_id} — {o.customer || "–"} — due {formatDate(o.due_date)} — {o.remaining_hours}u resterend
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Order details */}
      {orderDetails.length > 0 && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2>Work Orders in capaciteitsberekening</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ ...cellStyle, fontWeight: "bold", backgroundColor: "#f5f5f5" }}>WO</th>
                  <th style={{ ...cellStyle, fontWeight: "bold", backgroundColor: "#f5f5f5" }}>Klant</th>
                  <th style={{ ...cellStyle, fontWeight: "bold", backgroundColor: "#f5f5f5" }}>Type</th>
                  <th style={{ ...cellStyle, fontWeight: "bold", backgroundColor: "#f5f5f5" }}>Due Date</th>
                  <th style={{ ...cellStyle, fontWeight: "bold", backgroundColor: "#f5f5f5" }}>Resterend</th>
                  <th style={{ ...cellStyle, fontWeight: "bold", backgroundColor: "#f5f5f5" }}>Per dag</th>
                </tr>
              </thead>
              <tbody>
                {orderDetails.map((o) => (
                  <tr key={o.work_order_id} style={{ backgroundColor: o.is_overdue ? "#fef2f2" : "white" }}>
                    <td style={cellStyle}>{o.work_order_id}</td>
                    <td style={cellStyle}>{o.customer || "–"}</td>
                    <td style={cellStyle}>{o.work_order_type || "–"}</td>
                    <td style={cellStyle}>{formatDate(o.due_date)}{o.is_overdue ? " ⚠" : ""}</td>
                    <td style={cellStyle}>{o.remaining_hours}u</td>
                    <td style={cellStyle}>{o.hours_per_day}u/dag</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Engineers */}
      <section style={{ marginTop: "2rem", borderTop: "2px solid #eee", paddingTop: "1.5rem" }}>
        <h2>Engineers ({engineers.length})</h2>

        {engineers.map((e) => (
          <div key={e.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "6px 0" }}>
            <span style={{ fontSize: "14px" }}>{e.name}</span>
            <button
              onClick={() => removeEngineer(e.id)}
              style={{ ...buttonStyle, backgroundColor: "#dc2626", fontSize: "11px", padding: "4px 10px", marginTop: 0 }}
            >
              Verwijderen
            </button>
          </div>
        ))}

        <div style={{ display: "flex", gap: "8px", marginTop: "8px", alignItems: "end" }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Nieuwe engineer</label>
            <input
              type="text"
              style={inputStyle}
              value={newEngineerName}
              onChange={(e) => setNewEngineerName(e.target.value)}
              placeholder="Naam..."
            />
          </div>
          <button style={buttonStyle} onClick={addEngineer}>+ Toevoegen</button>
        </div>
      </section>

      {/* Absences */}
      <section style={{ marginTop: "2rem", borderTop: "2px solid #eee", paddingTop: "1.5rem" }}>
        <h2>Afwezigheden</h2>

        {groupedAbsences.length > 0 ? (
          <table style={{ borderCollapse: "collapse", width: "100%", marginBottom: "12px" }}>
            <thead>
              <tr>
                <th style={{ ...cellStyle, fontWeight: "bold", backgroundColor: "#f5f5f5" }}>Engineer</th>
                <th style={{ ...cellStyle, fontWeight: "bold", backgroundColor: "#f5f5f5" }}>Van</th>
                <th style={{ ...cellStyle, fontWeight: "bold", backgroundColor: "#f5f5f5" }}>Tot en met</th>
                <th style={{ ...cellStyle, fontWeight: "bold", backgroundColor: "#f5f5f5" }}>Aantal dagen</th>
                <th style={{ ...cellStyle, fontWeight: "bold", backgroundColor: "#f5f5f5" }}>Reden</th>
                <th style={{ ...cellStyle, fontWeight: "bold", backgroundColor: "#f5f5f5" }}></th>
              </tr>
            </thead>
            <tbody>
              {groupedAbsences.map((a) => {
                const eng = engineers.find((e) => e.id === a.engineer_id);
                return (
                  <tr key={a.key}>
                    <td style={cellStyle}>{eng?.name || "Onbekend"}</td>
                    <td style={cellStyle}>{formatDate(a.start_date)}</td>
                    <td style={cellStyle}>{formatDate(a.end_date)}</td>
                    <td style={cellStyle}>{a.days}</td>
                    <td style={cellStyle}>{a.reason || "–"}</td>
                    <td style={cellStyle}>
                      <button
                        onClick={() => removeAbsence(a.group_id, a.ids)}
                        style={{ ...buttonStyle, backgroundColor: "#dc2626", fontSize: "11px", padding: "4px 10px", marginTop: 0 }}
                      >
                        Verwijderen
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p style={{ color: "#666", fontSize: "14px" }}>Geen afwezigheden gepland.</p>
        )}

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "end" }}>
          <div>
            <label style={labelStyle}>Engineer</label>
            <select
              style={inputStyle}
              value={absenceEngineerId}
              onChange={(e) => setAbsenceEngineerId(e.target.value)}
            >
              <option value="">-- Kies --</option>
              {engineers.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Van</label>
            <input
              type="date"
              style={inputStyle}
              value={absenceDate}
              onChange={(e) => setAbsenceDate(e.target.value)}
            />
          </div>
          <div>
            <label style={labelStyle}>Tot en met</label>
            <input
              type="date"
              style={inputStyle}
              value={absenceEndDate}
              onChange={(e) => setAbsenceEndDate(e.target.value)}
            />
          </div>
          <div>
            <label style={labelStyle}>Reden (optioneel)</label>
            <input
              type="text"
              style={inputStyle}
              value={absenceReason}
              onChange={(e) => setAbsenceReason(e.target.value)}
              placeholder="Bv. Ziek, Vakantie..."
            />
          </div>
          <button style={buttonStyle} onClick={addAbsence}>+ Absence toevoegen</button>
        </div>

        {saveStatus && <p style={{ marginTop: "8px" }}><strong>{saveStatus}</strong></p>}
      </section>
    </main>
  );
}