"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import { RequireRole } from "@/app/components/require-role";
import { PageHeader } from "@/app/components/page-header";
import {
  analyzeImportRows,
} from "@/lib/acmp-import/analyze";
import {
  applyDeletions,
  applyExistingOrderUpdates,
  finalizeClosedWorkOrderReports,
  recordImportRun,
} from "@/lib/acmp-import/apply";
import {
  PendingAcmpInsertRow,
  upsertPendingAcmpWorkOrders,
} from "@/lib/acmp-import/pending";
import {
  ImportAnalysis,
  ParsedRow,
  RfqActivationCandidate,
} from "@/lib/acmp-import/types";

type ImportResults = {
  processed: number;
  updated: number;
  deleted: number;
  closedRemoved: number;
  closedSkipped: number;
  tooOld: number;
  skipped: number;
  pendingNewWorkOrders: number;
  pendingRfqApprovedInactive: number;
};

function buildNewOrderPendingRows(
  newOrders: ParsedRow[],
  rawByWorkOrderId: Record<string, Record<string, unknown>>,
  filename: string,
): PendingAcmpInsertRow[] {
  return newOrders.map((order) => ({
    work_order_id: order.work_order_id,
    customer: order.customer,
    rfq_state: order.rfq_state,
    last_system_update: order.last_system_update,
    is_open: order.is_open,
    work_order_type: order.work_order_type,
    part_number: order.part_number,
    source_filename: filename || null,
    raw_payload: (rawByWorkOrderId[order.work_order_id] as
      | Record<string, unknown>
      | undefined) || null,
    review_type: "new_work_order",
    previous_rfq_state: null,
    current_process_step: null,
    assigned_person_team: null,
  }));
}

function buildRfqApprovedInactivePendingRows(
  candidates: RfqActivationCandidate[],
  rawByWorkOrderId: Record<string, Record<string, unknown>>,
  filename: string,
): PendingAcmpInsertRow[] {
  return candidates.map((order) => ({
    work_order_id: order.work_order_id,
    customer: order.customer,
    rfq_state: order.rfq_state,
    last_system_update: order.last_system_update,
    is_open: order.is_open,
    work_order_type: order.work_order_type,
    part_number: order.part_number,
    source_filename: filename || null,
    raw_payload: (rawByWorkOrderId[order.work_order_id] as
      | Record<string, unknown>
      | undefined) || null,
    review_type: "rfq_approved_inactive",
    previous_rfq_state: order.previous_rfq_state,
    current_process_step: order.current_process_step,
    assigned_person_team: order.assigned_person_team,
  }));
}

