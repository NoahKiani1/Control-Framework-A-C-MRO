"use client";

import Image from "next/image";
import { Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { RequireRole } from "@/app/components/require-role";
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
import {
  RESTRICTION_OPTIONS,
  getRestrictionLabels,
  normalizeRestrictionList,
} from "@/lib/restrictions";
import { PageHeader } from "@/app/components/page-header";

type StaffMember = {
  id: number;
  name: string;
  role: string | null;
  is_active: boolean;
  restrictions: string[] | null;
  photo_path: string | null;
  employment_start_date: string | null;
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

const ui = {
  pageBg: "#f2efe9",
  surface: "#ffffff",
  surfaceMuted: "#faf8f3",
  surfaceSoft: "#f4f1ea",
  border: "#e2ddd1",
  borderStrong: "#ccc4b4",
  text: "#1f2937",
  muted: "#5f6b7c",
  mutedSoft: "#8590a0",
  green: "#166534",
  greenSoft: "#eef9f1",
  greenBorder: "#cfe5d6",
  blue: "#2555c7",
  blueSoft: "#eef3ff",
  blueBorder: "#d7e3ff",
  red: "#b42318",
  redSoft: "#fff2ef",
  redBorder: "#efc6bf",
  inputBg: "#fffdf9",
  shadow: "0 1px 2px rgba(31, 41, 55, 0.04), 0 4px 12px rgba(31, 41, 55, 0.04)",
  radius: "14px",
};

const FONT_STACK =
  'var(--font-inter), var(--font-geist-sans), sans-serif';

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function StaffPageContent() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredStartDateId, setHoveredStartDateId] = useState<number | null>(null);
  const [restrictionEditorMemberId, setRestrictionEditorMemberId] = useState<number | null>(null);

  const [newName, setNewName] = useState("");
  const [newEmploymentStartDate, setNewEmploymentStartDate] = useState("");
  const [addingTo, setAddingTo] = useState<"shop" | "office" | null>(null);

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

  async function addMember(role: "shop" | "office") {
    if (!newName.trim()) return;

    const trimmedName = newName.trim();

    const { error } = await insertEngineer({
      name: trimmedName,
      role,
      is_active: true,
      restrictions: [],
      employment_start_date:
        role === "shop" && newEmploymentStartDate ? newEmploymentStartDate : null,
    });

    if (error) {
      setSaveStatus(`Error: ${error.message}`);
      return;
    }

    setSaveStatus(`${trimmedName} added as ${role}`);
    setNewName("");
    setNewEmploymentStartDate("");
    setAddingTo(null);
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

    setSaveStatus(`${member.name} permanently deleted`);
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
    const current = normalizeRestrictionList(member.restrictions);
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

    setSaveStatus(`${dates.length} day(s) added`);
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

  function isNotYetInService(member: StaffMember): boolean {
    if (member.role !== "shop" || !member.employment_start_date) return false;
    const today = new Date().toISOString().split("T")[0];
    return member.employment_start_date > today;
  }

  const pageStyle: React.CSSProperties = {
    minHeight: "100vh",
    backgroundColor: ui.pageBg,
    padding: "var(--layout-page-py) var(--layout-page-px) var(--layout-page-px)",
    fontFamily: FONT_STACK,
    color: ui.text,
  };

  if (loading) {
    return (
      <div style={{ ...pageStyle, color: ui.muted }}>Loading...</div>
    );
  }

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

  const shellStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: "var(--layout-content-max-w-narrow)",
    marginInline: "auto",
  };

  const sectionCard: React.CSSProperties = {
    backgroundColor: ui.surface,
    border: `1px solid ${ui.border}`,
    borderRadius: ui.radius,
    padding: "18px 20px",
    boxShadow: ui.shadow,
  };

  const innerCard: React.CSSProperties = {
    backgroundColor: ui.surfaceMuted,
    border: `1px solid ${ui.border}`,
    borderRadius: "12px",
    padding: "14px 16px",
  };

  const sectionHeaderRow: React.CSSProperties = {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "14px",
    flexWrap: "wrap",
  };

  const sectionContentStack: React.CSSProperties = {
    display: "grid",
    gap: "14px",
    marginTop: "14px",
  };

  const sectionHeaderActions: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap",
  };

  const sectionTitleStyle: React.CSSProperties = {
    margin: 0,
    fontSize: "17px",
    fontWeight: 650,
    color: ui.text,
    letterSpacing: "-0.015em",
  };

  const sectionDescriptionStyle: React.CSSProperties = {
    margin: "4px 0 0",
    fontSize: "13px",
    color: ui.muted,
    lineHeight: 1.5,
    maxWidth: "620px",
  };

  const eyebrowStyle: React.CSSProperties = {
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: ui.mutedSoft,
    marginBottom: "6px",
  };

  const innerLabelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: ui.mutedSoft,
    marginBottom: "6px",
  };

  const fieldLabelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "12px",
    fontWeight: 600,
    color: ui.muted,
    marginBottom: "6px",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "9px 12px",
    border: `1px solid ${ui.borderStrong}`,
    borderRadius: "10px",
    fontSize: "13.5px",
    boxSizing: "border-box",
    backgroundColor: ui.inputBg,
    color: ui.text,
    minHeight: "40px",
    outline: "none",
    fontFamily: "inherit",
  };

  const compactSelectStyle: React.CSSProperties = {
    padding: "6px 10px",
    border: `1px solid ${ui.border}`,
    borderRadius: "8px",
    fontSize: "12.5px",
    fontWeight: 600,
    backgroundColor: ui.surface,
    color: ui.text,
    cursor: "pointer",
    fontFamily: "inherit",
    minWidth: "96px",
  };

  const primaryBtn: React.CSSProperties = {
    padding: "10px 18px",
    backgroundColor: ui.blue,
    color: "white",
    border: `1px solid ${ui.blue}`,
    borderRadius: "10px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "13.5px",
    boxShadow: "0 6px 16px rgba(37, 85, 199, 0.18)",
    whiteSpace: "nowrap",
    fontFamily: "inherit",
  };

  const ghostBtn: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "6px 11px",
    backgroundColor: ui.surface,
    color: ui.muted,
    border: `1px solid ${ui.border}`,
    borderRadius: "8px",
    fontSize: "12px",
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
    lineHeight: 1.2,
    fontFamily: "inherit",
  };

  const inlineEditButtonStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "22px",
    height: "22px",
    borderRadius: "999px",
    border: `1px solid ${ui.border}`,
    backgroundColor: ui.surfaceSoft,
    color: ui.muted,
    cursor: "pointer",
    flexShrink: 0,
  };

  const dangerGhostBtn: React.CSSProperties = {
    ...ghostBtn,
    color: ui.red,
    backgroundColor: ui.redSoft,
    border: `1px solid ${ui.redBorder}`,
  };

  const addActionBtn: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "7px 12px",
    backgroundColor: ui.blueSoft,
    color: ui.blue,
    border: `1px solid ${ui.blueBorder}`,
    borderRadius: "999px",
    fontSize: "12.5px",
    fontWeight: 650,
    cursor: "pointer",
    whiteSpace: "nowrap",
    lineHeight: 1.2,
    fontFamily: "inherit",
  };

  const addActionBtnActive: React.CSSProperties = {
    ...addActionBtn,
    backgroundColor: ui.surfaceSoft,
    color: ui.muted,
    border: `1px solid ${ui.border}`,
  };

  const countBadgeStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    padding: "3px 10px",
    borderRadius: "999px",
    border: `1px solid ${ui.border}`,
    backgroundColor: ui.surfaceSoft,
    color: ui.muted,
    fontSize: "12px",
    fontWeight: 650,
    lineHeight: 1.2,
    whiteSpace: "nowrap",
  };

  const tableWrapStyle: React.CSSProperties = {
    marginTop: "14px",
    borderRadius: "10px",
    border: `1px solid ${ui.border}`,
    backgroundColor: ui.surface,
    overflow: "visible",
  };

  const tableBaseStyle: React.CSSProperties = {
    borderCollapse: "separate",
    borderSpacing: 0,
    width: "100%",
    tableLayout: "fixed",
  };

  const thStyle: React.CSSProperties = {
    padding: "10px 14px",
    fontSize: "11.5px",
    fontWeight: 650,
    color: ui.muted,
    backgroundColor: ui.surfaceSoft,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    textAlign: "left",
    borderBottom: `1px solid ${ui.border}`,
  };

  const tdStyle: React.CSSProperties = {
    padding: "12px 14px",
    fontSize: "13px",
    color: ui.text,
    borderBottom: `1px solid ${ui.border}`,
    verticalAlign: "middle",
    overflowWrap: "break-word",
  };

  const emptyStateStyle: React.CSSProperties = {
    marginTop: "14px",
    padding: "14px 16px",
    borderRadius: "10px",
    border: `1px dashed ${ui.border}`,
    backgroundColor: ui.surfaceMuted,
    color: ui.muted,
    fontSize: "13px",
  };

  function renderPhotoControls(member: StaffMember) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          minHeight: "36px",
        }}
      >
        {member.photo_path ? (
          <Image
            src={getEngineerPhotoUrl(member.photo_path) || "/file.svg"}
            alt={member.name}
            width={36}
            height={36}
            unoptimized
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "50%",
              objectFit: "cover",
              border: `1px solid ${ui.border}`,
              flexShrink: 0,
            }}
          />
        ) : (
          <div
            aria-hidden
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "50%",
              border: `1px dashed ${ui.border}`,
              backgroundColor: ui.surfaceSoft,
              flexShrink: 0,
            }}
          />
        )}
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          <label style={ghostBtn}>
            {member.photo_path ? "Change" : "Add photo"}
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
              type="button"
              onClick={() => void removePhoto(member)}
              style={ghostBtn}
            >
              Remove
            </button>
          )}
        </div>
      </div>
    );
  }

  function renderRoleSelect(
    member: StaffMember,
    options?: { allowUnassigned?: boolean },
  ) {
    return (
      <select
        value={member.role || ""}
        onChange={(e) => void updateRole(member.id, e.target.value)}
        style={compactSelectStyle}
        aria-label={`Role for ${member.name}`}
      >
        {options?.allowUnassigned && (
          <option value="">No role</option>
        )}
        <option value="shop">Shop</option>
        <option value="office">Office</option>
      </select>
    );
  }

  function renderRestrictionsControls(member: StaffMember) {
    const labels = getRestrictionLabels(member.restrictions);

    return (
      <div
        style={{
          display: "inline-flex",
          alignItems: "flex-start",
          gap: "8px",
          maxWidth: "100%",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            minWidth: 0,
            maxWidth: "calc(100% - 30px)",
          }}
        >
          {labels.length > 0 ? (
            labels.map((label) => (
              <span
                key={label}
                style={{ fontSize: "12.5px", color: ui.text, lineHeight: 1.4 }}
              >
                {label}
              </span>
            ))
          ) : (
            <span style={{ fontSize: "12.5px", color: ui.mutedSoft, lineHeight: 1.4 }}>
              No restrictions
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setRestrictionEditorMemberId(member.id)}
          style={inlineEditButtonStyle}
          aria-label={`Edit restrictions for ${member.name}`}
        >
          <Pencil size={12} strokeWidth={2} />
        </button>
      </div>
    );
  }

  function renderStaffManagementTable(
    members: StaffMember[],
    options: {
      emptyLabel: string;
      emptyHint: React.ReactNode;
      showRestrictions?: boolean;
      allowUnassignedRole?: boolean;
    },
  ) {
    if (members.length === 0) {
      return (
        <div style={emptyStateStyle}>
          No {options.emptyLabel} yet. {options.emptyHint}
        </div>
      );
    }

    return (
      <div style={tableWrapStyle}>
        <table style={tableBaseStyle}>
          <colgroup>
            <col style={{ width: "22%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "26%" }} />
            <col style={{ width: "28%" }} />
            <col style={{ width: "12%" }} />
          </colgroup>
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Role</th>
              <th style={thStyle}>Photo</th>
              <th style={thStyle}>
                {options.showRestrictions ? "Restrictions" : ""}
              </th>
              <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member, idx) => {
              const isLast = idx === members.length - 1;
              const rowCellStyle: React.CSSProperties = {
                ...tdStyle,
                borderBottom: isLast ? "none" : tdStyle.borderBottom,
              };

              return (
                <tr key={member.id}>
                  <td
                    style={{
                      ...rowCellStyle,
                      fontWeight: 600,
                      position: "relative",
                      overflow: "visible",
                      zIndex: 2,
                    }}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "8px",
                        flexWrap: "wrap",
                      }}
                    >
                      <span>{member.name}</span>
                      {isNotYetInService(member) && (
                        <span
                          style={{
                            position: "relative",
                            display: "inline-flex",
                            alignItems: "center",
                            flexShrink: 0,
                          }}
                        >
                          <button
                            type="button"
                            aria-label={`In service from ${formatDate(member.employment_start_date!)}`}
                            aria-describedby={`staff-startdate-tooltip-${member.id}`}
                            onMouseEnter={() => setHoveredStartDateId(member.id)}
                            onMouseLeave={() => setHoveredStartDateId((current) => (
                              current === member.id ? null : current
                            ))}
                            onFocus={() => setHoveredStartDateId(member.id)}
                            onBlur={() => setHoveredStartDateId((current) => (
                              current === member.id ? null : current
                            ))}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              width: "18px",
                              height: "18px",
                              borderRadius: "999px",
                              border: "1px solid #ead1a6",
                              backgroundColor: "#fff6e8",
                              color: "#b45309",
                              fontSize: "11px",
                              fontWeight: 800,
                              lineHeight: 1,
                              cursor: "help",
                              boxShadow: "0 2px 8px rgba(180, 83, 9, 0.12)",
                              padding: 0,
                              appearance: "none",
                              WebkitAppearance: "none",
                            }}
                          >
                            !
                          </button>
                          <span
                            id={`staff-startdate-tooltip-${member.id}`}
                            role="tooltip"
                            style={{
                              position: "absolute",
                              top: "calc(100% + 8px)",
                              left: "0",
                              display: "grid",
                              gap: "4px",
                              minWidth: "180px",
                              padding: "10px 12px",
                              borderRadius: "12px",
                              border: "1px solid #f3d19c",
                              background:
                                "linear-gradient(180deg, #fffdf7 0%, #fff6e8 100%)",
                              boxShadow:
                                "0 14px 32px rgba(31, 41, 55, 0.14), 0 2px 8px rgba(180, 83, 9, 0.08)",
                              pointerEvents: "none",
                              opacity: hoveredStartDateId === member.id ? 1 : 0,
                              visibility:
                                hoveredStartDateId === member.id ? "visible" : "hidden",
                              transition: "none",
                              zIndex: 10,
                            }}
                          >
                            <span
                              aria-hidden="true"
                              style={{
                                position: "absolute",
                                top: "-6px",
                                left: "12px",
                                width: "12px",
                                height: "12px",
                                transform: "rotate(45deg)",
                                backgroundColor: "#fffbf3",
                                borderLeft: "1px solid #f3d19c",
                                borderTop: "1px solid #f3d19c",
                              }}
                            />
                            <span
                              style={{
                                fontSize: "10px",
                                fontWeight: 700,
                                letterSpacing: "0.08em",
                                textTransform: "uppercase",
                                color: "#b45309",
                                lineHeight: 1.2,
                              }}
                            >
                              In service from
                            </span>
                            <span
                              style={{
                                fontSize: "12px",
                                fontWeight: 700,
                                color: ui.text,
                                lineHeight: 1.3,
                              }}
                            >
                              {formatDate(member.employment_start_date!)}
                            </span>
                          </span>
                        </span>
                      )}
                    </span>
                  </td>
                  <td style={rowCellStyle}>
                    {renderRoleSelect(member, {
                      allowUnassigned: options.allowUnassignedRole,
                    })}
                  </td>
                  <td style={rowCellStyle}>{renderPhotoControls(member)}</td>
                  <td style={rowCellStyle}>
                    {options.showRestrictions ? renderRestrictionsControls(member) : null}
                  </td>
                  <td style={{ ...rowCellStyle, textAlign: "right" }}>
                    <button
                      type="button"
                      onClick={() => void removeMember(member)}
                      style={dangerGhostBtn}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  function renderInlineAddForm(role: "shop" | "office") {
    if (addingTo !== role) return null;

    const labels =
      role === "shop"
        ? { title: "New shop engineer", placeholder: "Engineer name", cta: "Add engineer" }
        : { title: "New office member", placeholder: "Team member name", cta: "Add team member" };

    return (
      <div
        style={{
          paddingTop: "12px",
          borderTop: `1px solid ${ui.border}`,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              role === "shop"
                ? "minmax(220px, 1fr) minmax(180px, 220px) auto auto"
                : "minmax(220px, 1fr) auto auto",
            gap: "10px",
            alignItems: "end",
          }}
        >
          <div>
            <label style={fieldLabelStyle}>Name</label>
            <input
              type="text"
              autoFocus
              style={inputStyle}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={labels.placeholder}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void addMember(role);
                } else if (e.key === "Escape") {
                  setNewName("");
                  setNewEmploymentStartDate("");
                  setAddingTo(null);
                }
              }}
            />
          </div>
          {role === "shop" && (
            <div>
              <label style={fieldLabelStyle}>In service from</label>
              <input
                type="date"
                style={inputStyle}
                value={newEmploymentStartDate}
                onChange={(e) => setNewEmploymentStartDate(e.target.value)}
              />
            </div>
          )}
          <button
            type="button"
            style={primaryBtn}
            onClick={() => void addMember(role)}
          >
            {labels.cta}
          </button>
          <button
            type="button"
            style={ghostBtn}
            onClick={() => {
              setNewName("");
              setNewEmploymentStartDate("");
              setAddingTo(null);
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  function renderStaffSection(options: {
    role: "shop" | "office";
    title: string;
    description: React.ReactNode;
    countLabel: string;
    addLabel: string;
    emptyLabel: string;
    emptyHint: React.ReactNode;
    showRestrictions?: boolean;
  }) {
    return (
      <section style={sectionCard}>
        <div style={sectionHeaderRow}>
          <div style={{ minWidth: 0 }}>
            <div style={eyebrowStyle}>Team</div>
            <h2 style={sectionTitleStyle}>{options.title}</h2>
            <p style={sectionDescriptionStyle}>{options.description}</p>
          </div>
          <div style={sectionHeaderActions}>
            <span style={countBadgeStyle}>{options.countLabel}</span>
            <button
              type="button"
              style={addingTo === options.role ? addActionBtnActive : addActionBtn}
              onClick={() => handleToggleAdd(options.role)}
              aria-expanded={addingTo === options.role}
            >
              {addingTo === options.role ? "Close" : options.addLabel}
            </button>
          </div>
        </div>
        <div style={sectionContentStack}>
          {renderInlineAddForm(options.role)}
          {renderStaffManagementTable(
            options.role === "shop" ? shopStaff : officeStaff,
            {
              emptyLabel: options.emptyLabel,
              emptyHint: options.emptyHint,
              showRestrictions: options.showRestrictions,
            },
          )}
        </div>
      </section>
    );
  }

  function handleToggleAdd(role: "shop" | "office") {
    if (addingTo === role) {
      setAddingTo(null);
      setNewName("");
      setNewEmploymentStartDate("");
    } else {
      setAddingTo(role);
      setNewName("");
      setNewEmploymentStartDate("");
    }
  }

  function renderAbsenceTable(list: GroupedAbsence[]) {
    return (
      <div style={{ ...tableWrapStyle, marginTop: "12px" }}>
        <table style={tableBaseStyle}>
          <colgroup>
            <col style={{ width: "22%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "17%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "25%" }} />
            <col style={{ width: "12%" }} />
          </colgroup>
          <thead>
            <tr>
              <th style={thStyle}>Engineer</th>
              <th style={thStyle}>From</th>
              <th style={thStyle}>Until (incl.)</th>
              <th style={thStyle}>Days</th>
              <th style={thStyle}>Reason</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.map((absence, idx) => {
              const isLast = idx === list.length - 1;
              const engineer = shopStaff.find((s) => s.id === absence.engineer_id);
              const rowCellStyle: React.CSSProperties = {
                ...tdStyle,
                borderBottom: isLast ? "none" : tdStyle.borderBottom,
              };

              return (
                <tr key={absence.key}>
                  <td style={{ ...rowCellStyle, fontWeight: 600 }}>
                    {engineer?.name || "Unknown"}
                  </td>
                  <td style={rowCellStyle}>{formatDate(absence.start_date)}</td>
                  <td style={rowCellStyle}>{formatDate(absence.end_date)}</td>
                  <td style={rowCellStyle}>{absence.days}</td>
                  <td style={{ ...rowCellStyle, color: absence.reason ? ui.text : ui.mutedSoft }}>
                    {absence.reason || "–"}
                  </td>
                  <td style={{ ...rowCellStyle, textAlign: "right" }}>
                    <button
                      type="button"
                      onClick={() => void removeAbsence(absence.group_id, absence.ids)}
                      style={dangerGhostBtn}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  const restrictionEditorMember =
    restrictionEditorMemberId === null
      ? null
      : staff.find((member) => member.id === restrictionEditorMemberId) || null;

  function renderRestrictionEditor() {
    if (!restrictionEditorMember) return null;

    const activeRestrictions = new Set(
      normalizeRestrictionList(restrictionEditorMember.restrictions),
    );

    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(31, 41, 55, 0.28)",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          zIndex: 60,
        }}
        onMouseDown={() => setRestrictionEditorMemberId(null)}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "520px",
            backgroundColor: "#fcfaf6",
            border: `1px solid ${ui.borderStrong}`,
            borderRadius: "18px",
            boxShadow: "0 20px 50px rgba(31, 41, 55, 0.18)",
            padding: "18px",
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div style={{ marginBottom: "14px" }}>
            <div style={eyebrowStyle}>Restrictions</div>
            <h2 style={{ ...sectionTitleStyle, fontSize: "22px", marginBottom: "4px" }}>
              {restrictionEditorMember.name}
            </h2>
            <p style={{ ...sectionDescriptionStyle, margin: 0, maxWidth: "100%" }}>
              Select every process step this engineer cannot perform.
            </p>
          </div>

          <div
            style={{
              ...innerCard,
              display: "grid",
              gap: "8px",
              maxHeight: "55vh",
              overflowY: "auto",
            }}
          >
            {RESTRICTION_OPTIONS.map(({ key, label }) => {
              const checked = activeRestrictions.has(key);

              return (
                <label
                  key={key}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "8px",
                    fontSize: "13px",
                    color: checked ? ui.text : ui.muted,
                    cursor: "pointer",
                    lineHeight: 1.45,
                  }}
                >
                  <input
                    type="checkbox"
                    style={{ marginTop: "2px", flexShrink: 0, accentColor: ui.blue }}
                    checked={checked}
                    onChange={() => void toggleRestriction(restrictionEditorMember, key)}
                  />
                  <span>{label}</span>
                </label>
              );
            })}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "14px" }}>
            <button
              type="button"
              onClick={() => setRestrictionEditorMemberId(null)}
              style={ghostBtn}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <main style={pageStyle}>
      <div style={shellStyle}>
        <PageHeader
          title="Staff Management"
          description="Manage your team members, restrictions, and shop engineer absences. Only shop staff are used in capacity calculations."
        />

        <div style={{ display: "grid", gap: "16px" }}>
          {renderStaffSection({
            role: "shop",
            title: "Shop Engineers",
            description:
              "Engineers used in capacity calculations. Set per-engineer restrictions so unsuitable work is not assigned.",
            countLabel: `${shopStaff.length} ${shopStaff.length === 1 ? "engineer" : "engineers"}`,
            addLabel: "+ Add engineer",
            emptyLabel: "shop engineers",
            emptyHint: (
              <>
                Use <strong style={{ color: ui.text }}>+ Add engineer</strong> above to create one.
              </>
            ),
            showRestrictions: true,
          })}

          {renderStaffSection({
            role: "office",
            title: "Office Staff",
            description: "Office team members. Not used in capacity calculations.",
            countLabel: `${officeStaff.length} ${officeStaff.length === 1 ? "member" : "members"}`,
            addLabel: "+ Add office member",
            emptyLabel: "office staff",
            emptyHint: (
              <>
                Use <strong style={{ color: ui.text }}>+ Add office member</strong> above to create one.
              </>
            ),
          })}

          {/* UNASSIGNED */}
          {unassigned.length > 0 && (
            <section style={sectionCard}>
              <div style={sectionHeaderRow}>
                <div style={{ minWidth: 0 }}>
                  <div style={eyebrowStyle}>Needs attention</div>
                  <h2 style={sectionTitleStyle}>No role assigned</h2>
                  <p style={sectionDescriptionStyle}>
                    Assign each of these people a role so they can be used correctly across the app.
                  </p>
                </div>
                <span style={countBadgeStyle}>{unassigned.length}</span>
              </div>
              {renderStaffManagementTable(unassigned, {
                emptyLabel: "unassigned members",
                emptyHint: null,
                allowUnassignedRole: true,
              })}
            </section>
          )}

          {/* SHOP ENGINEER ABSENCES */}
          <section style={sectionCard}>
            <div style={sectionHeaderRow}>
              <div style={{ minWidth: 0 }}>
                <div style={eyebrowStyle}>Capacity</div>
                <h2 style={sectionTitleStyle}>Shop Engineer Absences</h2>
                <p style={sectionDescriptionStyle}>
                  Only shop engineer absences are managed here. These reduce available hours in capacity calculations.
                </p>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <span style={countBadgeStyle}>
                  {absencesThisWindow.length} in next 3 weeks
                </span>
                {absencesLater.length > 0 && (
                  <a
                    href="#later-upcoming-absences"
                    style={{
                      color: ui.blue,
                      fontSize: "12.5px",
                      fontWeight: 600,
                      textDecoration: "none",
                    }}
                  >
                    View {absencesLater.length} later ↓
                  </a>
                )}
              </div>
            </div>

            <div style={{ display: "grid", gap: "14px", marginTop: "14px" }}>
              {/* Recorded absences */}
              <div style={innerCard}>
                <label style={innerLabelStyle}>Next 3 weeks</label>
                {absencesThisWindow.length > 0 ? (
                  renderAbsenceTable(absencesThisWindow)
                ) : (
                  <div
                    style={{
                      marginTop: "6px",
                      padding: "12px 14px",
                      borderRadius: "10px",
                      border: `1px dashed ${ui.border}`,
                      backgroundColor: ui.surface,
                      color: ui.muted,
                      fontSize: "13px",
                    }}
                  >
                    No shop engineer absences planned in the next 3 weeks.
                  </div>
                )}
              </div>

              {/* Add absence form */}
              <div style={innerCard}>
                <label style={innerLabelStyle}>Record an absence</label>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(180px, 1.2fr) minmax(140px, 1fr) minmax(140px, 1fr) minmax(200px, 1.5fr) auto",
                    gap: "12px",
                    alignItems: "end",
                  }}
                >
                  <div>
                    <label style={fieldLabelStyle}>Engineer</label>
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
                    <label style={fieldLabelStyle}>From</label>
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
                    <label style={fieldLabelStyle}>Until (inclusive)</label>
                    <input
                      type="date"
                      style={inputStyle}
                      value={absenceEndDate}
                      min={absenceDate || undefined}
                      onChange={(e) => setAbsenceEndDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={fieldLabelStyle}>Reason (optional)</label>
                    <input
                      type="text"
                      style={inputStyle}
                      value={absenceReason}
                      onChange={(e) => setAbsenceReason(e.target.value)}
                      placeholder="E.g. Sick leave, Holiday..."
                    />
                  </div>
                  <button
                    type="button"
                    style={primaryBtn}
                    onClick={() => void addAbsence()}
                  >
                    Add absence
                  </button>
                </div>
              </div>

              {/* Later upcoming absences */}
              {absencesLater.length > 0 && (
                <div id="later-upcoming-absences" style={innerCard}>
                  <div style={sectionHeaderRow}>
                    <div style={{ minWidth: 0 }}>
                      <label style={innerLabelStyle}>Later upcoming absences</label>
                      <p
                        style={{
                          margin: "0",
                          fontSize: "12.5px",
                          color: ui.muted,
                          lineHeight: 1.5,
                        }}
                      >
                        These absences start after the current 3-week capacity window.
                      </p>
                    </div>
                    <span style={countBadgeStyle}>{absencesLater.length}</span>
                  </div>
                  {renderAbsenceTable(absencesLater)}
                </div>
              )}
            </div>
          </section>
        </div>

        {saveStatus && (
          <div
            role="status"
            style={{
              position: "fixed",
              bottom: "20px",
              right: "20px",
              padding: "10px 14px",
              backgroundColor: ui.surface,
              color: ui.text,
              border: `1px solid ${ui.border}`,
              borderRadius: "10px",
              boxShadow: "0 14px 30px rgba(31, 41, 55, 0.12)",
              fontSize: "13px",
              fontWeight: 600,
              maxWidth: "360px",
              zIndex: 30,
            }}
          >
            {saveStatus}
          </div>
        )}

        {renderRestrictionEditor()}
      </div>
    </main>
  );
}

export default function StaffPage() {
  return (
    <RequireRole allowedRoles={["office"]}>
      <StaffPageContent />
    </RequireRole>
  );
}
