"use client";

export default function Home() {
  const pages = [
    { href: "/dashboard", label: "Office Dashboard", color: "#2563eb", desc: "Overzicht actieve work orders" },
    { href: "/planning", label: "Shared Planning", color: "#7c3aed", desc: "Gedeelde planningsview" },
    { href: "/shop", label: "Shop Wall Screen", color: "#059669", desc: "Read-only scherm voor de shop" },
    { href: "/actions", label: "Actions / Blockers", color: "#dc2626", desc: "Open acties en blokkades" },
    { href: "/backlog", label: "Backlog", color: "#6b7280", desc: "Niet-actieve open orders" },
    { href: "/capacity", label: "Capaciteitsmanagement", color: "#ea580c", desc: "Weekoverzicht en engineers" },
    { href: "/office-update", label: "Office Update", color: "#0891b2", desc: "Work orders bewerken en activeren" },
    { href: "/shop-update", label: "Shop Update", color: "#4f46e5", desc: "Processtap en blokkades melden" },
    { href: "/import", label: "AcMP Import", color: "#16a34a", desc: "Excel-export uploaden" },
  ];

  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif", maxWidth: "700px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "24px", marginBottom: "4px" }}>Aircraft and Component MRO Control Board</h1>
      <p style={{ color: "#666", marginBottom: "24px" }}>Bevat alle relevante informatie over de work orders binnen de shop</p>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {pages.map((p) => (
          <a key={p.href} href={p.href} style={{ display: "flex", alignItems: "center", gap: "16px", padding: "16px 20px", backgroundColor: "white", border: "1px solid #e0e0e0", borderRadius: "8px", textDecoration: "none", color: "#333" }}>
            <div style={{ width: "8px", height: "40px", borderRadius: "4px", backgroundColor: p.color, flexShrink: 0 }}></div>
            <div>
              <strong style={{ fontSize: "15px" }}>{p.label}</strong>
              <p style={{ margin: "2px 0 0", fontSize: "13px", color: "#888" }}>{p.desc}</p>
            </div>
          </a>
        ))}
      </div>
    </main>
  );
}
