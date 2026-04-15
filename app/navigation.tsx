"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/planning", label: "Shared Planning" },
  { href: "/shop", label: "Shop Wall Screen" },
  { href: "/actions", label: "Actions / Blockers" },
  { href: "/backlog", label: "Backlog" },
  { href: "/capacity", label: "Capacity Management" },
  { href: "/office-update", label: "Office Update" },
  { href: "/shop-update", label: "Shop Update" },
  { href: "/import", label: "AcMP Import" },
  { href: "/staff", label: "Staff Management" },
];

export function Navigation() {
  const pathname = usePathname();

  return (
    <aside
      style={{
        width: "230px",
        minHeight: "100vh",
        backgroundColor: "#111827",
        color: "white",
        padding: "16px",
        position: "sticky",
        top: 0,
        alignSelf: "flex-start",
        flexShrink: 0,
      }}
    >
      <Link
        href="/dashboard"
        style={{
          display: "block",
          padding: "10px 12px",
          borderRadius: "8px",
          backgroundColor: "#2563eb",
          color: "white",
          textDecoration: "none",
          fontWeight: 700,
          fontSize: "14px",
          marginBottom: "18px",
        }}
      >
        ⌂ Home
      </Link>

      <nav style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        {navItems.map((item) => {
          const active = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: "block",
                padding: "9px 10px",
                borderRadius: "6px",
                color: active ? "white" : "#d1d5db",
                backgroundColor: active ? "#374151" : "transparent",
                textDecoration: "none",
                fontSize: "13px",
                fontWeight: active ? 700 : 500,
              }}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
