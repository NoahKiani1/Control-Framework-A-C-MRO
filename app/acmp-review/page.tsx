"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RequireRole } from "@/app/components/require-role";
import { PageHeader } from "@/app/components/page-header";
import {
  INTAKE_STEP,
  getProcessStepsForType,
} from "@/lib/process-steps";
import {
  getAbsentEngineerIdSetForDateKey,
  getEngineerAbsences,
  getEngineers,
} from "@/lib/engineers";
import {
  activateRfqApprovedWorkOrder,
  applyNewOrderInserts,
  defaultIncludedStepsForType,
  findMissingDueDateOrder,
  normalizeIncludedSteps,
} from "@/lib/acmp-import/apply";
import {
  deletePendingAcmpWorkOrdersByIds,
  getPendingAcmpWorkOrders,
  pruneStalePendingAcmpWorkOrders,
} from "@/lib/acmp-import/pending";
import {
  NewOrderSetup,
  ParsedRow,
  PendingAcmpWorkOrder,
  StepVariant,
} from "@/lib/acmp-import/types";

type StaffMember = {
  id: number;
  name: string;
  role: string | null;
  employment_start_date?: string | null;
};

type Absence = {
  engineer_id: number;
  absence_date: string;
};

type RfqDecision = "activate" | "keep_inactive";

function pendingToParsedRow(row: PendingAcmpWorkOrder): ParsedRow {
  return {
    work_order_id: row.work_order_id,
    customer: row.customer,
    rfq_state: row.rfq_state,
    last_system_update: row.last_system_update,
    is_open: row.is_open,
    work_order_type: row.work_order_type,
    part_number: row.part_number,
  };
}

