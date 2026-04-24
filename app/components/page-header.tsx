import type { ReactNode } from "react";

/**
 * Shared page-header system for every standard app page except the
 * Shop Wall Screen. The header renders an optional eyebrow, a page title,
 * a supporting description, optional right-aligned actions, and an
 * optional trailing row of tabs/controls inside the same container so
 * the first content section below feels connected, not detached.
 */

const HEADER_TOKENS = {
  text: "#1f2937",
  muted: "#5f6b7c",
  mutedSoft: "#8590a0",
  border: "#e2ddd1",
  surfaceSoft: "#f4f1ea",
};

const FONT_STACK =
  'var(--font-inter), var(--font-geist-sans), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

export type PageHeaderProps = {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
  /**
   * Space between the header and the first content section. The header
   * itself owns the bottom divider, so this is deliberately small to
   * keep the next section visually attached.
   */
  marginBottom?: number | string;
};

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  tabs,
  marginBottom = 12,
}: PageHeaderProps) {
  return (
    <header
      style={{
        marginBottom,
        paddingBottom: tabs ? 0 : 10,
        borderBottom: tabs ? undefined : `1px solid ${HEADER_TOKENS.border}`,
        fontFamily: FONT_STACK,
        color: HEADER_TOKENS.text,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "var(--gap-default)",
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0, flex: "1 1 360px" }}>
          {eyebrow && (
            <div
              style={{
                fontSize: "var(--fs-meta)",
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: HEADER_TOKENS.mutedSoft,
                marginBottom: "4px",
              }}
            >
              {eyebrow}
            </div>
          )}

          <h1
            style={{
              margin: 0,
              fontSize: "clamp(28px, 2.4vw, 34px)",
              lineHeight: 1.08,
              fontWeight: 700,
              color: HEADER_TOKENS.text,
              letterSpacing: "-0.02em",
            }}
          >
            {title}
          </h1>

          {description && (
            <p
              style={{
                margin: "4px 0 0",
                fontSize: "var(--fs-md)",
                lineHeight: 1.5,
                color: HEADER_TOKENS.muted,
                maxWidth: "680px",
              }}
            >
              {description}
            </p>
          )}
        </div>

        {actions && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--gap-tight)",
              flexShrink: 0,
              alignSelf: "flex-start",
              paddingTop: "2px",
            }}
          >
            {actions}
          </div>
        )}
      </div>

      {tabs && (
        <div
          style={{
            marginTop: "var(--gap-default)",
            paddingTop: "10px",
            paddingBottom: "10px",
            borderTop: `1px solid ${HEADER_TOKENS.border}`,
            borderBottom: `1px solid ${HEADER_TOKENS.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "10px",
            flexWrap: "wrap",
          }}
        >
          {tabs}
        </div>
      )}
    </header>
  );
}

export const PAGE_HEADER_TOKENS = HEADER_TOKENS;
