"use client";

import Image from "next/image";
import { Public_Sans } from "next/font/google";
import { useEffect, useRef, useState } from "react";
import { RequireRole } from "@/app/components/require-role";
import { READY_TO_CLOSE_STEP } from "@/lib/process-steps";
import { applySuggestedAssignmentsForCurrentStep } from "@/lib/auto-assign";
import {
  DEFAULT_ASSIGNED_PERSON_TEAM,
  applyTodayQualificationBlocks,
  formatDate,
  getCorrectiveActionContext,
  hasActiveCorrectiveAction,
  isBlocked,
  localDateKey,
  normalizeAssignedPersonTeam,
  normalizeRfqState,
  priorityTag,
  sortOrders,
} from "@/lib/work-order-rules";
import {
  getEngineerAbsences,
  getEngineerPhotoUrl,
  getEngineers,
} from "@/lib/engineers";
import { getWorkOrders } from "@/lib/work-orders";
import { ExtraAction, getExtraActions } from "@/lib/extra-actions";

type WorkOrder = {
  work_order_id: string;
  customer: string | null;
  part_number: string | null;
  work_order_type: string | null;
  due_date: string | null;
  priority: string | null;
  assigned_person_team: string | null;
  current_process_step: string | null;
  hold_reason: string | null;
  rfq_state: string | null;
  required_next_action: string | null;
  action_owner: string | null;
  action_status: string | null;
  action_closed: boolean | null;
  last_manual_update: string | null;
  last_system_update: string | null;
};

type Engineer = {
  id: number;
  name: string;
  photo_path: string | null;
  restrictions: string[] | null;
  employment_start_date?: string | null;
};

type Absence = {
  engineer_id: number;
  absence_date: string;
};

