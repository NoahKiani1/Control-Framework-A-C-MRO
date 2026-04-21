"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { READY_TO_CLOSE_STEP } from "@/lib/process-steps";
import { canPerformStep } from "@/lib/restrictions";
import {
  formatDate,
  isBlocked,
  normalizeAssignedPersonTeam,
  normalizeRfqState,
  sortOrders,
} from "@/lib/work-order-rules";
import {
  getEngineerAbsences,
  getEngineerPhotoUrl,
  getEngineers,
} from "@/lib/engineers";
import { getWorkOrders } from "@/lib/work-orders";

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
  last_manual_update: string | null;
  last_system_update: string | null;
};

type Engineer = {
  id: number;
  name: string;
  photo_path: string | null;
  restrictions: string[] | null;
};

type Absence = {
  engineer_id: number;
  absence_date: string;
};

const NO_QUALIFIED_ENGINEER_REASON = "No Qualified Engineer Present";
const FONT_STACK =
  'var(--font-geist-sans), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const AUTO_SCROLL_SPEED_PX_PER_SECOND = 18;
const AUTO_SCROLL_TOP_PAUSE_MS = 7000;
const AUTO_SCROLL_SECTION_PAUSE_MS = 5000;
const AUTO_SCROLL_BOTTOM_PAUSE_MS = 9000;

const COLORS = {
  pageBg: "#f3f5f7",
  ink: "#14181f",
  muted: "#5c6675",
  soft: "#f6f8fa",
  panel: "#ffffff",
  border: "#d6dde6",
  borderStrong: "#b8c4d1",
  green: "#0f8a67",
  greenSoft: "#e7f5ef",
  red: "#cf3b32",
  redSoft: "#fdeceb",
  amber: "#b56a15",
  amberSoft: "#fff1dc",
  blue: "#2358d4",
  blueSoft: "#eaf0ff",
};

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function applyTodayQualificationBlocks(
  orders: WorkOrder[],
  engineers: Engineer[],
  absences: Absence[],
  today: string,
): WorkOrder[] {
  const absentEngineerIds = new Set(
    absences
      .filter((absence) => absence.absence_date === today)
      .map((absence) => absence.engineer_id),
  );
  const presentEngineers = engineers.filter(
    (engineer) => !absentEngineerIds.has(engineer.id),
  );

  return orders.map((order) => {
    if (isBlocked(order) || !order.current_process_step) return order;

    const hasQualifiedEngineer = presentEngineers.some((engineer) =>
      canPerformStep(engineer.restrictions, order.current_process_step!),
    );

    if (hasQualifiedEngineer) return order;

    return {
      ...order,
      hold_reason: NO_QUALIFIED_ENGINEER_REASON,
    };
  });
}

function AssignedPerson({
  name,
  photoUrl,
}: {
  name: string | null;
  photoUrl: string | null;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const displayName = normalizeAssignedPersonTeam(name);
  const showPhotoOnly = Boolean(photoUrl) && !imageFailed;
  const resolvedPhotoUrl = photoUrl || "";

  if (!showPhotoOnly) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: "92px",
          minHeight: "40px",
          padding: "0 14px",
          borderRadius: "999px",
          backgroundColor: COLORS.soft,
          border: `1px solid ${COLORS.border}`,
          color: COLORS.ink,
          fontSize: "15px",
          fontWeight: 700,
          lineHeight: 1,
          textAlign: "center",
          whiteSpace: "nowrap",
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
        alignItems: "center",
        justifyItems: "center",
        width: "100%",
        height: "100%",
        minHeight: "76px",
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
          width: "92px",
          height: "92px",
          maxWidth: "92px",
          maxHeight: "92px",
          borderRadius: "0",
          objectFit: "contain",
          objectPosition: "center bottom",
          flexShrink: 0,
        }}
      />
    </span>
  );
}

