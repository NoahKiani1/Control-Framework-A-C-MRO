"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppRole, getCurrentProfile } from "@/lib/auth";
import { hasUncleanedYearEndReport } from "@/lib/work-order-data";

const HIDDEN_PATHS = new Set([
  "/login",
  "/shop",
  "/shop-form",
  "/work-order-data",
]);

const POLL_INTERVAL_MS = 30_000;

function shouldHideForPath(pathname: string | null): boolean {
  if (!pathname) return true;
  return HIDDEN_PATHS.has(pathname);
}

type YearEndReportGateProps = {
  onRequirementChange?: (required: boolean) => void;
};

export function YearEndReportGate({
  onRequirementChange,
}: YearEndReportGateProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [role, setRole] = useState<AppRole | null>(null);
  const [required, setRequired] = useState(false);

  const hiddenForPath = shouldHideForPath(pathname);
  const now = new Date();
  const isDecember = now.getMonth() === 11;
  const currentYear = now.getFullYear();

  useEffect(() => {
    let active = true;

    async function loadRole() {
      const hiddenForAuthPath =
        pathname === "/login" || pathname === "/shop" || pathname === "/shop-form";
      if (hiddenForAuthPath) {
        if (active) setRole(null);
        return;
      }

      const { profile } = await getCurrentProfile();
      if (active) setRole(profile?.role ?? null);
    }

    void loadRole();
    return () => {
      active = false;
    };
  }, [pathname]);

  useEffect(() => {
    if (role !== "office" || !isDecember) {
      queueMicrotask(() => {
        setRequired(false);
        onRequirementChange?.(false);
      });
      return;
    }

    let active = true;

    async function refresh() {
      const nextRequired = await hasUncleanedYearEndReport(currentYear);
      if (active) {
        setRequired(nextRequired);
        onRequirementChange?.(nextRequired);
      }
    }

    void refresh();
    const id = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [role, isDecember, currentYear, onRequirementChange]);

  if (hiddenForPath || role !== "office" || !isDecember || !required) {
    return null;
  }

  const overlayStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(32, 28, 24, 0.72)",
    zIndex: 110,
    display: "grid",
    placeItems: "center",
    padding: "24px",
    fontFamily: "var(--font-inter), var(--font-geist-sans), sans-serif",
  };

  const cardStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: "460px",
    backgroundColor: "#fffefb",
    border: "1px solid #e2ddd1",
    borderRadius: "14px",
    padding: "22px 24px",
    boxShadow:
      "0 1px 2px rgba(31, 41, 55, 0.08), 0 20px 40px rgba(31, 41, 55, 0.18)",
    color: "#1f2937",
  };

  const badgeStyle: React.CSSProperties = {
    display: "inline-block",
    fontSize: "var(--fs-meta)",
    fontWeight: 700,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "#166534",
    backgroundColor: "#eef9f1",
    border: "1px solid #cdeedc",
    padding: "3px 8px",
    borderRadius: "999px",
    marginBottom: "10px",
  };

  const titleStyle: React.CSSProperties = {
    margin: 0,
    fontSize: "20px",
    fontWeight: 700,
    lineHeight: 1.2,
  };

  const bodyStyle: React.CSSProperties = {
    margin: "8px 0 18px",
    fontSize: "var(--fs-md)",
    lineHeight: 1.5,
    color: "#5f6b7c",
  };

  const buttonStyle: React.CSSProperties = {
    padding: "9px 16px",
    backgroundColor: "#2563eb",
    color: "white",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "var(--fs-body)",
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="work-order-data-gate-title"
      style={overlayStyle}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div style={cardStyle}>
        <span style={badgeStyle}>Work Order Data</span>
        <h2 id="work-order-data-gate-title" style={titleStyle}>
          {"Download this year's Work Order Data"}
        </h2>
        <p style={bodyStyle}>
          Work Order Data has been collected for this year. Download the report
          and clean the exported data to keep the database size low. You must
          complete this export-and-clean process before continuing.
        </p>
        <button
          type="button"
          style={buttonStyle}
          onClick={() => router.push("/work-order-data")}
        >
          Go to Work Order Data
        </button>
      </div>
    </div>
  );
}