function AcmpReviewContent() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [newOrders, setNewOrders] = useState<PendingAcmpWorkOrder[]>([]);
  const [rfqOrders, setRfqOrders] = useState<PendingAcmpWorkOrder[]>([]);
  const [shopStaff, setShopStaff] = useState<StaffMember[]>([]);
  const [todayAbsentEngineerIds, setTodayAbsentEngineerIds] = useState<number[]>([]);
  const [setupByOrder, setSetupByOrder] = useState<Record<string, NewOrderSetup>>({});
  const [rfqDecisionByOrder, setRfqDecisionByOrder] = useState<
    Record<string, RfqDecision>
  >({});
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;

    async function load() {
      const today = new Date().toISOString().split("T")[0];
      const pending = await getPendingAcmpWorkOrders();

      if (pending.length === 0) {
        if (active) {
          setNewOrders([]);
          setRfqOrders([]);
          setLoading(false);
        }
        return;
      }

      const prunedCount = await pruneStalePendingAcmpWorkOrders(
        pending
          .filter((row) => row.review_type === "new_work_order")
          .map((row) => row.work_order_id),
      );

      const stillPending =
        prunedCount > 0 ? await getPendingAcmpWorkOrders() : pending;

      if (!active) return;

      const nextNewOrders = stillPending.filter(
        (row) => row.review_type === "new_work_order",
      );
      const nextRfqOrders = stillPending.filter(
        (row) => row.review_type === "rfq_approved_inactive",
      );

      if (stillPending.length === 0) {
        setNewOrders([]);
        setRfqOrders([]);
        setLoading(false);
        return;
      }

      const [staffData, absenceData] = nextNewOrders.length
        ? await Promise.all([
            getEngineers<StaffMember>({
              select: "id, name, role",
              isActive: true,
              startedOn: today,
              orderBy: { column: "name" },
            }),
            getEngineerAbsences<Absence>({
              select: "engineer_id, absence_date",
              fromDate: today,
            }),
          ])
        : [[], []];

      if (!active) return;

      setNewOrders(nextNewOrders);
      setRfqOrders(nextRfqOrders);
      setShopStaff(
        (staffData as StaffMember[]).filter((s) => s.role === "shop"),
      );
      setTodayAbsentEngineerIds(
        Array.from(
          getAbsentEngineerIdSetForDateKey(absenceData as Absence[], today),
        ),
      );
      setSetupByOrder(
        Object.fromEntries(
          nextNewOrders.map((order) => [
            order.work_order_id,
            {
              is_active: true,
              priority: "No",
              due_date: "",
              assigned_person_team: "",
              step_variant: "standard" as StepVariant,
              included_steps: defaultIncludedStepsForType(order.work_order_type),
            },
          ]),
        ),
      );
      setRfqDecisionByOrder(
        Object.fromEntries(
          nextRfqOrders.map((order) => [order.work_order_id, "activate"]),
        ),
      );
      setLoading(false);
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  function updateSetup(workOrderId: string, patch: Partial<NewOrderSetup>) {
    const order = newOrders.find((o) => o.work_order_id === workOrderId);
    const fallback: NewOrderSetup = {
      is_active: false,
      priority: "No",
      due_date: "",
      assigned_person_team: "",
      step_variant: "standard",
      included_steps: defaultIncludedStepsForType(order?.work_order_type ?? null),
    };
    setSetupByOrder((prev) => ({
      ...prev,
      [workOrderId]: {
        ...fallback,
        ...prev[workOrderId],
        ...patch,
      },
    }));
  }

  function setVariantForOrder(workOrderId: string, variant: StepVariant) {
    const order = newOrders.find((o) => o.work_order_id === workOrderId);
    setSetupByOrder((prev) => {
      const existing = prev[workOrderId];
      const includedSteps =
        variant === "standard"
          ? defaultIncludedStepsForType(order?.work_order_type ?? null)
          : existing?.included_steps ??
            defaultIncludedStepsForType(order?.work_order_type ?? null);
      return {
        ...prev,
        [workOrderId]: {
          ...(existing || {
            is_active: false,
            priority: "No",
            due_date: "",
            assigned_person_team: "",
            step_variant: "standard" as StepVariant,
            included_steps: includedSteps,
          }),
          step_variant: variant,
          included_steps: includedSteps,
        },
      };
    });
  }

  function toggleCustomStep(
    workOrderId: string,
    workOrderType: string | null,
    step: string,
    checked: boolean,
  ) {
    setSetupByOrder((prev) => {
      const existing = prev[workOrderId];
      if (!existing) return prev;
      const current = new Set(existing.included_steps);
      if (checked) current.add(step);
      else current.delete(step);
      return {
        ...prev,
        [workOrderId]: {
          ...existing,
          included_steps: normalizeIncludedSteps(
            workOrderType,
            Array.from(current),
          ),
        },
      };
    });
  }

  function setAllActive(isActive: boolean) {
    setSetupByOrder((prev) =>
      Object.fromEntries(
        newOrders.map((order) => [
          order.work_order_id,
          {
            is_active: isActive,
            priority: prev[order.work_order_id]?.priority || "No",
            due_date: prev[order.work_order_id]?.due_date || "",
            assigned_person_team:
              prev[order.work_order_id]?.assigned_person_team || "",
            step_variant: prev[order.work_order_id]?.step_variant || "standard",
            included_steps:
              prev[order.work_order_id]?.included_steps ||
              defaultIncludedStepsForType(order.work_order_type),
          },
        ]),
      ),
    );
  }

  function setAllRfqDecisions(decision: RfqDecision) {
    setRfqDecisionByOrder(
      Object.fromEntries(
        rfqOrders.map((order) => [order.work_order_id, decision]),
      ),
    );
  }

  async function doSave() {
    if (saving) return;

    const parsedNewOrders = newOrders.map(pendingToParsedRow);
    const missing = findMissingDueDateOrder(parsedNewOrders, setupByOrder);
    if (missing) {
      setStatus(
        `Error: Due Date is required for priority work order ${missing.work_order_id}.`,
      );
      return;
    }

    setSaving(true);
    setStatus("Saving...");

    const nowTimestamp = new Date().toISOString();

    if (parsedNewOrders.length > 0) {
      const { error: insertError } = await applyNewOrderInserts({
        newOrders: parsedNewOrders,
        newOrderSetup: setupByOrder,
        importTimestamp: nowTimestamp,
      });

      if (insertError) {
        setSaving(false);
        setStatus(`Error: ${insertError.message}`);
        return;
      }

      const { error: deleteError } = await deletePendingAcmpWorkOrdersByIds(
        parsedNewOrders.map((r) => r.work_order_id),
      );

      if (deleteError) {
        setSaving(false);
        setStatus(
          `Saved but failed to clear pending rows: ${deleteError.message}`,
        );
        return;
      }
    }

    for (const order of rfqOrders) {
      const decision = rfqDecisionByOrder[order.work_order_id] ?? "activate";

      if (decision === "activate") {
        const { error: activationError } = await activateRfqApprovedWorkOrder({
          workOrderId: order.work_order_id,
          activationTimestamp: nowTimestamp,
        });

        if (activationError) {
          setSaving(false);
          setStatus(
            `Error activating ${order.work_order_id}: ${activationError.message}`,
          );
          return;
        }
      }

      const { error: deleteError } = await deletePendingAcmpWorkOrdersByIds([
        order.work_order_id,
      ]);

      if (deleteError) {
        setSaving(false);
        setStatus(
          `Saved but failed to clear pending row ${order.work_order_id}: ${deleteError.message}`,
        );
        return;
      }
    }

    router.replace("/dashboard");
  }

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

  const secondaryButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    backgroundColor: "#4b5563",
    padding: "8px 12px",
    fontSize: "var(--fs-sm)",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    minWidth: 0,
    padding: "6px 10px",
    border: "1px solid #cbd5e1",
    borderRadius: "8px",
    fontSize: "var(--fs-body)",
    boxSizing: "border-box",
    backgroundColor: "#fffefb",
  };

  const panelStyle: React.CSSProperties = {
    marginBottom: "12px",
    padding: "var(--card-py) var(--card-px)",
    borderRadius: "10px",
    fontSize: "var(--fs-body)",
  };

  const newOrderCardStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns:
      "minmax(140px, 0.9fr) minmax(180px, 1.1fr) minmax(130px, 0.8fr) repeat(4, minmax(100px, 0.6fr))",
    gap: "10px",
    alignItems: "start",
    padding: "12px 14px",
    border: "1px solid #e5dccb",
    borderRadius: "10px",
    backgroundColor: "#fffef9",
    minWidth: 0,
  };

  const rfqCardStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns:
      "minmax(120px, 0.8fr) minmax(140px, 1fr) minmax(140px, 1fr) minmax(130px, 0.8fr) minmax(130px, 0.8fr) minmax(140px, 0.9fr) minmax(140px, 0.9fr) minmax(130px, 0.7fr)",
    gap: "10px",
    alignItems: "start",
    padding: "12px 14px",
    border: "1px solid #e5dccb",
    borderRadius: "10px",
    backgroundColor: "#fffef9",
    minWidth: 0,
  };

  const fieldLabel: React.CSSProperties = {
    fontSize: "var(--fs-xs)",
    fontWeight: 700,
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginBottom: "4px",
  };

  const totalPending = newOrders.length + rfqOrders.length;

  return (
    <main
      style={{
        minHeight: "100vh",
        backgroundColor: "#f2efe9",
        padding:
          "var(--layout-page-py) var(--layout-page-px) var(--layout-page-px)",
        fontFamily: "var(--font-inter), var(--font-geist-sans), sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "var(--layout-content-max-w)",
          marginInline: "auto",
        }}
      >
        <PageHeader
          title="AcMP Review"
          description="Configure new AcMP work orders and decide what to do with inactive work orders whose RFQ was just approved. Nothing is written to the work order list until you save."
        />

        {loading && (
          <p style={{ marginTop: "1rem" }}>
            <strong>Loading pending AcMP work orders...</strong>
          </p>
        )}

        {!loading && totalPending === 0 && (
          <div
            style={{
              ...panelStyle,
              backgroundColor: "#ecfdf5",
              border: "1px solid #86efac",
            }}
          >
            <strong>No pending AcMP work orders.</strong>
            <p style={{ margin: "8px 0 12px" }}>
              There is nothing waiting for review.
            </p>
            <button
              type="button"
              style={buttonStyle}
              onClick={() => router.replace("/dashboard")}
            >
              Go to Dashboard
            </button>
          </div>
        )}

        {!loading && totalPending > 0 && (
          <>
            {newOrders.length > 0 && (
              <div
                style={{
                  ...panelStyle,
                  backgroundColor: "#fff8e0",
                  border: "1px solid #dda",
                }}
              >
                <strong>
                  {newOrders.length} new AcMP work order
                  {newOrders.length !== 1 ? "s" : ""} waiting for review
                </strong>
                <p style={{ margin: "8px 0 4px" }}>
                  Choose which new orders should become active right away.
                  Active orders start at <strong>Disassembly</strong> and can be
                  assigned here, so you do not need to open Office Update after
                  saving.
                </p>
                <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                  <button
                    type="button"
                    style={secondaryButtonStyle}
                    onClick={() => setAllActive(true)}
                  >
                    Mark all active
                  </button>
                  <button
                    type="button"
                    style={secondaryButtonStyle}
                    onClick={() => setAllActive(false)}
                  >
                    Mark all inactive
                  </button>
                </div>
                <div
                  style={{
                    display: "grid",
                    gap: "10px",
                    marginTop: "14px",
                  }}
                >
                  {newOrders.map((order) => {
                    const setup =
                      setupByOrder[order.work_order_id] || {
                        is_active: false,
                        priority: "No",
                        due_date: "",
                        assigned_person_team: "",
                        step_variant: "standard" as StepVariant,
                        included_steps: defaultIncludedStepsForType(
                          order.work_order_type,
                        ),
                      };
                    const dueRequired =
                      setup.is_active &&
                      (setup.priority === "Yes" || setup.priority === "AOG");
                    const templateSteps = getProcessStepsForType(
                      order.work_order_type,
                    );
                    const customStepOptions = templateSteps.filter(
                      (step) => step !== INTAKE_STEP,
                    );
                    const includedSet = new Set(setup.included_steps);

                    return (
                      <div key={order.work_order_id} style={newOrderCardStyle}>
                        <div style={{ minWidth: 0 }}>
                          <div style={fieldLabel}>Work order</div>
                          <div
                            style={{
                              fontWeight: 700,
                              fontSize: "var(--fs-md)",
                              overflowWrap: "anywhere",
                            }}
                          >
                            {order.work_order_id}
                          </div>
                        </div>

                        <div style={{ minWidth: 0 }}>
                          <div style={fieldLabel}>Customer</div>
                          <div
                            style={{
                              fontWeight: 600,
                              fontSize: "var(--fs-body)",
                              overflowWrap: "anywhere",
                            }}
                          >
                            {order.customer || "-"}
                          </div>
                        </div>

                        <div style={{ minWidth: 0 }}>
                          <div style={fieldLabel}>Part number</div>
                          <div
                            style={{
                              fontWeight: 600,
                              fontSize: "var(--fs-body)",
                              overflowWrap: "anywhere",
                            }}
                          >
                            {order.part_number || "-"}
                          </div>
                        </div>

                        <div>
                          <div style={fieldLabel}>Active</div>
                          <select
                            style={inputStyle}
                            value={setup.is_active ? "yes" : "no"}
                            onChange={(e) =>
                              updateSetup(order.work_order_id, {
                                is_active: e.target.value === "yes",
                              })
                            }
                          >
                            <option value="no">No</option>
                            <option value="yes">Yes</option>
                          </select>
                        </div>

                        <div>
                          <div style={fieldLabel}>Priority</div>
                          <select
                            style={inputStyle}
                            value={setup.priority}
                            disabled={!setup.is_active}
                            onChange={(e) =>
                              updateSetup(order.work_order_id, {
                                priority: e.target.value,
                              })
                            }
                          >
                            <option value="No">No</option>
                            <option value="Yes">PRIO</option>
                            <option value="AOG">AOG</option>
                          </select>
                        </div>

                        <div>
                          <div style={fieldLabel}>Due date</div>
                          <input
                            type="date"
                            style={{
                              ...inputStyle,
                              borderColor:
                                dueRequired && !setup.due_date
                                  ? "#dc2626"
                                  : "#cbd5e1",
                            }}
                            value={setup.due_date}
                            disabled={!setup.is_active}
                            onChange={(e) =>
                              updateSetup(order.work_order_id, {
                                due_date: e.target.value,
                              })
                            }
                          />
                        </div>

                        <div>
                          <div style={fieldLabel}>Assigned to</div>
                          <select
                            style={inputStyle}
                            value={setup.assigned_person_team}
                            disabled={!setup.is_active}
                            onChange={(e) =>
                              updateSetup(order.work_order_id, {
                                assigned_person_team: e.target.value,
                              })
                            }
                          >
                            <option value="">Shop</option>
                            {shopStaff.map((staff) => (
                              <option
                                key={staff.id}
                                value={staff.name}
                                disabled={todayAbsentEngineerIds.includes(staff.id)}
                              >
                                {staff.name}
                                {todayAbsentEngineerIds.includes(staff.id)
                                  ? " (absent today)"
                                  : ""}
                              </option>
                            ))}
                          </select>
                        </div>

                        {setup.is_active && order.work_order_type && (
                          <div
                            style={{
                              gridColumn: "1 / -1",
                              borderTop: "1px dashed #e5dccb",
                              paddingTop: "10px",
                              display: "grid",
                              gap: "10px",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                gap: "6px",
                                flexWrap: "wrap",
                              }}
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  setVariantForOrder(order.work_order_id, "standard")
                                }
                                style={{
                                  padding: "6px 14px",
                                  borderRadius: "6px",
                                  border: `1px solid ${
                                    setup.step_variant === "standard"
                                      ? "#2555c7"
                                      : "#cbd5e1"
                                  }`,
                                  backgroundColor:
                                    setup.step_variant === "standard"
                                      ? "#eef3ff"
                                      : "#fffefb",
                                  color:
                                    setup.step_variant === "standard"
                                      ? "#2555c7"
                                      : "#4b5563",
                                  fontWeight: 700,
                                  fontSize: "var(--fs-sm)",
                                  cursor: "pointer",
                                }}
                              >
                                Standard {order.work_order_type}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setVariantForOrder(order.work_order_id, "custom")
                                }
                                style={{
                                  padding: "6px 14px",
                                  borderRadius: "6px",
                                  border: `1px solid ${
                                    setup.step_variant === "custom"
                                      ? "#b45309"
                                      : "#cbd5e1"
                                  }`,
                                  backgroundColor:
                                    setup.step_variant === "custom"
                                      ? "#fff6e8"
                                      : "#fffefb",
                                  color:
                                    setup.step_variant === "custom"
                                      ? "#b45309"
                                      : "#4b5563",
                                  fontWeight: 700,
                                  fontSize: "var(--fs-sm)",
                                  cursor: "pointer",
                                }}
                              >
                                Custom — add or remove task
                              </button>
                            </div>

                            {setup.step_variant === "custom" && (
                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns:
                                    "repeat(auto-fill, minmax(180px, 1fr))",
                                  gap: "6px 12px",
                                  padding: "10px 12px",
                                  backgroundColor: "#fffdfa",
                                  border: "1px solid #e5dccb",
                                  borderRadius: "8px",
                                }}
                              >
                                {customStepOptions.map((step) => (
                                  <label
                                    key={step}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "8px",
                                      fontSize: "var(--fs-sm)",
                                      color: "#1f2937",
                                      cursor: "pointer",
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={includedSet.has(step)}
                                      onChange={(e) =>
                                        toggleCustomStep(
                                          order.work_order_id,
                                          order.work_order_type,
                                          step,
                                          e.target.checked,
                                        )
                                      }
                                    />
                                    {step}
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {rfqOrders.length > 0 && (
              <div
                style={{
                  ...panelStyle,
                  backgroundColor: "#ecfdf5",
                  border: "1px solid #86efac",
                }}
              >
                <strong>
                  {rfqOrders.length} inactive work order
                  {rfqOrders.length !== 1 ? "s" : ""} with RFQ approved
                </strong>
                <p style={{ margin: "8px 0 4px" }}>
                  RFQ just became approved/continue for these inactive work
                  orders. Choose whether to activate them now or keep them
                  inactive. Activating preserves the current process step and
                  assignee when set; otherwise defaults match a new activation.
                </p>
                <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                  <button
                    type="button"
                    style={secondaryButtonStyle}
                    onClick={() => setAllRfqDecisions("activate")}
                  >
                    Activate all
                  </button>
                  <button
                    type="button"
                    style={secondaryButtonStyle}
                    onClick={() => setAllRfqDecisions("keep_inactive")}
                  >
                    Keep all inactive
                  </button>
                </div>
                <div
                  style={{
                    display: "grid",
                    gap: "10px",
                    marginTop: "14px",
                  }}
                >
                  {rfqOrders.map((order) => {
                    const decision =
                      rfqDecisionByOrder[order.work_order_id] ?? "activate";
                    return (
                      <div key={order.work_order_id} style={rfqCardStyle}>
                        <div style={{ minWidth: 0 }}>
                          <div style={fieldLabel}>Work order</div>
                          <div
                            style={{
                              fontWeight: 700,
                              fontSize: "var(--fs-md)",
                              overflowWrap: "anywhere",
                            }}
                          >
                            {order.work_order_id}
                          </div>
                        </div>

                        <div style={{ minWidth: 0 }}>
                          <div style={fieldLabel}>Customer</div>
                          <div
                            style={{
                              fontWeight: 600,
                              fontSize: "var(--fs-body)",
                              overflowWrap: "anywhere",
                            }}
                          >
                            {order.customer || "-"}
                          </div>
                        </div>

                        <div style={{ minWidth: 0 }}>
                          <div style={fieldLabel}>Part number</div>
                          <div
                            style={{
                              fontWeight: 600,
                              fontSize: "var(--fs-body)",
                              overflowWrap: "anywhere",
                            }}
                          >
                            {order.part_number || "-"}
                          </div>
                        </div>

                        <div style={{ minWidth: 0 }}>
                          <div style={fieldLabel}>Previous RFQ</div>
                          <div
                            style={{
                              fontSize: "var(--fs-body)",
                              overflowWrap: "anywhere",
                            }}
                          >
                            {order.previous_rfq_state || "-"}
                          </div>
                        </div>

                        <div style={{ minWidth: 0 }}>
                          <div style={fieldLabel}>New RFQ</div>
                          <div
                            style={{
                              fontSize: "var(--fs-body)",
                              fontWeight: 600,
                              overflowWrap: "anywhere",
                            }}
                          >
                            {order.rfq_state || "-"}
                          </div>
                        </div>

                        <div style={{ minWidth: 0 }}>
                          <div style={fieldLabel}>Current step</div>
                          <div
                            style={{
                              fontSize: "var(--fs-body)",
                              overflowWrap: "anywhere",
                            }}
                          >
                            {order.current_process_step || "-"}
                          </div>
                        </div>

                        <div style={{ minWidth: 0 }}>
                          <div style={fieldLabel}>Assigned to</div>
                          <div
                            style={{
                              fontSize: "var(--fs-body)",
                              overflowWrap: "anywhere",
                            }}
                          >
                            {order.assigned_person_team || "-"}
                          </div>
                        </div>

                        <div>
                          <div style={fieldLabel}>Decision</div>
                          <select
                            style={inputStyle}
                            value={decision}
                            onChange={(e) =>
                              setRfqDecisionByOrder((prev) => ({
                                ...prev,
                                [order.work_order_id]:
                                  e.target.value as RfqDecision,
                              }))
                            }
                          >
                            <option value="activate">Activate</option>
                            <option value="keep_inactive">Keep inactive</option>
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <button style={buttonStyle} onClick={doSave} disabled={saving}>
              {saving ? "Saving..." : "Save and continue"}
            </button>
          </>
        )}

        {status && (
          <p style={{ marginTop: "1rem" }}>
            <strong>{status}</strong>
          </p>
        )}
      </div>
    </main>
  );
}

export default function AcmpReviewPage() {
  return (
    <RequireRole allowedRoles={["office"]}>
      <AcmpReviewContent />
    </RequireRole>
  );
}
