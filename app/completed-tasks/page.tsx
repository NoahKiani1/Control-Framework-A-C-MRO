"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { PageHeader } from "@/app/components/page-header";
import { RequireRole } from "@/app/components/require-role";
import { CompletedTask, getCompletedTasks } from "@/lib/completed-tasks";
import { normalizeAssignedPersonTeam } from "@/lib/work-order-rules";

const COLORS = {
  pageBg: "#f2efe9",
  panelBg: "#ffffff",
  cardBg: "#faf8f3",
  border: "#e2ddd1",
  borderStrong: "#ccc4b4",
  text: "#1f2937",
  textSoft: "#5f6b7c",
  textMuted: "#8590a0",
  green: "#166534",
  greenSoft: "#eef9f1",
  blue: "#2555c7",
  blueSoft: "#eef3ff",
  amber: "#b45309",
  amberSoft: "#fff6e8",
  inputBg: "#fffdf9",
  shadow: "0 1px 2px rgba(31, 41, 55, 0.04), 0 4px 12px rgba(31, 41, 55, 0.04)",
};

const FONT_STACK = "var(--font-inter), var(--font-geist-sans), sans-serif";

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, "0");
  return [
    `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  ].join(" ");
}

function taskTypeLabel(task: CompletedTask): string {
  return task.task_type === "corrective_action"
    ? "Work Order Related"
    : "Additional Task";
}

function taskTypeTone(task: CompletedTask) {
  return task.task_type === "corrective_action"
    ? { color: COLORS.amber, bg: COLORS.amberSoft }
    : { color: COLORS.blue, bg: COLORS.blueSoft };
}

function CompletedTasksContent() {
  const [tasks, setTasks] = useState<CompletedTask[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    const nextTasks = await getCompletedTasks();
    setTasks(nextTasks);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTasks();
  }, [loadTasks]);

  return (
    <main
      style={{
        minHeight: "100vh",
        backgroundColor: COLORS.pageBg,
        padding: "var(--layout-page-py) var(--layout-page-px) var(--layout-page-px)",
        fontFamily: FONT_STACK,
        color: COLORS.text,
      }}
    >
      <div className="app-page-shell">
        <PageHeader
          title="Completed Tasks"
          description="Closed corrective actions and additional tasks from the last 30 days."
        />

        <section
          style={{
            overflow: "hidden",
            border: `1px solid ${COLORS.border}`,
            borderRadius: 8,
            background: COLORS.panelBg,
            boxShadow: COLORS.shadow,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "var(--gap-default)",
              padding: "12px 14px",
              borderBottom: `1px solid ${COLORS.border}`,
              background: COLORS.cardBg,
              flexWrap: "wrap",
            }}
          >
            <h2 style={{ margin: 0, fontSize: "var(--fs-heading)", fontWeight: 700 }}>
              Completed task log
            </h2>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 820, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: COLORS.cardBg }}>
                  {[
                    "Type",
                    "Created date",
                    "Task Description",
                    "Assigned person / team",
                    "Closed date",
                  ].map((heading) => (
                    <th
                      key={heading}
                      style={{
                        padding: "10px 12px",
                        borderBottom: `1px solid ${COLORS.border}`,
                        color: COLORS.textMuted,
                        fontSize: "var(--fs-meta)",
                        fontWeight: 750,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} style={emptyCellStyle}>
                      Loading completed tasks...
                    </td>
                  </tr>
                ) : tasks.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={emptyCellStyle}>
                      No completed tasks in the last 30 days.
                    </td>
                  </tr>
                ) : (
                  tasks.map((task) => {
                    const tone = taskTypeTone(task);
                    return (
                      <tr key={task.id}>
                        <td style={cellStyle}>
                          <span
                            style={{
                              display: "inline-flex",
                              flexDirection: task.source_work_order_id ? "column" : "row",
                              gap: task.source_work_order_id ? 2 : 0,
                              alignItems: task.source_work_order_id ? "flex-start" : "center",
                              padding: task.source_work_order_id ? "6px 10px" : "4px 8px",
                              borderRadius: 6,
                              background: tone.bg,
                              color: tone.color,
                              fontSize: "var(--fs-sm)",
                              fontWeight: 700,
                              whiteSpace: "nowrap",
                            }}
                          >
                            <span>{taskTypeLabel(task)}</span>
                            {task.source_work_order_id && (
                              <span
                                style={{
                                  color: COLORS.textSoft,
                                  fontSize: "var(--fs-meta)",
                                  fontWeight: 650,
                                }}
                              >
                                WO ID: {task.source_work_order_id}
                              </span>
                            )}
                          </span>
                        </td>
                        <td style={cellStyle}>{formatDateTime(task.created_at)}</td>
                        <td style={{ ...cellStyle, minWidth: 260, color: COLORS.text }}>
                          {task.required_next_action}
                        </td>
                        <td style={cellStyle}>
                          {normalizeAssignedPersonTeam(task.assigned_person_team)}
                        </td>
                        <td style={cellStyle}>{formatDateTime(task.closed_at)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

const cellStyle = {
  padding: "11px 12px",
  borderBottom: `1px solid ${COLORS.border}`,
  color: COLORS.textSoft,
  fontSize: "var(--fs-body)",
  lineHeight: 1.45,
} satisfies CSSProperties;

const emptyCellStyle = {
  ...cellStyle,
  padding: "28px 12px",
  textAlign: "center",
  color: COLORS.textMuted,
} satisfies CSSProperties;

export default function CompletedTasksPage() {
  return (
    <RequireRole allowedRoles={["office"]}>
      <CompletedTasksContent />
    </RequireRole>
  );
}
