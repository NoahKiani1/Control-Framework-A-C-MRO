import { BookOpenText, ExternalLink, FileText } from "lucide-react";
import { PageHeader } from "@/app/components/page-header";
import {
  ManualPdfButton,
  type ManualId,
} from "@/app/components/manual-pdf-button";
import { RequireRole } from "@/app/components/require-role";

const COLORS = {
  pageBg: "#f2efe9",
  panelBg: "#ffffff",
  cardBg: "#faf8f3",
  border: "#e2ddd1",
  borderStrong: "#ccc4b4",
  text: "#1f2937",
  textSoft: "#5f6b7c",
  textMuted: "#8590a0",
  red: "#dc2626",
  redSoft: "#fef2f2",
  blue: "#2555c7",
  blueSoft: "#eef3ff",
  purple: "#6d4aa7",
  purpleSoft: "#f1ebfa",
  shadow:
    "0 1px 2px rgba(31, 41, 55, 0.04), 0 4px 12px rgba(31, 41, 55, 0.04)",
};

const manuals = [
  {
    title: "Application Manual",
    description:
      "Covers the main screens' functionities: dashboard, planning, office updates, imports, staff management, and shop wall usage.",
    manualId: "application-manual" satisfies ManualId,
    tone: "blue",
  },
  {
    title: "Instructions for Code Changes",
    description:
      "Explains how to work safely with local changes: when to pull, how to check status, how to commit and push, and what to do when something looks wrong.",
    manualId: "instructions-for-code-changes" satisfies ManualId,
    tone: "red",
  },
  {
    title: "Technical Manual",
    description:
      "Troubleshooting guide for when something goes wrong: per screen and per piece of work order logic, the symptoms, causes, and fixes, from disappeared work orders to blocks, RFQ, and capacity.",
    manualId: "technical-manual" satisfies ManualId,
    tone: "purple",
  },
] as const;

const TONE_ACCENTS = {
  blue: { accent: COLORS.blue, soft: COLORS.blueSoft },
  red: { accent: COLORS.red, soft: COLORS.redSoft },
  purple: { accent: COLORS.purple, soft: COLORS.purpleSoft },
} as const;

function ManualsContent() {
  return (
    <main
      style={{
        minHeight: "100vh",
        backgroundColor: COLORS.pageBg,
        padding:
          "var(--layout-page-py) var(--layout-page-px) var(--layout-page-px)",
        fontFamily: "var(--font-inter), var(--font-geist-sans), sans-serif",
        color: COLORS.text,
      }}
    >
      <div className="app-page-shell">
        <PageHeader
          title="Manuals"
         
        />

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "var(--gap-section)",
          }}
        >
          {manuals.map((manual) => {
            const { accent, soft: accentSoft } = TONE_ACCENTS[manual.tone];

            return (
              <article
                key={manual.manualId}
                style={{
                  display: "flex",
                  minHeight: 196,
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: "18px",
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 8,
                  background: COLORS.panelBg,
                  boxShadow: COLORS.shadow,
                  overflow: "hidden",
                }}
              >
                <div style={{ padding: "18px 18px 0" }}>
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 12,
                      color: accent,
                      fontSize: "var(--fs-sm)",
                      fontWeight: 750,
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        display: "inline-flex",
                        height: 30,
                        width: 30,
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: 6,
                        background: accentSoft,
                      }}
                    >
                      <BookOpenText size={16} strokeWidth={1.9} />
                    </span>
                    PDF manual
                  </div>

                  <h2
                    style={{
                      margin: 0,
                      color: COLORS.text,
                      fontSize: "var(--fs-title)",
                      fontWeight: 750,
                      lineHeight: 1.12,
                    }}
                  >
                    {manual.title}
                  </h2>

                  <p
                    style={{
                      margin: "8px 0 0",
                      color: COLORS.textSoft,
                      fontSize: "var(--fs-md)",
                      lineHeight: 1.55,
                    }}
                  >
                    {manual.description}
                  </p>
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    borderTop: `1px solid ${COLORS.border}`,
                    background: COLORS.cardBg,
                    padding: "12px 18px",
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 7,
                      color: COLORS.textMuted,
                      fontSize: "var(--fs-sm)",
                      fontWeight: 650,
                    }}
                  >
                    <FileText size={15} strokeWidth={1.8} />
                    PDF document
                  </span>

                  <ManualPdfButton
                    manualId={manual.manualId}
                    style={{
                      display: "inline-flex",
                      minHeight: 36,
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      border: `1px solid ${accent}`,
                      borderRadius: 6,
                      background: accent,
                      color: "#ffffff",
                      padding: "8px 12px",
                      fontSize: "var(--fs-body)",
                      fontWeight: 750,
                      textDecoration: "none",
                      boxShadow: `0 8px 18px ${accent}24`,
                    }}
                  >
                    Open PDF
                    <ExternalLink size={14} strokeWidth={2} />
                  </ManualPdfButton>
                </div>
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}

export default function ManualsPage() {
  return (
    <RequireRole allowedRoles={["office", "developer"]}>
      <ManualsContent />
    </RequireRole>
  );
}
// noah was hier
