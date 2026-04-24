"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import { RequireRole } from "@/app/components/require-role";
import {
  INTAKE_STEP,
  getActiveStepsForType,
  getInitialProcessStepForOrder,
  getProcessStepsForType,
} from "@/lib/process-steps";
import {
  isOlderThanOneYear,
  mapWorkOrderType,
  normalizeImportedRfqState,
  parseExcelDate,
} from "@/lib/import-normalize";
import {
  normalizeAssignedPersonTeam,
  normalizePriorityValue,
} from "@/lib/work-order-rules";
import { getEngineers } from "@/lib/engineers";
import {
  clearImportRuns,
  createImportRun,
  deleteWorkOrdersByIds,
  getExistingWorkOrderIds,
  getWorkOrders,
  insertWorkOrders,
  upsertWorkOrders,
} from "@/lib/work-orders";
import { PageHeader } from "@/app/components/page-header";

type ParsedRow = {
  work_order_id: string;
  customer: string | null;
  rfq_state: string | null;
  last_system_update: string | null;
  is_open: boolean;
  work_order_type: string | null;
  part_number: string | null;
};

type StaffMember = {
  id: number;
  name: string;
  role: string | null;
  employment_start_date?: string | null;
};

type StepVariant = "standard" | "custom";

type NewOrderSetup = {
  is_active: boolean;
  priority: string;
  due_date: string;
  assigned_person_team: string;
  step_variant: StepVariant;
  included_steps: string[];
};

function defaultIncludedStepsForType(workOrderType: string | null): string[] {
  return getActiveStepsForType(workOrderType, false);
}

function normalizeIncludedSteps(
  workOrderType: string | null,
  selected: string[],
): string[] {
  const template = getProcessStepsForType(workOrderType);
  if (template.length === 0) return [];

  const selectedSet = new Set(selected);
  const ordered = template.filter(
    (step) => selectedSet.has(step) || step === INTAKE_STEP,
  );
  return ordered;
}

type ExistingOrderSnapshot = ParsedRow & {
  is_active: boolean;
  current_process_step: string | null;
  assigned_person_team: string | null;
  included_process_steps: string[] | null;
};

type RfqActivationCandidate = ParsedRow & {
  previous_rfq_state: string | null;
  current_process_step: string | null;
  assigned_person_team: string | null;
};