const shopFont = Public_Sans({
  subsets: ["latin"],
  display: "swap",
});
const FONT_STACK = `${shopFont.style.fontFamily}, "Gotham", var(--font-geist-sans), "Geist", var(--font-inter), "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
const AUTO_SCROLL_SPEED_PX_PER_SECOND = 18;
const AUTO_SCROLL_TOP_PAUSE_MS = 7000;
const AUTO_SCROLL_SECTION_PAUSE_MS = 5000;
const AUTO_SCROLL_BOTTOM_PAUSE_MS = 9000;
const AUTO_SCROLL_SECTION_TOP_OFFSET_PX = 18;
const AUTO_SCROLL_BOTTOM_SPACER_PX = 12;

const COLORS = {
  pageBg: "#e3e7ee",
  ink: "#1a1f2b",
  muted: "#5f6878",
  soft: "#eef1f6",
  panel: "#f7f8fb",
  border: "#d2d8e1",
  borderStrong: "#b5bdc9",
  green: "#2d8a5f",
  greenSoft: "#e4efe9",
  red: "#b5372f",
  redSoft: "#f4e2df",
  amber: "#a56610",
  amberSoft: "#f5ecd7",
  blue: "#2f549e",
  blueSoft: "#e4ebf5",
};

const CARD_OPEN_BG = "#f1f6f2";
const CARD_OPEN_BORDER = "#cedbd2";
const CARD_BLOCKED_BG = "#f7ece9";
const CARD_BLOCKED_BORDER = "#e4c9c3";
const CARD_ACTION_BG = "#f5ecd7";
const CARD_ACTION_BORDER = "#e5cf9a";

const HEADER_BG = "#1b2230";
const HEADER_BORDER = "#0f141d";
const HEADER_INK = "#eef2f7";
const HEADER_MUTED = "rgba(238, 242, 247, 0.6)";
const HEADER_TILE_BG = "rgba(255, 255, 255, 0.06)";
const HEADER_TILE_BORDER = "rgba(255, 255, 255, 0.12)";

function sanitizeActiveShopAssignments<T extends { assigned_person_team: string | null }>(
  orders: T[],
  engineers: Engineer[],
): T[] {
  const activeEngineerNames = new Set(engineers.map((engineer) => engineer.name));

  return orders.map((order) => {
    const assignedPersonTeam = normalizeAssignedPersonTeam(order.assigned_person_team);

    if (
      assignedPersonTeam === DEFAULT_ASSIGNED_PERSON_TEAM ||
      activeEngineerNames.has(assignedPersonTeam)
    ) {
      return order;
    }

    return {
      ...order,
      assigned_person_team: DEFAULT_ASSIGNED_PERSON_TEAM,
    };
  });
}

function isOverdue(dateStr: string | null): boolean {
  if (!dateStr) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const due = new Date(dateStr);
  due.setHours(0, 0, 0, 0);

  return due < today;
}

function AssignedPerson({
  name,
  photoUrl,
}: {
  name: string | null;
  photoUrl: string | null;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const normalizedName = normalizeAssignedPersonTeam(name);
  const displayName = normalizedName === "Shop" ? "Shop" : normalizedName;
  const showPhotoOnly = Boolean(photoUrl) && !imageFailed;
  const resolvedPhotoUrl = photoUrl || "";

  if (!showPhotoOnly) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "84px",
          minHeight: "40px",
          padding: "0 10px",
          borderRadius: "8px",
          backgroundColor: COLORS.soft,
          border: `1px solid ${COLORS.borderStrong}`,
          color: COLORS.ink,
          fontSize: "14px",
          fontWeight: 600,
          lineHeight: 1,
          letterSpacing: "0.01em",
          textAlign: "center",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {displayName}
      </span>
    );
  }

  return (
    <span
      style={{
        display: "grid",
        alignItems: "end",
        justifyItems: "center",
        width: "84px",
        height: "84px",
      }}
    >
      <Image
        src={resolvedPhotoUrl}
        alt={displayName}
        width={84}
        height={84}
        unoptimized
        onError={() => setImageFailed(true)}
        style={{
          width: "84px",
          height: "84px",
          maxWidth: "84px",
          maxHeight: "84px",
          borderRadius: "0",
          objectFit: "contain",
          objectPosition: "center bottom",
          flexShrink: 0,
        }}
      />
    </span>
  );
}

type AdditionalTaskItem =
  | { kind: "wo-action"; due: string | null; order: WorkOrder }
  | { kind: "extra-action"; due: string | null; action: ExtraAction };

function sortAdditionalTaskItems(items: AdditionalTaskItem[]): AdditionalTaskItem[] {
  return [...items].sort((a, b) => {
    if (!a.due && !b.due) return 0;
    if (!a.due) return 1;
    if (!b.due) return -1;
    return a.due.localeCompare(b.due);
  });
}

function isShopOwnedTask(owner: string | null, engineers: Engineer[]): boolean {
  const normalizedOwner = normalizeAssignedPersonTeam(owner);

  if (normalizedOwner === DEFAULT_ASSIGNED_PERSON_TEAM) {
    return true;
  }

  return engineers.some((engineer) => engineer.name === normalizedOwner);
}

function ShopPageContent() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [engineers, setEngineers] = useState<Engineer[]>([]);
  const [extraActions, setExtraActions] = useState<ExtraAction[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const openSectionRef = useRef<HTMLElement | null>(null);
  const blockedSectionRef = useRef<HTMLElement | null>(null);
  const actionsSectionRef = useRef<HTMLElement | null>(null);
  const bottomSpacerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    async function load() {
      const today = localDateKey();
      const [data, engineerData, absenceData, extrasData] = await Promise.all([
        getWorkOrders<WorkOrder>({
          select:
            "work_order_id, customer, part_number, work_order_type, due_date, priority, assigned_person_team, current_process_step, hold_reason, rfq_state, required_next_action, action_owner, action_status, action_closed, last_manual_update, last_system_update",
          isOpen: true,
          isActive: true,
        }),
        getEngineers<Engineer>({
          select: "id, name, photo_path, restrictions",
          isActive: true,
          role: "shop",
          startedOn: today,
        }),
        getEngineerAbsences<Absence>({
          select: "engineer_id, absence_date",
          fromDate: today,
        }),
        getExtraActions(),
      ]);
      setExtraActions(extrasData);

      const filtered = data.filter(
        (o) => o.current_process_step !== READY_TO_CLOSE_STEP,
      );
      const qualifiedFiltered = applyTodayQualificationBlocks(
        filtered,
        engineerData,
        absenceData,
        today,
      );

      const suggestedOrders = applySuggestedAssignmentsForCurrentStep(
        qualifiedFiltered,
        engineerData,
        new Set(
          engineerData
            .filter((engineer) =>
              absenceData.some(
                (absence) =>
                  absence.absence_date === today &&
                  absence.engineer_id === engineer.id,
              ),
            )
            .map((engineer) => engineer.name),
        ),
      );

      setOrders(
        sortOrders(sanitizeActiveShopAssignments(suggestedOrders, engineerData)),
      );
      setEngineers(engineerData);
      setLoading(false);
    }

    load();

    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (loading) return;

    const viewport = scrollerRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    const scrollViewport: HTMLDivElement = viewport;
    const scrollContent: HTMLDivElement = content;

    let frame = 0;
    let lastTimestamp: number | null = null;
    let currentOffset = 0;
    let previousOffset = 0;
    let pauseUntil = performance.now() + AUTO_SCROLL_TOP_PAUSE_MS;
    let shouldResetToTop = false;
    const pausedTargets = new Set<number>();

    function getViewportInnerHeight() {
      const styles = window.getComputedStyle(scrollViewport);
      const paddingTop = Number.parseFloat(styles.paddingTop || "0");
      const paddingBottom = Number.parseFloat(styles.paddingBottom || "0");
      return Math.max(
        0,
        scrollViewport.clientHeight - paddingTop - paddingBottom,
      );
    }

    function getMaxScroll() {
      const contentHeight = scrollContent.getBoundingClientRect().height;
      const viewportHeight = getViewportInnerHeight();
      return Math.max(0, contentHeight - viewportHeight);
    }

    function applyOffset(offset: number) {
      scrollContent.style.transform = `translate3d(0, -${offset}px, 0)`;
    }

    function getPauseTargets() {
      const maxScroll = getMaxScroll();
      const sectionTargets = [
        openSectionRef.current,
        actionsSectionRef.current,
        blockedSectionRef.current,
      ]
        .map((section) => {
          if (!section) return null;
          return Math.min(
            maxScroll,
            Math.max(0, section.offsetTop - AUTO_SCROLL_SECTION_TOP_OFFSET_PX),
          );
        })
        .filter((target): target is number => target !== null);

      return [...new Set([0, ...sectionTargets, maxScroll])].sort((a, b) => a - b);
    }

    function tick(timestamp: number) {
      const maxScroll = getMaxScroll();

      if (maxScroll <= 4) {
        currentOffset = 0;
        previousOffset = 0;
        applyOffset(0);
        frame = requestAnimationFrame(tick);
        return;
      }

      if (timestamp < pauseUntil) {
        lastTimestamp = timestamp;
        frame = requestAnimationFrame(tick);
        return;
      }

      if (shouldResetToTop) {
        currentOffset = 0;
        previousOffset = 0;
        applyOffset(0);
        pausedTargets.clear();
        shouldResetToTop = false;
        pauseUntil = timestamp + AUTO_SCROLL_TOP_PAUSE_MS;
        lastTimestamp = timestamp;
        frame = requestAnimationFrame(tick);
        return;
      }

      const deltaMs = lastTimestamp === null ? 0 : timestamp - lastTimestamp;
      lastTimestamp = timestamp;
      const nextOffset = Math.min(
        maxScroll,
        currentOffset + (AUTO_SCROLL_SPEED_PX_PER_SECOND * deltaMs) / 1000,
      );

      currentOffset = nextOffset;
      applyOffset(currentOffset);

      const reachedTarget = getPauseTargets().find(
        (target) =>
          target > previousOffset + 1 &&
          target <= nextOffset + 1 &&
          !pausedTargets.has(target),
      );

      if (reachedTarget !== undefined && reachedTarget < maxScroll - 1) {
        currentOffset = reachedTarget;
        applyOffset(currentOffset);
        pausedTargets.add(reachedTarget);
        pauseUntil = timestamp + AUTO_SCROLL_SECTION_PAUSE_MS;
      }

      if (nextOffset >= maxScroll - 1) {
        pauseUntil = timestamp + AUTO_SCROLL_BOTTOM_PAUSE_MS;
        shouldResetToTop = true;
      }

      previousOffset = currentOffset;
      frame = requestAnimationFrame(tick);
    }

    applyOffset(0);
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      scrollContent.style.transform = "translate3d(0, 0, 0)";
    };
  }, [loading, orders.length]);

  if (loading) {
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          backgroundColor: COLORS.pageBg,
          color: COLORS.ink,
          fontFamily: FONT_STACK,
        }}
      >
        <div style={{ display: "grid", gap: "10px", justifyItems: "center" }}>
          <div
            style={{
              fontSize: "11px",
              fontWeight: 500,
              letterSpacing: "0.18em",
              color: COLORS.muted,
              textTransform: "uppercase",
            }}
          >
            Aircraft & Component MRO · Workshop
          </div>
          <div style={{ fontSize: "24px", fontWeight: 600, letterSpacing: "-0.015em" }}>Loading shop wall...</div>
        </div>
      </main>
    );
  }

  const nonBlockedOrders = orders.filter((o) => !isBlocked(o));
  const blockedOrders = orders.filter((o) => isBlocked(o));
  const actionOrders = orders.filter(
    (o) =>
      hasActiveCorrectiveAction(o) &&
      isShopOwnedTask(getCorrectiveActionContext(o).owner, engineers),
  );
  const engineerAdditionalActions = extraActions.filter((action) =>
    isShopOwnedTask(action.responsible_person_team, engineers),
  );
  const additionalTasks: AdditionalTaskItem[] = sortAdditionalTaskItems([
    ...actionOrders.map<AdditionalTaskItem>((order) => ({
      kind: "wo-action",
      due: order.due_date,
      order,
    })),
    ...engineerAdditionalActions.map<AdditionalTaskItem>((action) => ({
      kind: "extra-action",
      due: action.due_date,
      action,
    })),
  ]);
  const engineerByName = new Map(engineers.map((e) => [e.name, e]));
  const aogCount = orders.filter((o) => priorityTag(o.priority) === "AOG").length;

  const cardStyle: React.CSSProperties = {
    position: "relative",
    display: "grid",
    gridTemplateColumns:
      "minmax(200px, 22fr) minmax(150px, 18fr) minmax(260px, 40fr) minmax(232px, 20fr)",
    columnGap: "14px",
    alignItems: "stretch",
    minHeight: "104px",
    padding: "10px 14px 10px 18px",
    borderRadius: "10px",
    border: `1px solid ${COLORS.border}`,
    backgroundColor: COLORS.panel,
    boxShadow: "0 1px 2px rgba(15, 20, 30, 0.04)",
    overflow: "hidden",
  };

  const labelStyle: React.CSSProperties = {
    color: COLORS.muted,
    fontSize: "11px",
    fontWeight: 600,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
  };

  function priorityStyle(order: WorkOrder): React.CSSProperties {
    const base: React.CSSProperties = {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      minWidth: "58px",
      padding: "4px 10px",
      borderRadius: "5px",
      fontSize: "13px",
      fontWeight: 700,
      letterSpacing: "0.08em",
      border: `1px solid transparent`,
      lineHeight: 1.1,
    };

    const tag = priorityTag(order.priority);

    if (tag === "AOG") {
      return {
        ...base,
        color: "#ffffff",
        backgroundColor: COLORS.red,
        borderColor: COLORS.red,
      };
    }

    if (tag === "PRIO") {
      return {
        ...base,
        color: COLORS.ink,
        backgroundColor: COLORS.amberSoft,
        borderColor: "#e5cf9a",
      };
    }

    return {
      ...base,
      color: COLORS.muted,
      backgroundColor: COLORS.soft,
    };
  }

  function prioLabel(order: WorkOrder): string | null {
    return priorityTag(order.priority);
  }

  function holdReasonDisplay(o: WorkOrder): string {
    if (o.hold_reason) return o.hold_reason;
    const rfqState = normalizeRfqState(o.rfq_state);
    if (rfqState === "rfq rejected") return "RFQ Rejected";
    if (rfqState === "rfq send") return "Waiting for RFQ Approval";
    return "-";
  }

  function renderMetaRail({
    name,
    photoUrl,
    dueDate,
    overdue,
    assignedLabel = "Assigned",
    dueLabel = "Work order due on",
    hideAssigned = false,
  }: {
    name: string | null;
    photoUrl: string | null;
    dueDate: string | null;
    overdue: boolean;
    assignedLabel?: string;
    dueLabel?: string;
    hideAssigned?: boolean;
  }) {
    return (
      <div
        style={{
          alignSelf: "stretch",
          display: "grid",
          gridTemplateColumns: "84px minmax(132px, 1fr)",
          gridTemplateRows: "auto auto",
          columnGap: "12px",
          rowGap: "4px",
          paddingLeft: "14px",
          borderLeft: `1px solid ${COLORS.border}`,
          minWidth: 0,
        }}
      >
        <div
          style={{
            ...labelStyle,
            visibility: hideAssigned ? "hidden" : "visible",
          }}
        >
          {assignedLabel}
        </div>
        <div
          style={{
            ...labelStyle,
            textAlign: "right",
          }}
        >
          {dueLabel}
        </div>
        <div
          style={{
            visibility: hideAssigned ? "hidden" : "visible",
            display: "grid",
            placeItems: "center",
            width: "84px",
            height: "84px",
            gridRow: 2,
          }}
        >
          <AssignedPerson name={name} photoUrl={photoUrl} />
        </div>
        <div
          style={{
            display: "grid",
            gap: "1px",
            alignContent: "center",
            justifyItems: "end",
            minWidth: 0,
            gridRow: 2,
          }}
        >
          <div
            style={{
              color: overdue ? COLORS.red : COLORS.ink,
              fontSize: "24px",
              fontWeight: 700,
              whiteSpace: "nowrap",
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1,
              letterSpacing: "-0.015em",
            }}
          >
            {formatDate(dueDate)}
          </div>
        </div>
      </div>
    );
  }

  function renderOrderCard(order: WorkOrder, blocked = false) {
    const assignedPersonTeam = normalizeAssignedPersonTeam(order.assigned_person_team);
    const engineer = engineerByName.get(assignedPersonTeam);
    const statusColor = blocked ? COLORS.red : COLORS.green;
    const overdue = isOverdue(order.due_date);

    return (
      <article
        key={order.work_order_id}
        style={{
          ...cardStyle,
          backgroundColor: blocked ? CARD_BLOCKED_BG : CARD_OPEN_BG,
          borderColor: blocked ? CARD_BLOCKED_BORDER : CARD_OPEN_BORDER,
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: "5px",
            backgroundColor: statusColor,
          }}
        />

        {/* COL 1: work order identity - ID + priority badge + part number */}
        <div
          style={{
            display: "grid",
            alignContent: "center",
            gap: "4px",
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              flexWrap: "wrap",
              rowGap: "4px",
            }}
          >
            <div
              style={{
                color: COLORS.ink,
                fontSize: "36px",
                fontWeight: 650,
                lineHeight: 0.98,
                letterSpacing: "-0.015em",
                fontVariantNumeric: "tabular-nums",
                overflowWrap: "anywhere",
              }}
            >
              {order.work_order_id}
            </div>
            {prioLabel(order) && (
              <span style={priorityStyle(order)}>{prioLabel(order)}</span>
            )}
          </div>
          <div
            style={{
              color: COLORS.muted,
              fontSize: "16px",
              fontWeight: 600,
              lineHeight: 1.2,
              letterSpacing: "0.01em",
              overflowWrap: "anywhere",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {`PN: ${order.part_number || "-"}`}
          </div>
        </div>

        {/* COL 2: customer */}
        <div
          style={{
            display: "grid",
            alignContent: "center",
            gap: "2px",
            minWidth: 0,
          }}
        >
          <div
            style={{
              color: COLORS.ink,
              fontSize: "20px",
              fontWeight: 550,
              lineHeight: 1.15,
              letterSpacing: "0.002em",
              overflowWrap: "anywhere",
            }}
          >
            {order.customer || "-"}
          </div>
        </div>

        {/* COL 3: operational message - current step, with hold reason in the right-side gap for blocked work */}
        <div
          style={{
            display: "grid",
            alignContent: "center",
            minWidth: 0,
            borderLeft: `1px solid ${COLORS.border}`,
            paddingLeft: "16px",
          }}
        >
          {blocked ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) minmax(220px, 0.9fr)",
                columnGap: "18px",
                alignItems: "center",
                minWidth: 0,
              }}
            >
              <div style={{ minWidth: 0, display: "grid", gap: "3px" }}>
                <div style={labelStyle}>Current step</div>
                <div
                  style={{
                    color: COLORS.ink,
                    fontSize: "26px",
                    fontWeight: 650,
                    lineHeight: 1.1,
                    letterSpacing: "-0.01em",
                    overflowWrap: "anywhere",
                  }}
                >
                  {order.current_process_step || "-"}
                </div>
                <div
                  style={{
                    color: COLORS.muted,
                    fontSize: "16px",
                    fontWeight: 500,
                    lineHeight: 1.2,
                    overflowWrap: "anywhere",
                  }}
                >
                  {order.work_order_type || "-"}
                </div>
              </div>

              <div style={{ minWidth: 0, display: "grid", gap: "3px" }}>
                <div style={labelStyle}>Hold reason</div>
                <div
                  style={{
                    color: COLORS.red,
                    fontSize: "18px",
                    fontWeight: 650,
                    lineHeight: 1.15,
                    letterSpacing: "-0.01em",
                    overflowWrap: "anywhere",
                  }}
                >
                  {holdReasonDisplay(order)}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ minWidth: 0, display: "grid", gap: "3px" }}>
              <div style={labelStyle}>Current step</div>
              <div
                style={{
                  color: COLORS.ink,
                  fontSize: "26px",
                  fontWeight: 650,
                  lineHeight: 1.1,
                  letterSpacing: "-0.01em",
                  overflowWrap: "anywhere",
                }}
              >
                {order.current_process_step || "-"}
              </div>
              <div
                style={{
                  color: COLORS.muted,
                  fontSize: "16px",
                  fontWeight: 500,
                  lineHeight: 1.2,
                  overflowWrap: "anywhere",
                }}
              >
                {order.work_order_type || "-"}
              </div>
            </div>
          )}
        </div>

        {renderMetaRail({
          name: assignedPersonTeam,
          photoUrl: getEngineerPhotoUrl(engineer?.photo_path),
          dueDate: order.due_date,
          overdue,
          hideAssigned: blocked,
        })}
      </article>
    );
  }

  function renderActionCard(order: WorkOrder) {
    const correctiveAction = getCorrectiveActionContext(order);
    const actionOwner = normalizeAssignedPersonTeam(correctiveAction.owner);
    const ownerEngineer = engineerByName.get(actionOwner);
    const overdue = isOverdue(order.due_date);

    return (
      <article
        key={order.work_order_id}
        style={{
          ...cardStyle,
          backgroundColor: CARD_ACTION_BG,
          borderColor: CARD_ACTION_BORDER,
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: "5px",
            backgroundColor: COLORS.amber,
          }}
        />

        <div
          style={{
            display: "grid",
            alignContent: "center",
            gap: "4px",
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              flexWrap: "wrap",
              rowGap: "4px",
            }}
          >
            <div
              style={{
                color: COLORS.ink,
                fontSize: "36px",
                fontWeight: 650,
                lineHeight: 0.98,
                letterSpacing: "-0.015em",
                fontVariantNumeric: "tabular-nums",
                overflowWrap: "anywhere",
              }}
            >
              {order.work_order_id}
            </div>
            {prioLabel(order) && (
              <span style={priorityStyle(order)}>{prioLabel(order)}</span>
            )}
          </div>
          <div
            style={{
              color: COLORS.muted,
              fontSize: "16px",
              fontWeight: 600,
              lineHeight: 1.2,
              letterSpacing: "0.01em",
              overflowWrap: "anywhere",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {`PN: ${order.part_number || "-"}`}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            alignContent: "center",
            gap: "2px",
            minWidth: 0,
          }}
        >
          <div
            style={{
              color: COLORS.ink,
              fontSize: "20px",
              fontWeight: 550,
              lineHeight: 1.15,
              letterSpacing: "0.002em",
              overflowWrap: "anywhere",
            }}
          >
            {order.customer || "-"}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            alignContent: "center",
            minWidth: 0,
            borderLeft: `1px solid ${COLORS.border}`,
            paddingLeft: "16px",
          }}
        >
          <div style={{ minWidth: 0, display: "grid", gap: "4px" }}>
            <div style={labelStyle}>Action</div>
            <div
              style={{
                color: COLORS.ink,
                fontSize: "25px",
                fontWeight: 650,
                lineHeight: 1.08,
                letterSpacing: "-0.012em",
                overflowWrap: "anywhere",
              }}
            >
              {correctiveAction.action || "-"}
            </div>
            <div
              style={{
                color: isBlocked(order) ? COLORS.red : COLORS.muted,
                fontSize: "16px",
                fontWeight: 550,
                lineHeight: 1.2,
                overflowWrap: "anywhere",
              }}
            >
              {isBlocked(order)
                ? `Blocking reason: ${holdReasonDisplay(order)}`
                : `Current step: ${order.current_process_step || "-"}`}
            </div>
          </div>
        </div>

        {renderMetaRail({
          name: actionOwner,
          photoUrl: getEngineerPhotoUrl(ownerEngineer?.photo_path),
          dueDate: order.due_date,
          overdue,
          dueLabel: "Work Order Due on",
        })}
      </article>
    );
  }

  function renderExtraActionCard(action: ExtraAction) {
    const responsible = normalizeAssignedPersonTeam(action.responsible_person_team);
    const ownerEngineer = engineerByName.get(responsible);
    const overdue = isOverdue(action.due_date);

    return (
      <article
        key={`extra-${action.id}`}
        style={{
          ...cardStyle,
          backgroundColor: CARD_ACTION_BG,
          borderColor: CARD_ACTION_BORDER,
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: "5px",
            backgroundColor: COLORS.amber,
          }}
        />

        <div
          style={{
            display: "grid",
            alignContent: "center",
            gap: "4px",
            minWidth: 0,
          }}
        >
          <div style={labelStyle}>Additional task</div>
          <div
            style={{
              color: COLORS.ink,
              fontSize: "24px",
              fontWeight: 650,
              lineHeight: 1.05,
              letterSpacing: "-0.015em",
              overflowWrap: "anywhere",
            }}
          >
            Standalone
          </div>
        </div>

        <div
          style={{
            display: "grid",
            alignContent: "center",
            gap: "2px",
            minWidth: 0,
          }}
        >
          <div
            style={{
              color: COLORS.muted,
              fontSize: "14px",
              fontWeight: 500,
              lineHeight: 1.2,
              letterSpacing: "0.005em",
              overflowWrap: "anywhere",
            }}
          >
            No work order
          </div>
        </div>

        <div
          style={{
            display: "grid",
            alignContent: "center",
            minWidth: 0,
            borderLeft: `1px solid ${COLORS.border}`,
            paddingLeft: "16px",
          }}
        >
          <div style={{ minWidth: 0, display: "grid", gap: "4px" }}>
            <div style={labelStyle}>Task</div>
            <div
              style={{
                color: COLORS.ink,
                fontSize: "25px",
                fontWeight: 650,
                lineHeight: 1.08,
                letterSpacing: "-0.012em",
                overflowWrap: "anywhere",
              }}
            >
              {action.description || "-"}
            </div>
          </div>
        </div>

        {renderMetaRail({
          name: responsible,
          photoUrl: getEngineerPhotoUrl(ownerEngineer?.photo_path),
          dueDate: action.due_date,
          overdue,
          dueLabel: "Task Due on",
        })}
      </article>
    );
  }

  function renderAdditionalTaskItem(item: AdditionalTaskItem) {
    if (item.kind === "wo-action") {
      return renderActionCard(item.order);
    }

    return renderExtraActionCard(item.action);
  }

  function renderOrderSection(
    title: string,
    subtitle: string,
    list: WorkOrder[],
    options?: {
      blocked?: boolean;
      accent?: string;
      emptyLabel?: string;
      renderCard?: (order: WorkOrder) => React.ReactNode;
      sectionRef?: React.Ref<HTMLElement>;
    },
  ) {
    const blocked = options?.blocked ?? false;
    const accent = options?.accent ?? (blocked ? COLORS.red : COLORS.green);
    const renderCard =
      options?.renderCard ?? ((order: WorkOrder) => renderOrderCard(order, blocked));

    return (
      <section ref={options?.sectionRef}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "14px",
            padding: "2px 4px 10px 4px",
            borderBottom: `1px solid ${COLORS.border}`,
          }}
        >
          <div
            aria-hidden
            style={{
              width: "4px",
              height: "22px",
              borderRadius: "2px",
              backgroundColor: accent,
              alignSelf: "center",
            }}
          />
          <h2
            style={{
              margin: 0,
              fontSize: "22px",
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: "-0.015em",
              color: COLORS.ink,
            }}
          >
            {title}
          </h2>
          <div
            style={{
              fontSize: "22px",
              fontWeight: 600,
              lineHeight: 1,
              color: accent,
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "-0.01em",
            }}
          >
            {list.length}
          </div>
          <div
            style={{
              marginLeft: "auto",
              fontSize: "13px",
              fontWeight: 500,
              color: COLORS.muted,
              letterSpacing: "0.005em",
            }}
          >
            {subtitle}
          </div>
        </div>

        {list.length === 0 ? (
          <div
            style={{
              marginTop: "10px",
              padding: "18px",
              borderRadius: "10px",
              backgroundColor: COLORS.panel,
              border: `1px dashed ${COLORS.borderStrong}`,
              color: COLORS.muted,
              fontSize: "15px",
              fontWeight: 500,
              textAlign: "center",
              letterSpacing: "0.01em",
            }}
          >
            {options?.emptyLabel || "Nothing here right now."}
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr",
              gap: "8px",
              marginTop: "10px",
            }}
          >
            {list.map((order) => renderCard(order))}
          </div>
        )}
      </section>
    );
  }

  function renderAdditionalTasksSection() {
    return (
      <section ref={actionsSectionRef}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "14px",
            padding: "2px 4px 10px 4px",
            borderBottom: `1px solid ${COLORS.border}`,
          }}
        >
          <div
            aria-hidden
            style={{
              width: "4px",
              height: "22px",
              borderRadius: "2px",
              backgroundColor: COLORS.amber,
              alignSelf: "center",
            }}
          />
          <h2
            style={{
              margin: 0,
              fontSize: "22px",
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: "-0.015em",
              color: COLORS.ink,
            }}
          >
            Additional Tasks
          </h2>
          <div
            style={{
              fontSize: "22px",
              fontWeight: 600,
              lineHeight: 1,
              color: COLORS.amber,
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "-0.01em",
            }}
          >
            {additionalTasks.length}
          </div>
          <div
            style={{
              marginLeft: "auto",
              fontSize: "13px",
              fontWeight: 500,
              color: COLORS.muted,
              letterSpacing: "0.005em",
            }}
          >
            Corrective actions and standalone tasks
          </div>
        </div>

        {additionalTasks.length === 0 ? (
          <div
            style={{
              marginTop: "10px",
              padding: "18px",
              borderRadius: "10px",
              backgroundColor: COLORS.panel,
              border: `1px dashed ${COLORS.borderStrong}`,
              color: COLORS.muted,
              fontSize: "15px",
              fontWeight: 500,
              textAlign: "center",
              letterSpacing: "0.01em",
            }}
          >
            No additional tasks right now.
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr",
              gap: "8px",
              marginTop: "10px",
            }}
          >
            {additionalTasks.map((item) => renderAdditionalTaskItem(item))}
          </div>
        )}
      </section>
    );
  }

  const stats = [
    { label: "Open", value: nonBlockedOrders.length, tone: "#7fd1a4" },
    { label: "Blocked", value: blockedOrders.length, tone: "#f0a39b" },
    { label: "Tasks", value: additionalTasks.length, tone: "#aebfd9" },
    { label: "AOG", value: aogCount, tone: aogCount > 0 ? "#ff7a6d" : HEADER_INK },
  ];

  return (
    <main
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        backgroundColor: COLORS.pageBg,
        color: COLORS.ink,
        fontFamily: FONT_STACK,
      }}
    >
      <header
        style={{
          flex: "0 0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "24px",
          padding: "14px 26px",
          borderBottom: `1px solid ${HEADER_BORDER}`,
          backgroundColor: HEADER_BG,
          color: HEADER_INK,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          
          <div style={{ display: "grid", gap: "4px" }}>
            <div
              style={{
                fontSize: "11px",
                fontWeight: 500,
                letterSpacing: "0.18em",
                color: HEADER_MUTED,
                textTransform: "uppercase",
              }}
            >
              Aircraft & Component MRO · Workshop
            </div>
            <h1
              style={{
                margin: 0,
                fontSize: "24px",
                fontWeight: 600,
                letterSpacing: "-0.02em",
                lineHeight: 1,
                color: HEADER_INK,
              }}
            >
              Workshop Operations
            </h1>
          </div>
        </div>

        <div style={{ display: "flex", gap: "6px" }}>
          {stats.map((stat) => (
            <div
              key={stat.label}
              style={{
                display: "grid",
                gap: "3px",
                justifyItems: "center",
                minWidth: "88px",
                padding: "6px 16px",
                borderRadius: "8px",
                backgroundColor: HEADER_TILE_BG,
                border: `1px solid ${HEADER_TILE_BORDER}`,
              }}
            >
              <div
                style={{
                  fontSize: "11px",
                  fontWeight: 500,
                  letterSpacing: "0.16em",
                  color: HEADER_MUTED,
                  textTransform: "uppercase",
                }}
              >
                {stat.label}
              </div>
              <div
                style={{
                  fontSize: "24px",
                  fontWeight: 600,
                  color: stat.tone,
                  lineHeight: 1,
                  fontVariantNumeric: "tabular-nums",
                  letterSpacing: "-0.015em",
                }}
              >
                {stat.value}
              </div>
            </div>
          ))}
        </div>
      </header>

      <div
        ref={scrollerRef}
        style={{
          flex: "1 1 auto",
          overflowY: "hidden",
          padding: "18px 22px",
          minHeight: 0,
        }}
      >
        <div
          style={{
            height: "100%",
          }}
        >
          <div
            ref={contentRef}
            style={{
              display: "grid",
              gap: "18px",
              willChange: "transform",
            }}
          >
            {renderOrderSection(
              "Open",
              "Work orders that can be worked on",
              nonBlockedOrders,
              {
                accent: COLORS.green,
                emptyLabel: "No open work orders right now.",
                sectionRef: openSectionRef,
              },
            )}
            {renderAdditionalTasksSection()}
            {renderOrderSection(
              "Blocked",
              "Work orders that cannot be worked on",
              blockedOrders,
              {
                blocked: true,
                accent: COLORS.red,
                emptyLabel: "No blocked work orders right now.",
                sectionRef: blockedSectionRef,
              },
            )}
            <div
              ref={bottomSpacerRef}
              aria-hidden
              style={{
                height: `${AUTO_SCROLL_BOTTOM_SPACER_PX}px`,
              }}
            />
          </div>
        </div>
      </div>
    </main>
  );
}

export default function ShopPage() {
  return (
    <RequireRole allowedRoles={["office", "wall"]}>
      <ShopPageContent />
    </RequireRole>
  );
}
