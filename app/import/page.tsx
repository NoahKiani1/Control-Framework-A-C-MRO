"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import { dispatchAcmpPendingReviewRefresh } from "@/app/components/acmp-pending-events";
import { RequireRole } from "@/app/components/require-role";
import { PageHeader } from "@/app/components/page-header";
import { analyzeImportRows } from "@/lib/acmp-import/analyze";
import {
  type AcmpImportResult,
  runAcmpImportFromRows,
} from "@/lib/acmp-import/run";
import { createBufferSha256 } from "@/lib/acmp-import/signature";
import {
  ImportAnalysis,
  RfqActivationCandidate,
} from "@/lib/acmp-import/types";
import { supabase } from "@/lib/supabase";

type DropboxCandidate = {
  filename: string;
  exportDate: string | null;
  exportSequence: number;
  serverModified: string | null;
  pathLower: string;
};

type DropboxImportSummary = {
  candidatesFound?: number;
  deletedSuperseded?: number;
  processedFiles: number;
  ignoredDuplicateFiles: number;
  failedFiles: number;
  totals: AcmpImportResult;
};

function resultStatus(result: AcmpImportResult): string {
  const parts: string[] = [];
  if (result.pendingNewWorkOrders > 0) {
    parts.push(
      `${result.pendingNewWorkOrders} new work order${
        result.pendingNewWorkOrders === 1 ? "" : "s"
      }`,
    );
  }
  if (result.pendingRfqApprovedInactive > 0) {
    parts.push(
      `${result.pendingRfqApprovedInactive} RFQ-approved inactive work order${
        result.pendingRfqApprovedInactive === 1 ? "" : "s"
      }`,
    );
  }
  return parts.length > 0
    ? `Import complete. ${parts.join(" and ")} added to AcMP Review.`
    : "Import complete!";
}

