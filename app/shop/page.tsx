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
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const AUTO_SCROLL_SPEED_PX_PER_SECOND = 18;
const AUTO_SCROLL_TOP_PAUSE_MS = 7000;
const AUTO_SCROLL_SECTION_PAUSE_MS = 5000;
const AUTO_SCROLL_BOTTOM_PAUSE_MS = 9000;

const COLORS = {
  pageBg: "#eef2f6",
  ink: "#111827",
  muted: "#526071",
  soft: "#f8fafc",
  panel: "#ffffff",
  border: "#cbd5e1",
  green: "#087f5b",
  greenBg: "#dff7ec",
  red: "#c92a2a",
  redBg: "#ffe3e3",
  amber: "#b7791f",
  amberBg: "#fff3bf",
  blue: "#1d4ed8",
  blueBg: "#dbeafe",
  dark: "#172033",
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

  if (!photoUrl || imageFailed) {
    return (
      <span
        style={{
          display: "block",
          color: COLORS.muted,
          fontSize: "22px",
          fontWeight: 900,
          lineHeight: 1.12,
          overflowWrap: "anywhere",
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
        justifyItems: "center",
        gap: "8px",
        color: COLORS.muted,
        fontSize: "18px",
        fontWeight: 900,
        lineHeight: 1.1,
      }}
    >
      <Image
        src={photoUrl}
        alt={displayName}
        width={92}
        height={92}
        unoptimized
        onError={() => setImageFailed(true)}
        style={{
          width: "92px",
          height: "92px",
          borderRadius: "50%",
          objectFit: "cover",
          flexShrink: 0,
          border: `3px solid ${COLORS.border}`,
          backgroundColor: COLORS.soft,
        }}
      />
      <span>{displayName}</span>
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

    function applyOffset(offset: number) {
      scrollContent.style.transform = `translate3d(0, -${offset}px, 0)`;
    }

    function getPauseTargets() {
      const maxScroll = Math.max(
        0,
        scrollContent.scrollHeight - scrollViewport.clientHeight,
      );
      const sectionTargets = [activeSectionRef.current, blockedSectionRef.current]
        .map((section) => {
          if (!section) return null;
          return Math.max(0, section.offsetTop - 18);
        })
        .filter((target): target is number => target !== null && target <= maxScroll);

      return [...new Set([0, ...sectionTargets, maxScroll])].sort((a, b) => a - b);
    }

    function tick(timestamp: number) {
      const maxScroll = Math.max(
        0,
        scrollContent.scrollHeight - scrollViewport.clientHeight,
      );

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
    gridTemplateColumns: "260px minmax(0, 1fr) minmax(340px, 1.05fr) 170px",
    gap: "24px",
    alignItems: "center",
    minHeight: "166px",
    padding: "24px 28px",
    borderRadius: "8px",
    border: `2px solid ${COLORS.border}`,
    backgroundColor: COLORS.panel,
    boxShadow: "0 8px 22px rgba(15, 23, 42, 0.08)",
  };

  const labelStyle: React.CSSProperties = {
    marginBottom: "8px",
    color: COLORS.muted,
    fontSize: "18px",
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  };

  function priorityStyle(order: WorkOrder): React.CSSProperties {
    const base: React.CSSProperties = {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      minWidth: "96px",
      padding: "10px 16px",
      borderRadius: "8px",
      fontSize: "24px",
      fontWeight: 900,
      border: `2px solid ${COLORS.border}`,
    };

    if (order.priority === "AOG") {
      return {
        ...base,
        color: COLORS.red,
        backgroundColor: COLORS.redBg,
        borderColor: "#ffc9c9",
      };
    }

    if (order.priority === "Yes") {
      return {
        ...base,
        color: COLORS.amber,
        backgroundColor: COLORS.amberBg,
        borderColor: "#ffe066",
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
    const statusBg = blocked ? COLORS.redBg : COLORS.greenBg;

    return (
      <article
        key={order.work_order_id}
        style={{
          ...cardStyle,
          borderLeft: `16px solid ${statusColor}`,
          backgroundColor:
            order.priority === "AOG"
              ? "#fff5f5"
              : order.priority === "Yes"
                ? "#fff9db"
                : COLORS.panel,
        }}
      >
        <div>
          <div style={labelStyle}>Work order</div>
          <div
            style={{
              color: COLORS.ink,
              fontSize: "38px",
              fontWeight: 950,
              lineHeight: 1.05,
              overflowWrap: "anywhere",
            }}
          >
            {order.work_order_id}
          </div>
          <div
            style={{
              marginTop: "12px",
              color: COLORS.muted,
              fontSize: "28px",
              fontWeight: 850,
              lineHeight: 1.12,
              overflowWrap: "anywhere",
            }}
          >
            {order.part_number || "-"}
          </div>
          <div
            style={{
              marginTop: "14px",
              display: "inline-flex",
              padding: "8px 12px",
              borderRadius: "8px",
              color: statusColor,
              backgroundColor: statusBg,
              fontSize: "20px",
              fontWeight: 900,
            }}
          >
            {blocked ? "BLOCKED" : "READY"}
          </div>
        </div>

        <div>
          <div style={labelStyle}>Customer</div>
          <div
            style={{
              color: COLORS.ink,
              fontSize: "34px",
              fontWeight: 850,
              lineHeight: 1.12,
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
              fontSize: "34px",
              fontWeight: 900,
              lineHeight: 1.12,
              overflowWrap: "anywhere",
            }}
          >
            {blocked ? holdReasonDisplay(order) : order.current_process_step || "-"}
          </div>
          <div
            style={{
              marginTop: "10px",
              color: COLORS.muted,
              fontSize: "23px",
              fontWeight: 750,
              lineHeight: 1.15,
              overflowWrap: "anywhere",
            }}
          >
            {blocked
              ? order.required_next_action || "Action required"
              : order.work_order_type || "-"}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gap: "14px",
            justifyItems: "center",
            textAlign: "center",
          }}
        >
          {prioLabel(order) && (
            <span style={priorityStyle(order)}>{prioLabel(order)}</span>
          )}
          <div>
            <div style={{ ...labelStyle, marginBottom: "6px", fontSize: "16px" }}>
              Due
            </div>
            <div
              style={{
                color: COLORS.ink,
                fontSize: "25px",
                fontWeight: 900,
                whiteSpace: "nowrap",
              }}
            >
              {formatDate(order.due_date)}
            </div>
          </div>
          {!blocked && (
            <AssignedPerson
              name={assignedPersonTeam}
              photoUrl={getEngineerPhotoUrl(engineer?.photo_path)}
            />
          )}
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
      <section ref={ref} style={{ marginTop: "26px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "24px",
            padding: "18px 22px",
            borderRadius: "8px",
            color: blocked ? "#ffffff" : COLORS.ink,
            backgroundColor: blocked ? COLORS.red : COLORS.blueBg,
            border: `2px solid ${blocked ? COLORS.red : "#bfdbfe"}`,
          }}
        >
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: "36px",
                lineHeight: 1,
                fontWeight: 950,
              }}
            >
              {title}
            </h2>
            <div
              style={{
                marginTop: "8px",
                fontSize: "22px",
                fontWeight: 750,
                color: blocked ? "#ffe3e3" : COLORS.muted,
              }}
            >
              {subtitle}
            </div>
          </div>
          <div
            style={{
              minWidth: "108px",
              textAlign: "center",
              padding: "12px 18px",
              borderRadius: "8px",
              backgroundColor: blocked ? "rgba(255,255,255,0.18)" : "#ffffff",
              fontSize: "40px",
              fontWeight: 950,
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
              padding: "30px",
              borderRadius: "8px",
              backgroundColor: COLORS.panel,
              border: `2px dashed ${COLORS.border}`,
              color: COLORS.muted,
              fontSize: "28px",
              fontWeight: 800,
              textAlign: "center",
            }}
          >
            Nothing here right now.
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gap: "14px",
              marginTop: "14px",
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
          padding: "26px",
        }}
      >
        <div
          ref={contentRef}
          style={{
            willChange: "transform",
          }}
        >
          {renderOrderSection(
            "Ready for shop",
            "Orders that can move now",
            nonBlockedOrders,
            false,
            activeSectionRef,
          )}
          {renderOrderSection(
            "Blocked",
            "Orders waiting for a decision, material, RFQ, or qualified engineer",
            blockedOrders,
            true,
            blockedSectionRef,
          )}
        </div>
      </div>
    </main>
  );
}
