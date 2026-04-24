"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppRole, getCurrentProfile } from "@/lib/auth";
import {
  PendingAcmpReviewSummary,
  getPendingAcmpReviewSummary,
} from "@/lib/acmp-import/pending";

const HIDDEN_PATHS = new Set([
  "/login",
  "/shop",
  "/shop-form",
  "/acmp-review",
]);

const POLL_INTERVAL_MS = 30_000;

function shouldHideForPath(pathname: string | null): boolean {
  if (!pathname) return true;
  return HIDDEN_PATHS.has(pathname);
}

function buildGateMessage(summary: PendingAcmpReviewSummary): {
  title: string;
  body: string;
} {
  const { newWorkOrders, rfqApprovedInactive } = summary;
  const parts: string[] = [];
  if (newWorkOrders > 0) {
    parts.push(
      `${newWorkOrders} new AcMP work order${
        newWorkOrders === 1 ? "" : "s"
      }`,
    );
  }
  if (rfqApprovedInactive > 0) {
    parts.push(
      `${rfqApprovedInactive} RFQ-approved inactive work order${
        rfqApprovedInactive === 1 ? "" : "s"
      }`,
    );
  }

  const joined =
    parts.length > 1 ? `${parts[0]} and ${parts[1]}` : parts[0] || "";

  return {
    title: `${joined} require${summary.total === 1 ? "s" : ""} review`,
    body:
      "These items were detected during the last AcMP import. Review and configure them before continuing with the rest of the Office app.",
  };
}

export function AcmpPendingGate() {
  const pathname = usePathname();
  const router = useRouter();
  const [role, setRole] = useState<AppRole | null>(null);
  const [summary, setSummary] = useState<PendingAcmpReviewSummary>({
    total: 0,
    newWorkOrders: 0,
    rfqApprovedInactive: 0,
  });

  const hiddenForPath = shouldHideForPath(pathname);

  useEffect(() => {
    let active = true;

    async function loadRole() {
      if (hiddenForPath) {
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
  }, [hiddenForPath, pathname]);

  useEffect(() => {
    if (role !== "office" || hiddenForPath) {
      return;
    }

    let active = true;

    async function refresh() {
      const next = await getPendingAcmpReviewSummary();
      if (active) setSummary(next);
    }

    void refresh();
    const id = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [role, hiddenForPath]);

  if (hiddenForPath || role !== "office" || summary.total <= 0) {
    return null;
  }

  const { title, body } = buildGateMessage(summary);

  const overlayStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(32, 28, 24, 0.72)",
    zIndex: 100,
    display: "grid",
    placeItems: "center",
    padding: "24px",
    fontFamily: "var(--font-inter), var(--font-geist-sans), sans-serif",
  };

  const cardStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: "440px",
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
    color: "#b45309",
    backgroundColor: "#fff6e8",
    border: "1px solid #f1d8a8",
    padding: "3px 8px",
    borderRadius: "999px",
    marginBottom: "10px",
  };

  const titleStyle: React.CSSProperties = {
    margin: 0,
    fontSize: "20px",
    fontWeight: 700,
    letterSpacing: "-0.01em",
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
      aria-labelledby="acmp-pending-gate-title"
      style={overlayStyle}
      onKeyDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div style={cardStyle}>
        <span style={badgeStyle}>AcMP Review</span>
        <h2 id="acmp-pending-gate-title" style={titleStyle}>
          {title}
        </h2>
        <p style={bodyStyle}>{body}</p>
        <button
          type="button"
          style={buttonStyle}
          onClick={() => router.push("/acmp-review")}
        >
          Go to AcMP Review
        </button>
      </div>
    </div>
  );
}