function ImportPageContent() {
  const [status, setStatus] = useState("");
  const [step, setStep] = useState<"upload" | "review" | "done">("upload");
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [fileName, setFileName] = useState("");
  const [fileSha256, setFileSha256] = useState<string | null>(null);
  const [rowsToImport, setRowsToImport] = useState<Record<string, unknown>[]>(
    [],
  );
  const [results, setResults] = useState<AcmpImportResult | null>(null);
  const [dropboxStatus, setDropboxStatus] = useState("");
  const [dropboxCandidates, setDropboxCandidates] = useState<
    DropboxCandidate[]
  >([]);
  const [dropboxSummary, setDropboxSummary] =
    useState<DropboxImportSummary | null>(null);
  const [dropboxBusy, setDropboxBusy] = useState(false);

  async function authHeaders(): Promise<Record<string, string>> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token
      ? { Authorization: `Bearer ${session.access_token}` }
      : {};
  }

  async function fetchJson<T>(
    url: string,
    init: RequestInit = {},
  ): Promise<T> {
    const headers = {
      ...(await authHeaders()),
      ...(init.headers ?? {}),
    };
    const response = await fetch(url, { ...init, headers });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error?.message || "Request failed.");
    }
    return payload as T;
  }

  async function checkDropbox() {
    setDropboxBusy(true);
    setDropboxSummary(null);
    setDropboxStatus("Checking Dropbox...");
    try {
      const payload = await fetchJson<{ candidates: DropboxCandidate[] }>(
        "/api/acmp/dropbox/check",
      );
      setDropboxCandidates(payload.candidates);
      const newestCandidate = payload.candidates[0];
      if (!newestCandidate) {
        setDropboxStatus("No Dropbox AcMP exports found.");
      } else if (payload.candidates.length === 1) {
        setDropboxStatus(
          `Dropbox Excel export ready to import: ${newestCandidate.filename}.`,
        );
      } else {
        setDropboxStatus(
          `Multiple Excel exports found. The newest file will be imported: ${newestCandidate.filename}. Older Excel files will be deleted after successful import.`,
        );
      }
    } catch (error) {
      setDropboxStatus(
        error instanceof Error ? `Error: ${error.message}` : "Error checking Dropbox.",
      );
    } finally {
      setDropboxBusy(false);
    }
  }

  async function importDropboxNow() {
    setDropboxBusy(true);
      setDropboxStatus("Importing Dropbox Excel export...");
    try {
      const summary = await fetchJson<DropboxImportSummary>(
        "/api/acmp/dropbox/import",
        { method: "POST" },
      );
      setDropboxSummary(summary);
      setDropboxCandidates([]);
      setDropboxStatus(
        `Dropbox import complete. ${summary.processedFiles} processed, ${summary.ignoredDuplicateFiles} duplicate ignored, ${summary.failedFiles} failed.`,
      );
      dispatchAcmpPendingReviewRefresh();
    } catch (error) {
      setDropboxStatus(
        error instanceof Error ? `Error: ${error.message}` : "Error importing Dropbox exports.",
      );
    } finally {
      setDropboxBusy(false);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatus("Reading file...");
    setFileName(file.name);
    setFileSha256(null);
    setResults(null);

    const data = await file.arrayBuffer();
    const checksum = await createBufferSha256(data);
    const workbook = XLSX.read(data);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet);

    setRowsToImport(rows);
    setFileSha256(checksum);

    setStatus("Analyzing rows...");
    const result = await analyzeImportRows(rows);

    setAnalysis(result);
    setStep("review");
    setStatus("");
  }

  async function doImport() {
    if (!analysis || rowsToImport.length === 0) return;

    setStatus("Importing...");

    const importResult = await runAcmpImportFromRows({
      rows: rowsToImport,
      filename: fileName,
      sourceType: "manual",
      fileSha256,
    });

    if (importResult.error) {
      setStatus(`Error: ${importResult.error.message}`);
      return;
    }

    if (importResult.duplicate) {
      setStatus("This AcMP export has already been imported. No changes were made.");
      setStep("upload");
      setAnalysis(null);
      setRowsToImport([]);
      return;
    }

    if (!importResult.result) {
      setStatus("Import finished without result details.");
      return;
    }

    setResults(importResult.result);
    setStep("done");
    setStatus(resultStatus(importResult.result));
    dispatchAcmpPendingReviewRefresh();
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
    backgroundColor: "#f8fafc",
    color: "#1f2937",
    border: "1px solid #d1d5db",
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
    borderRadius: "8px",
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
          description="Import AcMP Excel exports from Dropbox or upload an Excel file manually as a fallback. New work orders and RFQ-approved inactive work orders are sent to AcMP Review."
        />

        <section
          style={{
            ...panelStyle,
            backgroundColor: "#ffffff",
            border: "1px solid #e5e7eb",
          }}
        >
          <h2
            style={{
              margin: "0 0 4px",
              fontSize: "var(--fs-heading)",
              color: "#1f2937",
            }}
          >
            Dropbox AcMP Import
          </h2>
          <p style={{ margin: "0 0 12px", color: "#475569" }}>
            Use this if you do not want to wait for the automatic 5-minute Dropbox sync.
          </p>
          <button
            type="button"
            style={buttonStyle}
            disabled={dropboxBusy}
            onClick={() => void checkDropbox()}
          >
            Check Dropbox now
          </button>

          {dropboxCandidates.length > 0 && (
            <div
              style={{
                marginTop: "12px",
                padding: "12px",
                borderRadius: "8px",
                border: "1px solid #bfdbfe",
                backgroundColor: "#eff6ff",
              }}
            >
              <strong>
                {dropboxCandidates.length === 1
                  ? "Dropbox Excel export ready"
                  : "Multiple Excel exports found"}
              </strong>
              {dropboxCandidates.length === 1 ? (
                <p style={{ margin: "8px 0" }}>{dropboxCandidates[0].filename}</p>
              ) : (
                <>
                  <p style={{ margin: "8px 0" }}>
                    The newest file will be imported:{" "}
                    <strong>{dropboxCandidates[0].filename}</strong>. Older
                    Excel files will be deleted after successful import.
                  </p>
                  <ul style={{ margin: "8px 0", paddingLeft: "18px" }}>
                    {dropboxCandidates.slice(1).map((candidate) => (
                      <li key={candidate.pathLower}>{candidate.filename}</li>
                    ))}
                  </ul>
                </>
              )}
              <p style={{ margin: "0 0 10px" }}>
                Import the newest Dropbox export now?
              </p>
              <button
                type="button"
                style={buttonStyle}
                disabled={dropboxBusy}
                onClick={() => void importDropboxNow()}
              >
                Import now
              </button>
            </div>
          )}

          {dropboxSummary && (
            <table style={{ borderCollapse: "collapse", marginTop: "12px" }}>
              <tbody>
                <tr>
                  <td style={cellStyle}>Processed files</td>
                  <td style={cellStyle}>{dropboxSummary.processedFiles}</td>
                </tr>
                <tr>
                  <td style={cellStyle}>Duplicate files ignored</td>
                  <td style={cellStyle}>{dropboxSummary.ignoredDuplicateFiles}</td>
                </tr>
                <tr>
                  <td style={cellStyle}>Failed files</td>
                  <td style={cellStyle}>{dropboxSummary.failedFiles}</td>
                </tr>
                {(dropboxSummary.deletedSuperseded ?? 0) > 0 && (
                  <tr>
                    <td style={cellStyle}>Superseded files deleted</td>
                    <td style={cellStyle}>
                      {dropboxSummary.deletedSuperseded}
                    </td>
                  </tr>
                )}
                <tr>
                  <td style={cellStyle}>New work orders added to AcMP Review</td>
                  <td style={cellStyle}>
                    {dropboxSummary.totals.pendingNewWorkOrders}
                  </td>
                </tr>
                <tr>
                  <td style={cellStyle}>
                    RFQ-approved inactive work orders added to AcMP Review
                  </td>
                  <td style={cellStyle}>
                    {dropboxSummary.totals.pendingRfqApprovedInactive}
                  </td>
                </tr>
              </tbody>
            </table>
          )}

          {dropboxStatus && (
            <p style={{ margin: "12px 0 0" }}>
              <strong>{dropboxStatus}</strong>
            </p>
          )}
        </section>

        <section
          style={{
            ...panelStyle,
            backgroundColor: "#ffffff",
            border: "1px solid #e5e7eb",
          }}
        >
          <h2
            style={{
              margin: "0 0 4px",
              fontSize: "var(--fs-heading)",
              color: "#1f2937",
            }}
          >
            Manual upload fallback
          </h2>
          <p style={{ margin: "0 0 10px", color: "#475569" }}>
            Upload an AcMP Excel export if Dropbox is unavailable or an emergency import is needed.
          </p>

          {step === "upload" && (
            <label
              style={{
                display: "inline-block",
                margin: "4px 0 0",
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
                  marginTop: "12px",
                }}
              >
                <strong>File analyzed: {fileName}</strong>
                <br />
                {existingOrders.length} existing orders (system fields will be
                updated, manual fields remain intact)
                <br />
                <strong>
                  {newOrders.length} new open order
                  {newOrders.length === 1 ? "" : "s"} found; will be added to
                  AcMP Review
                </strong>
                <br />
                {rfqActivationCandidates.length > 0 && (
                  <>
                    <strong>
                      {rfqActivationCandidates.length} inactive work order
                      {rfqActivationCandidates.length !== 1 ? "s" : ""} now
                      have RFQ approved; will be added to AcMP Review
                    </strong>
                    <br />
                  </>
                )}
                {closedSkipped > 0 && (
                  <>
                    {closedSkipped} closed orders (will be skipped and removed
                    from database)
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
                    After import, open AcMP Review to configure each new work order.
                  </p>
                </div>
              )}

              <button style={buttonStyle} onClick={() => void doImport()}>
                Import now
              </button>
            </>
          )}

          {step === "done" && results && (
            <>
              <table style={{ borderCollapse: "collapse", marginTop: "1rem" }}>
                <tbody>
                  <tr>
                    <td style={cellStyle}>Rows in file</td>
                    <td style={cellStyle}>{results.processed}</td>
                  </tr>
                  <tr>
                    <td style={cellStyle}>New work orders added to AcMP Review</td>
                    <td style={cellStyle}>{results.pendingNewWorkOrders}</td>
                  </tr>
                  <tr>
                    <td style={cellStyle}>
                      RFQ-approved inactive work orders added to AcMP Review
                    </td>
                    <td style={cellStyle}>
                      {results.pendingRfqApprovedInactive}
                    </td>
                  </tr>
                  <tr>
                    <td style={cellStyle}>Updated</td>
                    <td style={cellStyle}>{results.updated}</td>
                  </tr>
                  <tr>
                    <td style={cellStyle}>Closed orders skipped</td>
                    <td style={cellStyle}>{results.closedSkipped}</td>
                  </tr>
                  <tr>
                    <td style={cellStyle}>Closed orders removed from database</td>
                    <td style={cellStyle}>{results.closedRemoved}</td>
                  </tr>
                  <tr>
                    <td style={cellStyle}>Removed (older than 1 year)</td>
                    <td style={cellStyle}>{results.deleted}</td>
                  </tr>
                  <tr>
                    <td style={cellStyle}>Skipped (no ID)</td>
                    <td style={cellStyle}>{results.skipped}</td>
                  </tr>
                </tbody>
              </table>

              <button
                style={{ ...secondaryButtonStyle, marginTop: "1rem" }}
                onClick={() => {
                  setStep("upload");
                  setResults(null);
                  setStatus("");
                  setAnalysis(null);
                  setRowsToImport([]);
                  setFileSha256(null);
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
        </section>
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