function normalizeRfqForComparison(state: string | null | undefined): string {
  return (state || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function isRfqApprovedState(state: string | null | undefined): boolean {
  const rfq = normalizeRfqForComparison(state);
  return (
    rfq === "rfq send - continue" ||
    rfq === "rfq approved" ||
    rfq === "rfq accepted"
  );
}

function ImportPageContent() {
  const [status, setStatus] = useState("");
  const [step, setStep] = useState<"upload" | "review" | "done">("upload");
  const [newOrders, setNewOrders] = useState<ParsedRow[]>([]);
  const [existingOrders, setExistingOrders] = useState<ParsedRow[]>([]);
  const [shopStaff, setShopStaff] = useState<StaffMember[]>([]);
  const [newOrderSetup, setNewOrderSetup] = useState<Record<string, NewOrderSetup>>({});
  const [rfqActivationCandidates, setRfqActivationCandidates] = useState<RfqActivationCandidate[]>([]);
  const [rfqActivationSetup, setRfqActivationSetup] = useState<Record<string, boolean>>({});
  const [oldIds, setOldIds] = useState<string[]>([]);
  const [closedIds, setClosedIds] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [tooOld, setTooOld] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [closedSkipped, setClosedSkipped] = useState(0);
  const [results, setResults] = useState<{
    processed: number;
    inserted: number;
    updated: number;
    deleted: number;
    closedRemoved: number;
    closedSkipped: number;
    rfqActivated: number;
    tooOld: number;
    skipped: number;
  } | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatus("Reading file...");
    setFileName(file.name);

    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet);

    let skipCount = 0;
    let oldCount = 0;
    let closedCount = 0;
    const tempOldIds: string[] = [];
    const tempClosedIds: string[] = [];
    const parsed: ParsedRow[] = [];

    for (const row of rows) {
      const workOrderId = String(row["Work Order"] || "").trim();
      if (!workOrderId) {
        skipCount++;
        continue;
      }

      if (isOlderThanOneYear(row["CreatedOn"])) {
        tempOldIds.push(workOrderId);
        oldCount++;
        continue;
      }

      const closeDate = parseExcelDate(row["Close Date"]);

      if (closeDate) {
        tempClosedIds.push(workOrderId);
        closedCount++;
        continue;
      }

      const customer = String(row["Customer"] || "").trim();
      const rfqState = String(row["RFQ State"] || "").trim();
      const compType = String(row["Comp. Type"] || "").trim();
      const description = String(row["Description"] || "").trim();
      const partNumber = String(row["Comp. Pn"] || "").trim();

      parsed.push({
        work_order_id: workOrderId,
        customer: customer || null,
        rfq_state: normalizeImportedRfqState(rfqState),
        last_system_update: parseExcelDate(row["LastUpdatedOn"]),
        is_open: true,
        work_order_type: mapWorkOrderType(compType, description),
        part_number: partNumber || null,
      });
    }

    setSkipped(skipCount);
    setTooOld(oldCount);
    setOldIds(tempOldIds);
    setClosedIds(tempClosedIds);
    setClosedSkipped(closedCount);

    setStatus("Checking existing orders...");
    const ids = parsed.map((r) => r.work_order_id);
    const [existingOrderIds, staffData] = await Promise.all([
      getExistingWorkOrderIds(ids),
      getEngineers<StaffMember>({
        select: "id, name, role",
        isActive: true,
        startedOn: new Date().toISOString().split("T")[0],
        orderBy: { column: "name" },
      }),
    ]);
    const existingIds = new Set(existingOrderIds);

    const newOnes = parsed.filter((r) => !existingIds.has(r.work_order_id));
    const existingOnes = parsed.filter((r) => existingIds.has(r.work_order_id));
    const existingSnapshots = existingOnes.length
      ? await getWorkOrders<ExistingOrderSnapshot>({
          select:
            "work_order_id, customer, rfq_state, last_system_update, is_open, work_order_type, part_number, is_active, current_process_step, assigned_person_team, included_process_steps",
          workOrderIds: existingOnes.map((r) => r.work_order_id),
        })
      : [];
    const existingSnapshotMap = new Map(
      existingSnapshots.map((order) => [order.work_order_id, order]),
    );
    const approvedInactiveOrders = existingOnes
      .map((order) => {
        const current = existingSnapshotMap.get(order.work_order_id);
        if (!current || current.is_active) return null;
        if (!isRfqApprovedState(order.rfq_state)) return null;
        if (isRfqApprovedState(current.rfq_state)) return null;

        return {
          ...order,
          previous_rfq_state: current.rfq_state,
          current_process_step: current.current_process_step,
          assigned_person_team: current.assigned_person_team,
        };
      })
      .filter(Boolean) as RfqActivationCandidate[];

    setShopStaff(staffData.filter((s) => s.role === "shop"));
    setNewOrders(newOnes);
    setNewOrderSetup(
      Object.fromEntries(
        newOnes.map((order) => [
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
    setRfqActivationCandidates(approvedInactiveOrders);
    setRfqActivationSetup(
      Object.fromEntries(
        approvedInactiveOrders.map((order) => [order.work_order_id, true]),
      ),
    );
    setExistingOrders(existingOnes);
    setStep("review");
    setStatus("");
  }

  function updateNewOrderSetup(
    workOrderId: string,
    patch: Partial<NewOrderSetup>,
  ) {
    const order = newOrders.find((o) => o.work_order_id === workOrderId);
    const defaultSetup: NewOrderSetup = {
      is_active: false,
      priority: "No",
      due_date: "",
      assigned_person_team: "",
      step_variant: "standard",
      included_steps: defaultIncludedStepsForType(order?.work_order_type ?? null),
    };

    setNewOrderSetup((prev) => ({
      ...prev,
      [workOrderId]: {
        ...defaultSetup,
        ...prev[workOrderId],
        ...patch,
      },
    }));
  }

  function setVariantForOrder(workOrderId: string, variant: StepVariant) {
    const order = newOrders.find((o) => o.work_order_id === workOrderId);
    setNewOrderSetup((prev) => {
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
    setNewOrderSetup((prev) => {
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

  function setAllNewOrdersActive(isActive: boolean) {
    setNewOrderSetup((prev) =>
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

  function setAllRfqApprovedOrdersActive(isActive: boolean) {
    setRfqActivationSetup(
      Object.fromEntries(
        rfqActivationCandidates.map((order) => [order.work_order_id, isActive]),
      ),
    );
  }

  async function doImport() {
    const missingDueDate = newOrders.find((order) => {
      const setup = newOrderSetup[order.work_order_id];
      return (
        setup?.is_active &&
        (setup.priority === "Yes" || setup.priority === "AOG") &&
        !setup.due_date
      );
    });

    if (missingDueDate) {
      setStatus(
        `Error: Due Date is required for priority work order ${missingDueDate.work_order_id}.`,
      );
      return;
    }

    setStatus("Importing...");

    const batchSize = 500;
    const importTimestamp = new Date().toISOString();
    let updated = 0;
    let rfqActivated = 0;

    // 1. Update existing orders — only bump last_system_update when data changed
    const existingIds = existingOrders.map((r) => r.work_order_id);
    const currentData = await getWorkOrders<ExistingOrderSnapshot>({
      select:
        "work_order_id, customer, rfq_state, last_system_update, is_open, work_order_type, part_number, is_active, current_process_step, assigned_person_team, included_process_steps",
      workOrderIds: existingIds,
    });

    const currentMap = new Map(
      currentData.map((r) => [r.work_order_id, r]),
    );

    for (let i = 0; i < existingOrders.length; i += batchSize) {
      const batch = existingOrders.slice(i, i + batchSize).map((r) => {
        const current = currentMap.get(r.work_order_id);
        const shouldActivateFromRfq =
          Boolean(rfqActivationSetup[r.work_order_id]) &&
          Boolean(current) &&
          !current?.is_active;
        const shouldDefaultAssigned =
          Boolean(current?.is_active || shouldActivateFromRfq) &&
          !current?.assigned_person_team?.trim();
        const changed =
          !current ||
          current.customer !== r.customer ||
          current.rfq_state !== r.rfq_state ||
          current.work_order_type !== r.work_order_type ||
          current.part_number !== r.part_number ||
          shouldActivateFromRfq ||
          shouldDefaultAssigned;

        if (shouldActivateFromRfq) {
          rfqActivated += 1;
        }

        return {
          ...r,
          ...(shouldActivateFromRfq
            ? {
                is_active: true,
                current_process_step:
                  current?.current_process_step ||
                  getInitialProcessStepForOrder(
                    current?.work_order_type || r.work_order_type,
                    current?.included_process_steps ?? null,
                  ),
                assigned_person_team: normalizeAssignedPersonTeam(
                  current?.assigned_person_team,
                ),
              }
            : shouldDefaultAssigned
              ? {
                  assigned_person_team: normalizeAssignedPersonTeam(
                    current?.assigned_person_team,
                  ),
                }
              : {}),
          last_system_update: changed ? importTimestamp : r.last_system_update,
        };
      });
      const { error } = await upsertWorkOrders(batch);

      if (error) {
        setStatus(`Error: ${error.message}`);
        return;
      }
      updated += batch.length;
    }

    // 2. Insert new orders
    let inserted = 0;
    for (let i = 0; i < newOrders.length; i += batchSize) {
      const batch = newOrders.slice(i, i + batchSize).map((r) => {
        const setup = newOrderSetup[r.work_order_id];
        const isActive = setup?.is_active || false;
        const includedSteps =
          setup?.included_steps &&
          normalizeIncludedSteps(r.work_order_type, setup.included_steps);
        return {
          ...r,
          is_active: isActive,
          priority: normalizePriorityValue(setup?.priority),
          due_date: setup?.due_date || null,
          assigned_person_team:
            (setup?.assigned_person_team || "").trim() ||
            (isActive ? normalizeAssignedPersonTeam(null) : null),
          included_process_steps:
            includedSteps && includedSteps.length > 0 ? includedSteps : null,
          current_process_step: isActive
            ? getInitialProcessStepForOrder(
                r.work_order_type,
                includedSteps ?? null,
              )
            : null,
          last_system_update: importTimestamp,
        };
      });

      const { error } = await insertWorkOrders(batch);

      if (error) {
        setStatus(`Error: ${error.message}`);
        return;
      }
      inserted += batch.length;
    }

    // 3. Remove orders older than 1 year
    let deleted = 0;
    for (let i = 0; i < oldIds.length; i += batchSize) {
      const batch = oldIds.slice(i, i + batchSize);
      await deleteWorkOrdersByIds(batch);
      deleted += batch.length;
    }

    // 4. Remove closed work orders from database (based on Excel Close Date)
    let closedRemoved = 0;
    for (let i = 0; i < closedIds.length; i += batchSize) {
      const batch = closedIds.slice(i, i + batchSize);
      const { count } = await deleteWorkOrdersByIds(batch, { withCount: true });
      closedRemoved += count || 0;
    }

    // 5. Clean up old import logs and create new one
    await clearImportRuns();

    await createImportRun({
      filename: fileName,
      rows_processed:
        newOrders.length + existingOrders.length + tooOld + skipped + closedSkipped,
      rows_inserted: inserted,
      rows_updated: updated,
      status: "done",
    });

    setResults({
      processed:
        newOrders.length + existingOrders.length + tooOld + skipped + closedSkipped,
      inserted,
      updated,
      deleted,
      closedRemoved,
      closedSkipped,
      rfqActivated,
      tooOld,
      skipped,
    });
    setStep("done");
    setStatus("Import complete!");
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

  const cellStyle: React.CSSProperties = {
    padding: "7px 10px",
    borderBottom: "1px solid #eee",
    fontSize: "var(--fs-body)",
    whiteSpace: "normal",
    overflowWrap: "anywhere",
    verticalAlign: "top",
    textAlign: "left",
  };

  const headerStyle: React.CSSProperties = {
    ...cellStyle,
    fontWeight: "bold",
    fontSize: "var(--fs-sm)",
    backgroundColor: "#f5f5f5",
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

  const newOrderFieldLabel: React.CSSProperties = {
    fontSize: "var(--fs-xs)",
    fontWeight: 700,
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginBottom: "4px",
  };

  return (
    <main style={{ minHeight: "100vh", backgroundColor: "#f2efe9", padding: "var(--layout-page-py) var(--layout-page-px) var(--layout-page-px)", fontFamily: "var(--font-inter), var(--font-geist-sans), sans-serif" }}>
      <div style={{ width: "100%", maxWidth: "var(--layout-content-max-w)", marginInline: "auto" }}>
      <PageHeader
        title="AcMP Import"
        description="Upload an AcMP Excel export (.xlsx). Closed and old orders will be automatically skipped and removed."
      />

      {step === "upload" && (
        <>
          <label
            style={{
              display: "inline-block",
              margin: "14px 0",
              padding: "9px 16px",
              backgroundColor: "#0070f3",
              color: "white",
              borderRadius: "6px",
              cursor: "pointer",
              fontWeight: "bold",
              fontSize: "var(--fs-body)",
            }}
          >
            Choose file
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFile}
              style={{ display: "none" }}
            />
          </label>
        </>
      )}

      {step === "review" && (
        <>
          <div
            style={{
              ...panelStyle,
              backgroundColor: "#f0f8ff",
              border: "1px solid #aad",
            }}
          >
            <strong>File analyzed: {fileName}</strong>
            <br />
            {existingOrders.length} existing orders (system fields will be updated, manual fields remain intact)
            <br />
            <strong>{newOrders.length} new open orders found</strong>
            <br />
            {rfqActivationCandidates.length > 0 && (
              <>
                <strong>
                  {rfqActivationCandidates.length} inactive work order
                  {rfqActivationCandidates.length !== 1 ? "s" : ""} now have RFQ approved
                </strong>
                <br />
              </>
            )}
            {closedSkipped > 0 && (
              <>
                {closedSkipped} closed orders (will be skipped + removed from database)
                <br />
              </>
            )}
            {tooOld > 0 && (
              <>
                {tooOld} orders older than 1 year (will be removed)
                <br />
              </>
            )}
            {skipped > 0 && (
              <>
                {skipped} skipped (no Work Order ID)
                <br />
              </>
            )}
          </div>

          {rfqActivationCandidates.length > 0 && (
            <div
              style={{
                ...panelStyle,
                backgroundColor: "#ecfdf5",
                border: "1px solid #86efac",
              }}
            >
              <strong>RFQ approved on inactive work orders</strong>
              <p style={{ margin: "8px 0 4px" }}>
                These inactive work orders now have an approved RFQ. Do you want to
                activate them during this import? Activated orders keep their current
                process step, or start at <strong>Disassembly</strong> if no step is set.
              </p>
              <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() => setAllRfqApprovedOrdersActive(true)}
                >
                  Activate all
                </button>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() => setAllRfqApprovedOrdersActive(false)}
                >
                  Keep all inactive
                </button>
              </div>
              <div style={{ overflowX: "auto", marginTop: "12px" }}>
                <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
                  <thead>
                    <tr>
                      <th style={headerStyle}>WO</th>
                      <th style={headerStyle}>Customer</th>
                      <th style={headerStyle}>Previous RFQ</th>
                      <th style={headerStyle}>New RFQ</th>
                      <th style={headerStyle}>Activate?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rfqActivationCandidates.map((order) => (
                      <tr key={order.work_order_id}>
                        <td style={{ ...cellStyle, fontWeight: 700 }}>
                          {order.work_order_id}
                        </td>
                        <td style={cellStyle}>{order.customer || "-"}</td>
                        <td style={cellStyle}>{order.previous_rfq_state || "-"}</td>
                        <td style={cellStyle}>{order.rfq_state || "-"}</td>
                        <td style={cellStyle}>
                          <select
                            style={inputStyle}
                            value={rfqActivationSetup[order.work_order_id] ? "yes" : "no"}
                            onChange={(e) =>
                              setRfqActivationSetup((prev) => ({
                                ...prev,
                                [order.work_order_id]: e.target.value === "yes",
                              }))
                            }
                          >
                            <option value="yes">Yes</option>
                            <option value="no">No</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {newOrders.length > 0 && (
            <div
              style={{
                ...panelStyle,
                backgroundColor: "#fff8e0",
                border: "1px solid #dda",
              }}
            >
              <strong>Set up new work orders</strong>
              <p style={{ margin: "8px 0 4px" }}>
                Choose which new orders should become active right away. Active
                orders start at <strong>Disassembly</strong> and can be assigned here,
                so you do not need to open Office Update after importing.
              </p>
              <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() => setAllNewOrdersActive(true)}
                >
                  Mark all active
                </button>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() => setAllNewOrdersActive(false)}
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
                    newOrderSetup[order.work_order_id] || {
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
                        <div style={newOrderFieldLabel}>Work order</div>
                        <div style={{ fontWeight: 700, fontSize: "var(--fs-md)", overflowWrap: "anywhere" }}>
                          {order.work_order_id}
                        </div>
                      </div>

                      <div style={{ minWidth: 0 }}>
                        <div style={newOrderFieldLabel}>Customer</div>
                        <div style={{ fontWeight: 600, fontSize: "var(--fs-body)", overflowWrap: "anywhere" }}>{order.customer || "-"}</div>
                      </div>

                      <div style={{ minWidth: 0 }}>
                        <div style={newOrderFieldLabel}>Part number</div>
                        <div style={{ fontWeight: 600, fontSize: "var(--fs-body)", overflowWrap: "anywhere" }}>{order.part_number || "-"}</div>
                      </div>

                      <div>
                        <div style={newOrderFieldLabel}>Active</div>
                        <select
                          style={inputStyle}
                          value={setup.is_active ? "yes" : "no"}
                          onChange={(e) =>
                            updateNewOrderSetup(order.work_order_id, {
                              is_active: e.target.value === "yes",
                            })
                          }
                        >
                          <option value="no">No</option>
                          <option value="yes">Yes</option>
                        </select>
                      </div>

                      <div>
                        <div style={newOrderFieldLabel}>Priority</div>
                        <select
                          style={inputStyle}
                          value={setup.priority}
                          disabled={!setup.is_active}
                          onChange={(e) =>
                            updateNewOrderSetup(order.work_order_id, {
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
                        <div style={newOrderFieldLabel}>Due date</div>
                        <input
                          type="date"
                          style={{
                            ...inputStyle,
                            borderColor: dueRequired && !setup.due_date
                              ? "#dc2626"
                              : "#cbd5e1",
                          }}
                          value={setup.due_date}
                          disabled={!setup.is_active}
                          onChange={(e) =>
                            updateNewOrderSetup(order.work_order_id, {
                              due_date: e.target.value,
                            })
                          }
                        />
                      </div>

                      <div>
                        <div style={newOrderFieldLabel}>Assigned to</div>
                        <select
                          style={inputStyle}
                          value={setup.assigned_person_team}
                          disabled={!setup.is_active}
                          onChange={(e) =>
                            updateNewOrderSetup(order.work_order_id, {
                              assigned_person_team: e.target.value,
                            })
                          }
                        >
                          <option value="">Shop</option>
                          {shopStaff.map((staff) => (
                            <option key={staff.id} value={staff.name}>
                              {staff.name}
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
                          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                            <button
                              type="button"
                              onClick={() =>
                                setVariantForOrder(
                                  order.work_order_id,
                                  "standard",
                                )
                              }
                              style={{
                                padding: "6px 14px",
                                borderRadius: "6px",
                                border: `1px solid ${setup.step_variant === "standard" ? "#2555c7" : "#cbd5e1"}`,
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
                                setVariantForOrder(
                                  order.work_order_id,
                                  "custom",
                                )
                              }
                              style={{
                                padding: "6px 14px",
                                borderRadius: "6px",
                                border: `1px solid ${setup.step_variant === "custom" ? "#b45309" : "#cbd5e1"}`,
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

          <button style={buttonStyle} onClick={doImport}>
            Import now
          </button>
        </>
      )}

      {step === "done" && results && (
        <>
          <table style={{ borderCollapse: "collapse", marginTop: "1rem" }}>
            <tbody>
              <tr>
                <td style={{ padding: "4px 10px", fontSize: "var(--fs-body)" }}>Rows in file</td>
                <td>{results.processed}</td>
              </tr>
              <tr>
                <td style={{ padding: "4px 10px", fontSize: "var(--fs-body)" }}>Newly inserted</td>
                <td>{results.inserted}</td>
              </tr>
              <tr>
                <td style={{ padding: "4px 10px", fontSize: "var(--fs-body)" }}>Updated</td>
                <td>{results.updated}</td>
              </tr>
              <tr>
                <td style={{ padding: "4px 10px", fontSize: "var(--fs-body)" }}>
                  Activated after RFQ approval
                </td>
                <td>{results.rfqActivated}</td>
              </tr>
              <tr>
                <td style={{ padding: "4px 10px", fontSize: "var(--fs-body)" }}>Closed orders skipped</td>
                <td>{results.closedSkipped}</td>
              </tr>
              <tr>
                <td style={{ padding: "4px 10px", fontSize: "var(--fs-body)" }}>
                  Closed orders removed from database
                </td>
                <td>{results.closedRemoved}</td>
              </tr>
              <tr>
                <td style={{ padding: "4px 10px", fontSize: "var(--fs-body)" }}>Removed (older than 1 year)</td>
                <td>{results.deleted}</td>
              </tr>
              <tr>
                <td style={{ padding: "4px 10px", fontSize: "var(--fs-body)" }}>Skipped (no ID)</td>
                <td>{results.skipped}</td>
              </tr>
            </tbody>
          </table>

          <button
            style={{ ...buttonStyle, marginTop: "1rem", backgroundColor: "#666" }}
            onClick={() => {
              setStep("upload");
              setResults(null);
              setStatus("");
              setNewOrders([]);
              setExistingOrders([]);
              setNewOrderSetup({});
              setRfqActivationCandidates([]);
              setRfqActivationSetup({});
              setOldIds([]);
              setClosedIds([]);
            }}
          >
            Start new import
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

export default function ImportPage() {
  return (
    <RequireRole allowedRoles={["office"]}>
      <ImportPageContent />
    </RequireRole>
  );
}