function ImportPageContent() {
  const [status, setStatus] = useState("");
  const [step, setStep] = useState<"upload" | "review" | "done">("upload");
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [fileName, setFileName] = useState("");
  const [results, setResults] = useState<ImportResults | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatus("Reading file...");
    setFileName(file.name);

    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet);

    setStatus("Analyzing rows...");
    const result = await analyzeImportRows(rows);

    setAnalysis(result);
    setStep("review");
    setStatus("");
  }

  async function doImport() {
    if (!analysis) return;

    setStatus("Importing...");

    const importTimestamp = new Date().toISOString();

    const {
      updated,
      error: updateError,
    } = await applyExistingOrderUpdates({
      existingOrders: analysis.existingOrders,
      importTimestamp,
    });

    if (updateError) {
      setStatus(`Error: ${updateError.message}`);
      return;
    }

    const pendingRows: PendingAcmpInsertRow[] = [
      ...buildNewOrderPendingRows(
        analysis.newOrders,
        analysis.rawByWorkOrderId,
        fileName,
      ),
      ...buildRfqApprovedInactivePendingRows(
        analysis.rfqActivationCandidates,
        analysis.rawByWorkOrderId,
        fileName,
      ),
    ];

    if (pendingRows.length > 0) {
      const { error: pendingError } =
        await upsertPendingAcmpWorkOrders(pendingRows);

      if (pendingError) {
        setStatus(
          `Error saving pending AcMP review rows: ${pendingError.message}`,
        );
        return;
      }
    }

    await finalizeClosedWorkOrderReports({
      closedWorkOrders: analysis.closedWorkOrders,
    });

    const { deleted, closedRemoved } = await applyDeletions({
      oldIds: analysis.oldIds,
      closedIds: analysis.closedIds,
    });

    await recordImportRun({
      filename: fileName,
      rowsProcessed:
        analysis.newOrders.length +
        analysis.existingOrders.length +
        analysis.tooOld +
        analysis.skipped +
        analysis.closedSkipped,
      rowsInserted: 0,
      rowsUpdated: updated,
    });

    const pendingNewWorkOrders = analysis.newOrders.length;
    const pendingRfqApprovedInactive = analysis.rfqActivationCandidates.length;

    setResults({
      processed:
        analysis.newOrders.length +
        analysis.existingOrders.length +
        analysis.tooOld +
        analysis.skipped +
        analysis.closedSkipped,
      updated,
      deleted,
      closedRemoved,
      closedSkipped: analysis.closedSkipped,
      tooOld: analysis.tooOld,
      skipped: analysis.skipped,
      pendingNewWorkOrders,
      pendingRfqApprovedInactive,
    });
    setStep("done");

    const parts: string[] = [];
    if (pendingNewWorkOrders > 0) {
      parts.push(
        `${pendingNewWorkOrders} new work order${
          pendingNewWorkOrders === 1 ? "" : "s"
        }`,
      );
    }
    if (pendingRfqApprovedInactive > 0) {
      parts.push(
        `${pendingRfqApprovedInactive} RFQ-approved inactive work order${
          pendingRfqApprovedInactive === 1 ? "" : "s"
        }`,
      );
    }
    setStatus(
      parts.length > 0
        ? `Import complete. ${parts.join(" and ")} added to AcMP Review.`
        : "Import complete!",
    );
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

  const panelStyle: React.CSSProperties = {
    marginBottom: "12px",
    padding: "var(--card-py) var(--card-px)",
    borderRadius: "10px",
    fontSize: "var(--fs-body)",
  };

  const newOrders = analysis?.newOrders ?? [];
  const existingOrders = analysis?.existingOrders ?? [];
  const rfqActivationCandidates: RfqActivationCandidate[] =
    analysis?.rfqActivationCandidates ?? [];
  const tooOld = analysis?.tooOld ?? 0;
  const closedSkipped = analysis?.closedSkipped ?? 0;
  const skipped = analysis?.skipped ?? 0;

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
          title="AcMP Import"
          description="Upload an AcMP Excel export (.xlsx). Closed and old orders are skipped and removed. New work orders and RFQ-approved inactive work orders are sent to AcMP Review for Office to review."
        />

        {step === "upload" && (
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
        )}

        {step === "review" && analysis && (
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
              {existingOrders.length} existing orders (system fields will be
              updated, manual fields remain intact)
              <br />
              <strong>
                {newOrders.length} new open order
                {newOrders.length === 1 ? "" : "s"} found — will be added to
                AcMP Review
              </strong>
              <br />
              {rfqActivationCandidates.length > 0 && (
                <>
                  <strong>
                    {rfqActivationCandidates.length} inactive work order
                    {rfqActivationCandidates.length !== 1 ? "s" : ""} now have
                    RFQ approved — will be added to AcMP Review
                  </strong>
                  <br />
                </>
              )}
              {closedSkipped > 0 && (
                <>
                  {closedSkipped} closed orders (will be skipped + removed from
                  database)
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
                  These inactive work orders now have an approved RFQ. They
                  will be queued for AcMP Review so Office can choose to
                  activate them or keep them inactive.
                </p>
                <div style={{ overflowX: "auto", marginTop: "12px" }}>
                  <table
                    style={{
                      borderCollapse: "collapse",
                      width: "100%",
                      tableLayout: "fixed",
                    }}
                  >
                    <thead>
                      <tr>
                        <th style={headerStyle}>WO</th>
                        <th style={headerStyle}>Customer</th>
                        <th style={headerStyle}>Previous RFQ</th>
                        <th style={headerStyle}>New RFQ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rfqActivationCandidates.map((order) => (
                        <tr key={order.work_order_id}>
                          <td style={{ ...cellStyle, fontWeight: 700 }}>
                            {order.work_order_id}
                          </td>
                          <td style={cellStyle}>{order.customer || "-"}</td>
                          <td style={cellStyle}>
                            {order.previous_rfq_state || "-"}
                          </td>
                          <td style={cellStyle}>{order.rfq_state || "-"}</td>
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
                <strong>
                  {newOrders.length} new work order
                  {newOrders.length === 1 ? "" : "s"} will be queued for AcMP
                  Review
                </strong>
                <p style={{ margin: "8px 0 4px" }}>
                  After import you will be taken to AcMP Review to configure
                  each new work order (active, priority, due date, assignment,
                  process steps).
                </p>
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
                  <td style={{ padding: "4px 10px", fontSize: "var(--fs-body)" }}>
                    Rows in file
                  </td>
                  <td>{results.processed}</td>
                </tr>
                <tr>
                  <td style={{ padding: "4px 10px", fontSize: "var(--fs-body)" }}>
                    New work orders added to AcMP Review
                  </td>
                  <td>{results.pendingNewWorkOrders}</td>
                </tr>
                <tr>
                  <td style={{ padding: "4px 10px", fontSize: "var(--fs-body)" }}>
                    RFQ-approved inactive work orders added to AcMP Review
                  </td>
                  <td>{results.pendingRfqApprovedInactive}</td>
                </tr>
                <tr>
                  <td style={{ padding: "4px 10px", fontSize: "var(--fs-body)" }}>
                    Updated
                  </td>
                  <td>{results.updated}</td>
                </tr>
                <tr>
                  <td style={{ padding: "4px 10px", fontSize: "var(--fs-body)" }}>
                    Closed orders skipped
                  </td>
                  <td>{results.closedSkipped}</td>
                </tr>
                <tr>
                  <td style={{ padding: "4px 10px", fontSize: "var(--fs-body)" }}>
                    Closed orders removed from database
                  </td>
                  <td>{results.closedRemoved}</td>
                </tr>
                <tr>
                  <td style={{ padding: "4px 10px", fontSize: "var(--fs-body)" }}>
                    Removed (older than 1 year)
                  </td>
                  <td>{results.deleted}</td>
                </tr>
                <tr>
                  <td style={{ padding: "4px 10px", fontSize: "var(--fs-body)" }}>
                    Skipped (no ID)
                  </td>
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
                setAnalysis(null);
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
