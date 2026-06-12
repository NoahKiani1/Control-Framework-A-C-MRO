"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";

export type ManualId =
  | "application-manual"
  | "instructions-for-code-changes"
  | "technical-manual";

type ManualPdfButtonProps = {
  manualId: ManualId;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  title?: string;
  loadingLabel?: ReactNode;
};

function getErrorMessage(payload: unknown): string | null {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    payload.error &&
    typeof payload.error === "object" &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
  ) {
    return payload.error.message;
  }

  return null;
}

export function ManualPdfButton({
  manualId,
  children,
  className,
  style,
  title,
  loadingLabel = "Opening PDF...",
}: ManualPdfButtonProps) {
  const [opening, setOpening] = useState(false);

  async function openManual() {
    setOpening(true);
    const tab = window.open("", "_blank");

    try {
      if (!tab) {
        throw new Error("Browser blocked the new tab.");
      }

      tab.opener = null;
      tab.document.title = "Opening PDF...";
      tab.document.body.style.fontFamily =
        "system-ui, -apple-system, Segoe UI, sans-serif";
      tab.document.body.style.padding = "24px";
      tab.document.body.textContent = "PDF openen...";

      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();

      if (error) throw new Error(error.message);
      if (!session?.access_token) throw new Error("No active session.");

      const response = await fetch(`/api/manuals/${manualId}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        let message = "PDF could not be opened.";
        try {
          message = getErrorMessage(await response.json()) ?? message;
        } catch {
          // Keep the generic message when the response is not JSON.
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      tab.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      tab?.close();
      window.alert(
        error instanceof Error
          ? `Unable to open manual: ${error.message}`
          : "Unable to open manual.",
      );
    } finally {
      setOpening(false);
    }
  }

  return (
    <button
      type="button"
      className={className}
      style={{
        ...style,
        cursor: opening ? "wait" : (style?.cursor ?? "pointer"),
        opacity: opening ? 0.72 : style?.opacity,
      }}
      title={title}
      aria-busy={opening}
      disabled={opening}
      onClick={() => void openManual()}
    >
      {opening ? loadingLabel : children}
    </button>
  );
}
// noah was hier