export default function ShopPage() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [engineers, setEngineers] = useState<Engineer[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const activeSectionRef = useRef<HTMLElement | null>(null);
  const blockedSectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    async function load() {
      const today = localDateKey();
      const [data, engineerData, absenceData] = await Promise.all([
        getWorkOrders<WorkOrder>({
          select:
            "work_order_id, customer, part_number, work_order_type, due_date, priority, assigned_person_team, current_process_step, hold_reason, rfq_state, required_next_action, last_manual_update, last_system_update",
          isOpen: true,
          isActive: true,
        }),
        getEngineers<Engineer>({
          select: "id, name, photo_path, restrictions",
          isActive: true,
          role: "shop",
        }),
        getEngineerAbsences<Absence>({
          select: "engineer_id, absence_date",
          fromDate: today,
        }),
      ]);

      const filtered = data.filter(
        (o) => o.current_process_step !== READY_TO_CLOSE_STEP,
      );
      const qualifiedFiltered = applyTodayQualificationBlocks(
        filtered,
        engineerData,
        absenceData,
        today,
      );

      setOrders(sortOrders(qualifiedFiltered));
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
      const sectionTargets = [activeSectionRef.current, blockedSectionRef.current]
        .map((section) => {
          if (!section) return null;
          return Math.max(0, section.offsetTop - 18);
        })
        .filter((target): target is number => target !== null && target <= maxScroll);

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
          fontSize: "34px",
          fontWeight: 800,
        }}
      >
        Loading shop wall...
      </main>
    );
  }

  const nonBlockedOrders = orders.filter((o) => !isBlocked(o));
  const blockedOrders = orders.filter((o) => isBlocked(o));
  const engineerByName = new Map(engineers.map((e) => [e.name, e]));

  const cardStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns:
      "minmax(190px, 0.85fr) minmax(220px, 1.05fr) minmax(220px, 1fr) 140px 150px",
    gap: "12px",
    alignItems: "center",
    minHeight: "96px",
    padding: "12px 14px",
    borderRadius: "8px",
    border: `1px solid ${COLORS.border}`,
    backgroundColor: COLORS.panel,
    boxShadow: "0 10px 24px rgba(20, 24, 31, 0.07)",
  };

  const labelStyle: React.CSSProperties = {
    marginBottom: "4px",
    color: COLORS.muted,
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  };

  function priorityStyle(order: WorkOrder): React.CSSProperties {
    const base: React.CSSProperties = {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      minWidth: "82px",
      padding: "8px 14px",
      borderRadius: "8px",
      fontSize: "16px",
      fontWeight: 800,
      border: `1px solid ${COLORS.borderStrong}`,
    };

    if (order.priority === "AOG") {
      return {
        ...base,
        color: COLORS.red,
        backgroundColor: COLORS.redSoft,
        borderColor: "#f3b2ad",
      };
    }

    if (order.priority === "Yes") {
      return {
        ...base,
        color: COLORS.amber,
        backgroundColor: COLORS.amberSoft,
        borderColor: "#efc48f",
      };
    }

    return {
      ...base,
      color: COLORS.muted,
      backgroundColor: COLORS.soft,
    };
  }

  function prioLabel(order: WorkOrder): string | null {
    if (order.priority === "AOG") return "AOG";
    if (order.priority === "Yes") return "PRIO";
    return null;
  }

  function holdReasonDisplay(o: WorkOrder): string {
    if (o.hold_reason) return o.hold_reason;
    const rfqState = normalizeRfqState(o.rfq_state);
    if (rfqState === "rfq rejected") return "RFQ Rejected";
    if (rfqState === "rfq send") return "Waiting for RFQ Approval";
    return "-";
  }

  function renderOrderCard(order: WorkOrder, blocked = false) {
    const assignedPersonTeam = normalizeAssignedPersonTeam(order.assigned_person_team);
    const engineer = engineerByName.get(assignedPersonTeam);
    const statusColor = blocked ? COLORS.red : COLORS.green;

    return (
      <article
        key={order.work_order_id}
        style={{
          ...cardStyle,
          borderLeft: `8px solid ${statusColor}`,
          backgroundColor:
            order.priority === "AOG"
              ? "#fff8f7"
              : order.priority === "Yes"
                ? "#fffaf2"
                : COLORS.panel,
        }}
      >
        <div>
          <div style={labelStyle}>Work order</div>
          <div
            style={{
              color: COLORS.ink,
              fontSize: "24px",
              fontWeight: 800,
              lineHeight: 1.02,
              overflowWrap: "anywhere",
            }}
          >
            {order.work_order_id}
          </div>
          <div
            style={{
              marginTop: "4px",
              color: COLORS.muted,
              fontSize: "16px",
              fontWeight: 700,
              lineHeight: 1.12,
              overflowWrap: "anywhere",
            }}
          >
            {order.part_number || "-"}
          </div>
        </div>

        <div>
          <div style={labelStyle}>Customer</div>
          <div
            style={{
              color: COLORS.ink,
              fontSize: "20px",
              fontWeight: 700,
              lineHeight: 1.08,
              overflowWrap: "anywhere",
            }}
          >
            {order.customer || "-"}
          </div>
        </div>

        <div>
          <div style={labelStyle}>{blocked ? "Hold reason" : "Next step"}</div>
          <div
            style={{
              color: blocked ? COLORS.red : COLORS.blue,
              fontSize: "22px",
              fontWeight: 800,
              lineHeight: 1.12,
              overflowWrap: "anywhere",
            }}
          >
            {blocked ? holdReasonDisplay(order) : order.current_process_step || "-"}
          </div>
          {!blocked && (
            <div
              style={{
                marginTop: "6px",
                color: COLORS.muted,
                fontSize: "15px",
                fontWeight: 750,
                lineHeight: 1.15,
                overflowWrap: "anywhere",
              }}
            >
              {order.work_order_type || "-"}
            </div>
          )}
        </div>

        <div
          style={{
            display: "grid",
            alignSelf: "stretch",
            visibility: blocked ? "hidden" : "visible",
            alignContent: "center",
            justifyItems: "center",
          }}
        >
          <AssignedPerson
            name={assignedPersonTeam}
            photoUrl={getEngineerPhotoUrl(engineer?.photo_path)}
          />
        </div>

        <div
          style={{
            display: "grid",
            gap: "4px",
            justifyItems: "center",
            textAlign: "center",
          }}
        >
          {prioLabel(order) && (
            <span style={priorityStyle(order)}>{prioLabel(order)}</span>
          )}
          <div>
            <div style={{ ...labelStyle, marginBottom: "4px", fontSize: "11px" }}>
              Due on
            </div>
            <div
              style={{
                color: COLORS.ink,
                fontSize: "18px",
                fontWeight: 800,
                whiteSpace: "nowrap",
              }}
            >
              {formatDate(order.due_date)}
            </div>
          </div>
        </div>
      </article>
    );
  }

  function renderOrderSection(
    title: string,
    subtitle: string,
    list: WorkOrder[],
    blocked = false,
    ref?: React.Ref<HTMLElement>,
  ) {
    return (
      <section ref={ref}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "14px",
            padding: "8px 12px",
            borderRadius: "8px",
            color: COLORS.ink,
            backgroundColor: COLORS.panel,
            border: `1px solid ${blocked ? "#f2b2ad" : COLORS.border}`,
            boxShadow: "0 8px 20px rgba(20, 24, 31, 0.05)",
          }}
        >
          <div style={{ display: "grid", gap: "2px" }}>
            <h2
              style={{
                margin: 0,
                fontSize: "20px",
                lineHeight: 1,
                fontWeight: 800,
              }}
            >
              {title}
            </h2>
            <div
              style={{
                fontSize: "12px",
                fontWeight: 600,
                color: COLORS.muted,
              }}
            >
              {subtitle}
            </div>
          </div>
          <div
            style={{
              minWidth: "48px",
              textAlign: "center",
              padding: "6px 10px",
              borderRadius: "8px",
              backgroundColor: blocked ? COLORS.redSoft : COLORS.greenSoft,
              color: blocked ? COLORS.red : COLORS.green,
              fontSize: "22px",
              fontWeight: 800,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {list.length}
          </div>
        </div>

        {list.length === 0 ? (
          <div
            style={{
              marginTop: "14px",
              padding: "18px",
              borderRadius: "8px",
              backgroundColor: COLORS.panel,
              border: `1px dashed ${COLORS.borderStrong}`,
              color: COLORS.muted,
              fontSize: "16px",
              fontWeight: 700,
              textAlign: "center",
            }}
          >
            Nothing here right now.
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr",
              gap: "6px",
              marginTop: "8px",
            }}
          >
            {list.map((order) => renderOrderCard(order, blocked))}
          </div>
        )}
      </section>
    );
  }

  return (
    <main
      style={{
        height: "100vh",
        overflow: "hidden",
        backgroundColor: COLORS.pageBg,
        color: COLORS.ink,
        fontFamily: FONT_STACK,
      }}
    >
      <div
        ref={scrollerRef}
        style={{
          height: "100vh",
          overflowY: "hidden",
          padding: "14px",
        }}
      >
        <div
          ref={contentRef}
          style={{
            display: "grid",
            gap: "14px",
            willChange: "transform",
          }}
        >
          {renderOrderSection(
            "Open",
            "Work orders that can be worked on",
            nonBlockedOrders,
            false,
            activeSectionRef,
          )}
          {renderOrderSection(
            "Blocked",
            "Work orders that cannot be worked on",
            blockedOrders,
            true,
            blockedSectionRef,
          )}
        </div>
      </div>
    </main>
  );
}
