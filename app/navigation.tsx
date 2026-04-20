"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/planning", label: "Shared Planning" },
  { href: "/shop", label: "Shop Wall Screen" },
  { href: "/backlog", label: "Backlog" },
  { href: "/capacity", label: "Capacity Management" },
  { href: "/office-update", label: "Office Update" },
  { href: "/shop-update", label: "Shop Update" },
  { href: "/import", label: "AcMP Import" },
  { href: "/staff", label: "Staff Management" },
];

export function Navigation() {
  const pathname = usePathname();

  if (pathname === "/shop") return null;

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
        aria-label="Dashboard home"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-start",
          padding: "0 0 0 2px",
          borderRadius: "8px",
          backgroundColor: "transparent",
          textDecoration: "none",
          marginBottom: "16px",
        }}
      >
        <Image
          src="/company-logo.png"
          alt="Aircraft & Component"
          width={1094}
          height={1094}
          priority
          style={{
            width: "100%",
            maxWidth: "76px",
            height: "auto",
            display: "block",
          }}
        />
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
