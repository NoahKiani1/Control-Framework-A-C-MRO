"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getEngineers, insertEngineer, updateEngineer } from "@/lib/engineers";
import { RESTRICTION_LABELS } from "@/lib/restrictions";

type StaffMember = {
  id: number;
  name: string;
  role: string | null;
  is_active: boolean;
  restrictions: string[] | null;
};

export default function StaffPage() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<"shop" | "office">("shop");
  const [saveStatus, setSaveStatus] = useState("");

  async function loadStaff() {
    const data = await getEngineers<StaffMember>({
      select: "*",
      isActive: true,
      orderBy: [
        { column: "role", ascending: true },
        { column: "name", ascending: true },
      ],
    });

    setStaff(data);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadStaff();
  }, []);

  async function addMember() {
    if (!newName.trim()) return;

    const { error } = await insertEngineer({
      name: newName.trim(),
      role: newRole,
    });

    if (error) {
      setSaveStatus(`Error: ${error.message}`);
      return;
    }

    setSaveStatus(`✅ ${newName.trim()} added as ${newRole}`);
    setNewName("");
    loadStaff();
  }

  async function removeMember(id: number, name: string) {
    const { error } = await updateEngineer(id, { is_active: false });

    if (error) {
      setSaveStatus(`Error: ${error.message}`);
      return;
    }

    setSaveStatus(`${name} removed`);
    loadStaff();
  }

  async function updateRole(id: number, role: string) {
    const { error } = await updateEngineer(id, { role });

    if (error) {
      setSaveStatus(`Error: ${error.message}`);
      return;
    }

    loadStaff();
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

    loadStaff();
  }

  if (loading) return <p style={{ padding: "2rem" }}>Loading...</p>;

  const shopStaff = staff.filter((s) => s.role === "shop");
  const officeStaff = staff.filter((s) => s.role === "office");
  const unassigned = staff.filter((s) => s.role !== "shop" && s.role !== "office");

  const cellStyle: React.CSSProperties = {
    padding: "8px 12px",
    borderBottom: "1px solid #eee",
    fontSize: "14px",
  };

  const headerStyle: React.CSSProperties = {
    ...cellStyle,
    fontWeight: "bold",
    backgroundColor: "#f5f5f5",
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
          <p style={{ color: "#666", fontSize: "14px" }}>No {roleLabel.toLowerCase()} members yet.</p>
        ) : (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={headerStyle}>Name</th>
                <th style={headerStyle}>Role</th>
                {isShop && <th style={headerStyle}>Restrictions</th>}
                <th style={headerStyle}></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td style={cellStyle}>{m.name}</td>
                  <td style={cellStyle}>
                    <select
                      value={m.role || ""}
                      onChange={(e) => updateRole(m.id, e.target.value)}
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
                  {isShop && (
                    <td style={cellStyle}>
                      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                        {Object.entries(RESTRICTION_LABELS).map(([key, label]) => (
                          <label
                            key={key}
                            style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", cursor: "pointer" }}
                          >
                            <input
                              type="checkbox"
                              checked={(m.restrictions || []).includes(key)}
                              onChange={() => toggleRestriction(m, key)}
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                    </td>
                  )}
                  <td style={cellStyle}>
                    <button
                      onClick={() => removeMember(m.id, m.name)}
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
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }

  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif", maxWidth: "700px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Staff Management</h1>
        <Link href="/">← Home</Link>
      </div>

      <p style={{ color: "#666", marginTop: "8px" }}>
        Manage your team members. Shop staff are used in capacity calculations, office staff are not.
      </p>

      {renderTable(shopStaff, "Shop (Engineers)", "#059669")}
      {renderTable(officeStaff, "Office", "#2563eb")}

      {unassigned.length > 0 && renderTable(unassigned, "No role assigned", "#9ca3af")}

      {/* Add new member */}
      <section
        style={{
          marginTop: "2rem",
          borderTop: "2px solid #eee",
          paddingTop: "1.5rem",
        }}
      >
        <h2>Add team member</h2>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "end" }}>
          <div style={{ flex: 1, minWidth: "200px" }}>
            <label style={labelStyle}>Name</label>
            <input
              type="text"
              style={inputStyle}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Name..."
              onKeyDown={(e) => e.key === "Enter" && addMember()}
            />
          </div>
          <div>
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
          <button style={buttonStyle} onClick={addMember}>
            + Add
          </button>
        </div>

        {saveStatus && (
          <p style={{ marginTop: "8px" }}>
            <strong>{saveStatus}</strong>
          </p>
        )}
      </section>
    </main>
  );
}
