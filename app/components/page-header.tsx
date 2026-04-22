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
  marginBottom = 16,
}: PageHeaderProps) {
  return (
    <header
      style={{
        marginBottom,
        paddingBottom: tabs ? 0 : 12,
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
          gap: "16px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0, flex: "1 1 420px" }}>
          {eyebrow && (
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: HEADER_TOKENS.mutedSoft,
                marginBottom: "6px",
              }}
            >
              {eyebrow}
            </div>
          )}

          <h1
            style={{
              margin: 0,
              fontSize: "30px",
              lineHeight: 1.08,
              fontWeight: 750,
              color: HEADER_TOKENS.text,
              letterSpacing: "-0.03em",
            }}
          >
            {title}
          </h1>

          {description && (
            <p
              style={{
                margin: "6px 0 0",
                fontSize: "14px",
                lineHeight: 1.5,
                color: HEADER_TOKENS.muted,
                maxWidth: "820px",
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
              gap: "10px",
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
            marginTop: "16px",
            paddingTop: "12px",
            paddingBottom: "12px",
            borderTop: `1px solid ${HEADER_TOKENS.border}`,
            borderBottom: `1px solid ${HEADER_TOKENS.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
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
