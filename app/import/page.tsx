"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import {
  isOlderThanOneYear,
  mapWorkOrderType,
  normalizeImportedRfqState,
  parseExcelDate,
} from "@/lib/import-normalize";
import {
  clearImportRuns,
  createImportRun,
  deleteWorkOrdersByIds,
  getExistingWorkOrderIds,
  insertWorkOrders,
  upsertWorkOrders,
} from "@/lib/work-orders";

type ParsedRow = {
  work_order_id: string;
  customer: string | null;
  rfq_state: string | null;
  last_system_update: string | null;
  is_open: boolean;
  work_order_type: string | null;
  part_number: string | null;
};

export default function ImportPage() {
  const [status, setStatus] = useState("");
  const [step, setStep] = useState<"upload" | "review" | "done">("upload");
  const [newOrders, setNewOrders] = useState<ParsedRow[]>([]);
  const [existingOrders, setExistingOrders] = useState<ParsedRow[]>([]);
  const [oldIds, setOldIds] = useState<string[]>([]);
  const [closedIds, setClosedIds] = useState<string[]>([]);
  const [makeNewActive, setMakeNewActive] = useState(false);
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
    const existingIds = new Set(await getExistingWorkOrderIds(ids));

    const newOnes = parsed.filter((r) => !existingIds.has(r.work_order_id));
    const existingOnes = parsed.filter((r) => existingIds.has(r.work_order_id));

    setNewOrders(newOnes);
    setExistingOrders(existingOnes);
    setStep("review");
    setStatus("");
  }

  async function doImport() {
    setStatus("Importing...");

    const batchSize = 500;
    let updated = 0;

    // 1. Update existing orders (system fields only)
    for (let i = 0; i < existingOrders.length; i += batchSize) {
      const batch = existingOrders.slice(i, i + batchSize);
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
      const batch = newOrders.slice(i, i + batchSize).map((r) => ({
        ...r,
        is_active: makeNewActive,
        current_process_step: makeNewActive ? "Intake" : null,
      }));

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
      tooOld,
      skipped,
    });
    setStep("done");
    setStatus("Import complete!");
  }

  const buttonStyle: React.CSSProperties = {
    padding: "10px 20px",
    backgroundColor: "#0070f3",
    color: "white",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    fontWeight: "bold",
    fontSize: "14px",
  };

  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif", maxWidth: "700px" }}>
      <h1>AcMP Import</h1>

      {step === "upload" && (
        <>
          <p>
            Upload an AcMP Excel export (.xlsx). Closed and old orders will be
            automatically skipped and removed.
          </p>
          <label
            style={{
              display: "inline-block",
              margin: "1rem 0",
              padding: "10px 20px",
              backgroundColor: "#0070f3",
              color: "white",
              borderRadius: "6px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            📂 Choose file
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
              marginBottom: "1rem",
              padding: "12px 16px",
              backgroundColor: "#f0f8ff",
              border: "1px solid #aad",
              borderRadius: "6px",
            }}
          >
            <strong>📊 File analyzed: {fileName}</strong>
            <br />
            {existingOrders.length} existing orders (system fields will be updated, manual fields remain intact)
            <br />
            <strong>{newOrders.length} new open orders found</strong>
            <br />
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

          {newOrders.length > 0 && (
            <div
              style={{
                marginBottom: "1rem",
                padding: "12px 16px",
                backgroundColor: "#fff8e0",
                border: "1px solid #dda",
                borderRadius: "6px",
              }}
            >
              <strong>Make new work orders active immediately?</strong>
              <p style={{ margin: "8px 0 4px" }}>
                If you make them active, they will appear in the Dashboard,
                Planning and Shop right away. New active orders automatically start at
                <strong> Intake</strong>. Otherwise, they will go to the Backlog.
              </p>
              <label
                style={{
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <input
                  type="checkbox"
                  checked={makeNewActive}
                  onChange={(e) => setMakeNewActive(e.target.checked)}
                  style={{ width: "18px", height: "18px" }}
                />
                <span>Yes, make the {newOrders.length} new orders active immediately</span>
              </label>
            </div>
          )}

          <button style={buttonStyle} onClick={doImport}>
            ✅ Import now
          </button>
        </>
      )}

      {step === "done" && results && (
        <>
          <table style={{ borderCollapse: "collapse", marginTop: "1rem" }}>
            <tbody>
              <tr>
                <td style={{ padding: "4px 12px" }}>Rows in file</td>
                <td>{results.processed}</td>
              </tr>
              <tr>
                <td style={{ padding: "4px 12px" }}>Newly inserted</td>
                <td>{results.inserted}</td>
              </tr>
              <tr>
                <td style={{ padding: "4px 12px" }}>Updated</td>
                <td>{results.updated}</td>
              </tr>
              <tr>
                <td style={{ padding: "4px 12px" }}>Closed orders skipped</td>
                <td>{results.closedSkipped}</td>
              </tr>
              <tr>
                <td style={{ padding: "4px 12px" }}>
                  Closed orders removed from database
                </td>
                <td>{results.closedRemoved}</td>
              </tr>
              <tr>
                <td style={{ padding: "4px 12px" }}>Removed (older than 1 year)</td>
                <td>{results.deleted}</td>
              </tr>
              <tr>
                <td style={{ padding: "4px 12px" }}>Skipped (no ID)</td>
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

      <p style={{ marginTop: "2rem" }}>
        <a href="/">← Back to home</a>
      </p>
    </main>
  );
}
