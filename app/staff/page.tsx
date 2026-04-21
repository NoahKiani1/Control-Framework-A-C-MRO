"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import {
  deleteEngineer,
  deleteEngineerAbsenceGroup,
  deleteEngineerAbsencesByIds,
  deleteEngineerPhoto,
  deletePastEngineerAbsences,
  getEngineerAbsences,
  getEngineerPhotoUrl,
  getEngineers,
  insertEngineer,
  updateEngineer,
  uploadEngineerPhoto,
  upsertEngineerAbsences,
} from "@/lib/engineers";
import { RESTRICTION_LABELS } from "@/lib/restrictions";

type StaffMember = {
  id: number;
  name: string;
  role: string | null;
  is_active: boolean;
  restrictions: string[] | null;
  photo_path: string | null;
};

type Absence = {
  id: number;
  engineer_id: number;
  absence_date: string;
  reason: string | null;
  absence_group_id: string | null;
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

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

export default function StaffPage() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [loading, setLoading] = useState(true);

  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<"shop" | "office">("shop");

  const [absenceEngineerId, setAbsenceEngineerId] = useState("");
  const [absenceDate, setAbsenceDate] = useState("");
  const [absenceEndDate, setAbsenceEndDate] = useState("");
  const [absenceReason, setAbsenceReason] = useState("");

  const [saveStatus, setSaveStatus] = useState("");

  async function loadData() {
    const today = new Date().toISOString().split("T")[0];
    await deletePastEngineerAbsences(today);

    const [staffData, absData] = await Promise.all([
      getEngineers<StaffMember>({
        select: "*",
        isActive: true,
        orderBy: [
          { column: "role", ascending: true },
          { column: "name", ascending: true },
        ],
      }),
      getEngineerAbsences<Absence>({
        select: "*",
        fromDate: today,
        orderBy: { column: "absence_date", ascending: true },
      }),
    ]);

    setStaff(staffData);
    setAbsences(absData);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
  }, []);

  async function addMember() {
    if (!newName.trim()) return;

    const trimmedName = newName.trim();

    const { error } = await insertEngineer({
      name: trimmedName,
      role: newRole,
      is_active: true,
      restrictions: [],
    });

    if (error) {
      setSaveStatus(`Error: ${error.message}`);
      return;
    }

    setSaveStatus(`✅ ${trimmedName} added as ${newRole}`);
    setNewName("");
    await loadData();
  }

  async function removeMember(member: StaffMember) {
    const confirmed = window.confirm(
      `Are you sure you want to permanently delete ${member.name}?\n\n` +
        `This will also delete all linked absences.\n` +
        `This action cannot be undone.`,
    );

    if (!confirmed) return;

    const { error } = await deleteEngineer(member.id);

    if (error) {
      setSaveStatus(`Error: ${error.message}`);
      return;
    }

    const { error: photoError } = await deleteEngineerPhoto(member.photo_path);

    if (photoError) {
      setSaveStatus(
        `${member.name} permanently deleted, but the photo could not be removed: ${photoError.message}`,
      );
      await loadData();
      return;
    }

    setSaveStatus(`✅ ${member.name} permanently deleted`);
    await loadData();
  }

  async function updateRole(id: number, role: string) {
    const { error } = await updateEngineer(id, { role });

    if (error) {
      setSaveStatus(`Error: ${error.message}`);
      return;
    }

    await loadData();
  }

  async function toggleRestriction(member: StaffMember, restriction: string) {
    const current = member.restrictions || [];
    const updated = current.includes(restriction)
      ? current.filter((r) => r !== restriction)
      : [...current, restriction];

    const { error } = await updateEngineer(member.id, { restrictions: updated });

    if (error) {
      setSaveStatus(`Error: ${error.message}`);
      return;
    }

    await loadData();
  }

  async function changePhoto(member: StaffMember, file: File | null) {
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setSaveStatus("Error: Please select an image file.");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setSaveStatus("Error: Photo must be 2 MB or smaller.");
      return;
    }

    const { error, cleanupError } = await uploadEngineerPhoto(
      member.id,
      file,
      member.photo_path,
    );

    if (error) {
      setSaveStatus(`Error: ${error.message}`);
      return;
    }

    if (cleanupError) {
      setSaveStatus(
        `Photo changed for ${member.name}, but the old photo could not be removed: ${cleanupError.message}`,
      );
      await loadData();
      return;
    }

    setSaveStatus(`${member.photo_path ? "Photo changed" : "Photo added"} for ${member.name}`);
    await loadData();
  }

  async function removePhoto(member: StaffMember) {
    if (!member.photo_path) return;

    const { error: updateError } = await updateEngineer(member.id, {
      photo_path: null,
    });

    if (updateError) {
      setSaveStatus(`Error: ${updateError.message}`);
      return;
    }

    const { error: photoError } = await deleteEngineerPhoto(member.photo_path);

    if (photoError) {
      setSaveStatus(
        `Photo removed from ${member.name}, but the file could not be deleted: ${photoError.message}`,
      );
      await loadData();
      return;
    }

    setSaveStatus(`Photo removed from ${member.name}`);
    await loadData();
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

    const rows = dates.map((date) => ({
      engineer_id: parseInt(absenceEngineerId, 10),
      absence_date: date,
      reason: absenceReason || null,
      absence_group_id: groupId,
    }));

    const { error } = await upsertEngineerAbsences(rows);

    if (error) {
      setSaveStatus(`Error: ${error.message}`);
      return;
    }

    setSaveStatus(`✅ ${dates.length} day(s) added`);
    setAbsenceDate("");
    setAbsenceEndDate("");
    setAbsenceReason("");
    await loadData();
  }

  async function removeAbsence(groupId: string | null, ids: number[]) {
    if (groupId) {
      await deleteEngineerAbsenceGroup(groupId);
    } else {
      await deleteEngineerAbsencesByIds(ids);
    }

    await loadData();
  }

  function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }

  if (loading) return <p style={{ padding: "2rem" }}>Loading...</p>;

  const shopStaff = staff.filter((s) => s.role === "shop");
  const officeStaff = staff.filter((s) => s.role === "office");
  const unassigned = staff.filter((s) => s.role !== "shop" && s.role !== "office");

  const shopEngineerIds = new Set(shopStaff.map((s) => s.id));

  const groupedAbsences: GroupedAbsence[] = Object.values(
    absences
      .filter((a) => shopEngineerIds.has(a.engineer_id))
      .reduce((acc, a) => {
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
      }, {} as Record<string, GroupedAbsence>),
  ).sort((a, b) => a.start_date.localeCompare(b.start_date));

  const threeWeekCutoff = (() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const week1Monday = getMondayOfWeek(today);
    const week3Friday = new Date(week1Monday);
    week3Friday.setDate(week3Friday.getDate() + 18);

    return week3Friday.toISOString().split("T")[0];
  })();

  const absencesThisWindow = groupedAbsences.filter((a) => a.start_date <= threeWeekCutoff);
  const absencesLater = groupedAbsences.filter((a) => a.start_date > threeWeekCutoff);

  const cellStyle: React.CSSProperties = {
    padding: "8px 12px",
    borderBottom: "1px solid #eee",
    fontSize: "14px",
    verticalAlign: "top",
    overflowWrap: "break-word",
    textAlign: "left",
  };

  const headerStyle: React.CSSProperties = {
    ...cellStyle,
    fontWeight: "bold",
    backgroundColor: "#f5f5f5",
    verticalAlign: "middle",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    marginTop: "10px",
    fontWeight: "bold",
    fontSize: "13px",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px",
    border: "1px solid #ccc",
    borderRadius: "4px",
    fontSize: "14px",
    marginTop: "4px",
  };

  const buttonStyle: React.CSSProperties = {
    padding: "8px 16px",
    backgroundColor: "#0070f3",
    color: "white",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    fontWeight: "bold",
    fontSize: "13px",
    marginTop: "8px",
  };

  const smallButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    fontSize: "11px",
    padding: "6px 10px",
    marginTop: 0,
    whiteSpace: "nowrap",
    lineHeight: 1,
    minWidth: "74px",
  };

  function renderTable(members: StaffMember[], roleLabel: string, roleColor: string) {
    const isShop = roleLabel.startsWith("Shop");

    return (
      <div style={{ marginTop: "1.5rem" }}>
        <h2 style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            style={{
              display: "inline-block",
              width: "10px",
              height: "10px",
              borderRadius: "50%",
              backgroundColor: roleColor,
            }}
          />
          {roleLabel} ({members.length})
        </h2>

        {members.length === 0 ? (
          <p style={{ color: "#666", fontSize: "14px" }}>
            No {roleLabel.toLowerCase()} members yet.
          </p>
        ) : (
          <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
            <colgroup>
              {isShop ? (
                <>
                  <col style={{ width: "20%" }} />
                  <col style={{ width: "12%" }} />
                  <col style={{ width: "32%" }} />
                  <col style={{ width: "24%" }} />
                  <col style={{ width: "12%" }} />
                </>
              ) : (
                <>
                  <col style={{ width: "24%" }} />
                  <col style={{ width: "18%" }} />
                  <col style={{ width: "38%" }} />
                  <col style={{ width: "20%" }} />
                </>
              )}
            </colgroup>
            <thead>
              <tr>
                <th style={headerStyle}>Name</th>
                <th style={headerStyle}>Role</th>
                <th style={headerStyle}>Photo</th>
                {isShop && <th style={headerStyle}>Restrictions</th>}
                <th style={headerStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id}>
                  <td style={cellStyle}>{member.name}</td>
                  <td style={cellStyle}>
                    <select
                      value={member.role || ""}
                      onChange={(e) => void updateRole(member.id, e.target.value)}
                      style={{
                        padding: "4px 8px",
                        border: "1px solid #ccc",
                        borderRadius: "4px",
                        fontSize: "13px",
                      }}
                    >
                      <option value="shop">Shop</option>
                      <option value="office">Office</option>
                    </select>
                  </td>
                  <td style={cellStyle}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        minHeight: "40px",
                      }}
                    >
                      {member.photo_path && (
                        <Image
                          src={getEngineerPhotoUrl(member.photo_path) || "/file.svg"}
                          alt={member.name}
                          width={32}
                          height={32}
                          unoptimized
                          style={{
                            width: "32px",
                            height: "32px",
                            borderRadius: "50%",
                            objectFit: "contain",
                          }}
                        />
                      )}
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <label
                          style={{
                            ...smallButtonStyle,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            backgroundColor: "#4b5563",
                          }}
                        >
                          {member.photo_path ? "Change photo" : "Add photo"}
                          <input
                            type="file"
                            accept="image/*"
                            style={{ display: "none" }}
                            onChange={(e) => {
                              const file = e.target.files?.[0] || null;
                              e.target.value = "";
                              void changePhoto(member, file);
                            }}
                          />
                        </label>
                        {member.photo_path && (
                          <button
                            onClick={() => void removePhoto(member)}
                            style={{
                              ...smallButtonStyle,
                              backgroundColor: "#6b7280",
                            }}
                          >
                            Remove photo
                          </button>
                        )}
                      </div>
                    </div>
                  </td>
                  {isShop && (
                    <td style={cellStyle}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {Object.entries(RESTRICTION_LABELS).map(([key, label]) => (
                          <label
                            key={key}
                            style={{
                              display: "flex",
                              alignItems: "flex-start",
                              gap: "6px",
                              fontSize: "12px",
                              cursor: "pointer",
                              lineHeight: 1.35,
                            }}
                          >
                            <input
                              type="checkbox"
                              style={{ marginTop: "2px", flexShrink: 0 }}
                              checked={(member.restrictions || []).includes(key)}
                              onChange={() => void toggleRestriction(member, key)}
                            />
                            <span>{label}</span>
                          </label>
                        ))}
                      </div>
                    </td>
                  )}
                  <td style={cellStyle}>
                    <button
                      onClick={() => void removeMember(member)}
                      style={{
                        ...smallButtonStyle,
                        backgroundColor: "#dc2626",
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }

  return (
    <main style={{ minHeight: "100vh", backgroundColor: "#f2efe9", padding: "32px 40px 40px", fontFamily: "sans-serif" }}>
      <div style={{ maxWidth: "960px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Staff Management</h1>
      </div>

      <p style={{ color: "#666", marginTop: "8px" }}>
        Manage your team members, restrictions, and shop engineer absences. Only shop staff are used in capacity calculations.
      </p>

      {renderTable(shopStaff, "Shop Engineers", "#059669")}
      {renderTable(officeStaff, "Office Staff", "#2563eb")}
      {unassigned.length > 0 && renderTable(unassigned, "No role assigned", "#9ca3af")}

      <section
        style={{
          marginTop: "2rem",
          borderTop: "2px solid #eee",
          paddingTop: "1.5rem",
        }}
      >
        <h2>Add team member</h2>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "end" }}>
          <div style={{ flex: "0 1 360px", minWidth: "240px" }}>
            <label style={labelStyle}>Name</label>
            <input
              type="text"
              style={inputStyle}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Name..."
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void addMember();
                }
              }}
            />
          </div>
          <div style={{ width: "140px" }}>
            <label style={labelStyle}>Role</label>
            <select
              style={inputStyle}
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as "shop" | "office")}
            >
              <option value="shop">Shop</option>
              <option value="office">Office</option>
            </select>
          </div>
          <button style={buttonStyle} onClick={() => void addMember()}>
            + Add
          </button>
        </div>
      </section>

      <section
        style={{
          marginTop: "2rem",
          borderTop: "2px solid #eee",
          paddingTop: "1.5rem",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px" }}>
          <div>
            <h2 style={{ margin: 0 }}>Shop Engineer Absences</h2>
            <p style={{ color: "#666", fontSize: "14px", margin: "6px 0 0" }}>
              Only shop engineer absences are managed here and used for capacity.
            </p>
          </div>

          {absencesLater.length > 0 && (
            <a href="#later-upcoming-absences" style={{ color: "#0070f3", fontSize: "13px" }}>
              View {absencesLater.length} later upcoming absence{absencesLater.length !== 1 ? "s" : ""} ↓
            </a>
          )}
        </div>

        {absencesThisWindow.length > 0 ? (
          <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed", marginTop: "12px", marginBottom: "12px" }}>
            <thead>
              <tr>
                <th style={headerStyle}>Engineer</th>
                <th style={headerStyle}>From</th>
                <th style={headerStyle}>Until (inclusive)</th>
                <th style={headerStyle}>Days</th>
                <th style={headerStyle}>Reason</th>
                <th style={headerStyle}></th>
              </tr>
            </thead>
            <tbody>
              {absencesThisWindow.map((absence) => {
                const engineer = shopStaff.find((s) => s.id === absence.engineer_id);

                return (
                  <tr key={absence.key}>
                    <td style={cellStyle}>{engineer?.name || "Unknown"}</td>
                    <td style={cellStyle}>{formatDate(absence.start_date)}</td>
                    <td style={cellStyle}>{formatDate(absence.end_date)}</td>
                    <td style={cellStyle}>{absence.days}</td>
                    <td style={cellStyle}>{absence.reason || "–"}</td>
                    <td style={cellStyle}>
                      <button
                        onClick={() => void removeAbsence(absence.group_id, absence.ids)}
                        style={{
                          ...buttonStyle,
                          backgroundColor: "#dc2626",
                          fontSize: "11px",
                          padding: "4px 10px",
                          marginTop: 0,
                        }}
                      >
                        Remove
                      </button>
                    </td>
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

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "end" }}>
          <div>
            <label style={labelStyle}>Engineer</label>
            <select
              style={inputStyle}
              value={absenceEngineerId}
              onChange={(e) => setAbsenceEngineerId(e.target.value)}
            >
              <option value="">-- Select --</option>
              {shopStaff.map((engineer) => (
                <option key={engineer.id} value={engineer.id}>
                  {engineer.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>From</label>
            <input
              type="date"
              style={inputStyle}
              value={absenceDate}
              onChange={(e) => {
                setAbsenceDate(e.target.value);
                if (!absenceEndDate || absenceEndDate < e.target.value) {
                  setAbsenceEndDate(e.target.value);
                }
              }}
            />
          </div>
          <div>
            <label style={labelStyle}>Until (inclusive)</label>
            <input
              type="date"
              style={inputStyle}
              value={absenceEndDate}
              min={absenceDate || undefined}
              onChange={(e) => setAbsenceEndDate(e.target.value)}
            />
          </div>
          <div style={{ flex: 1, minWidth: "220px" }}>
            <label style={labelStyle}>Reason (optional)</label>
            <input
              type="text"
              style={inputStyle}
              value={absenceReason}
              onChange={(e) => setAbsenceReason(e.target.value)}
              placeholder="E.g. Sick leave, Holiday..."
            />
          </div>
          <button style={buttonStyle} onClick={() => void addAbsence()}>
            + Add absence
          </button>
        </div>
      </section>

      {absencesLater.length > 0 && (
        <section
          id="later-upcoming-absences"
          style={{
            marginTop: "2rem",
            borderTop: "2px solid #eee",
            paddingTop: "1.5rem",
          }}
        >
          <h2 style={{ marginBottom: "6px" }}>Later Upcoming Absences</h2>
          <p style={{ color: "#666", fontSize: "14px", marginTop: 0 }}>
            These absences start after the current 3-week capacity window.
          </p>

          <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
            <thead>
              <tr>
                <th style={headerStyle}>Engineer</th>
                <th style={headerStyle}>From</th>
                <th style={headerStyle}>Until (inclusive)</th>
                <th style={headerStyle}>Days</th>
                <th style={headerStyle}>Reason</th>
                <th style={headerStyle}></th>
              </tr>
            </thead>
            <tbody>
              {absencesLater.map((absence) => {
                const engineer = shopStaff.find((s) => s.id === absence.engineer_id);

                return (
                  <tr key={absence.key}>
                    <td style={cellStyle}>{engineer?.name || "Unknown"}</td>
                    <td style={cellStyle}>{formatDate(absence.start_date)}</td>
                    <td style={cellStyle}>{formatDate(absence.end_date)}</td>
                    <td style={cellStyle}>{absence.days}</td>
                    <td style={cellStyle}>{absence.reason || "–"}</td>
                    <td style={cellStyle}>
                      <button
                        onClick={() => void removeAbsence(absence.group_id, absence.ids)}
                        style={{
                          ...buttonStyle,
                          backgroundColor: "#dc2626",
                          fontSize: "11px",
                          padding: "4px 10px",
                          marginTop: 0,
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {saveStatus && (
        <p style={{ marginTop: "12px" }}>
          <strong>{saveStatus}</strong>
        </p>
      )}
      </div>
    </main>
  );
}
