"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";

function mapWorkOrderType(compType: string, description: string): string | null {
  const type = (compType || "").toLowerCase().trim();
  const desc = (description || "").toLowerCase().trim();

  if (type === "battery") return "Battery";

  if (type === "wheel") {
    if (desc.startsWith("overhaul")) return "Wheel Overhaul";
    return "Wheel Repair";
  }

  if (type === "brake") {
    if (desc.startsWith("overhaul")) return "Brake Overhaul";
    return "Brake Repair";
  }

  return null;
}

function parseExcelDate(value: unknown): string | null {
  if (!value) return null;

  if (typeof value === "number") {
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    return date.toISOString();
  }

  if (typeof value === "string") {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  return null;
}

function isOlderThanOneYear(value: unknown): boolean {
  const dateStr = parseExcelDate(value);
  if (!dateStr) return false;
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  return new Date(dateStr) < oneYearAgo;
}

type ParsedRow = {
  work_order_id: string;
  customer: string | null;
  rfq_state: string | null;
  last_system_update: string | null;
  is_open: boolean;
  work_order_type: string | null;
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

    setStatus("Bestand wordt gelezen...");
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

      parsed.push({
        work_order_id: workOrderId,
        customer: customer || null,
        rfq_state: rfqState || null,
        last_system_update: parseExcelDate(row["LastUpdatedOn"]),
        is_open: true,
        work_order_type: mapWorkOrderType(compType, description),
      });
    }

    setSkipped(skipCount);
    setTooOld(oldCount);
    setOldIds(tempOldIds);
    setClosedIds(tempClosedIds);
    setClosedSkipped(closedCount);

    setStatus("Bestaande orders controleren...");
    const ids = parsed.map((r) => r.work_order_id);
    const { data: existingData } = await supabase
      .from("work_orders")
      .select("work_order_id")
      .in("work_order_id", ids);

    const existingIds = new Set((existingData || []).map((r: { work_order_id: string }) => r.work_order_id));

    const newOnes = parsed.filter((r) => !existingIds.has(r.work_order_id));
    const existingOnes = parsed.filter((r) => existingIds.has(r.work_order_id));

    setNewOrders(newOnes);
    setExistingOrders(existingOnes);
    setStep("review");
    setStatus("");
  }

  async function doImport() {
    setStatus("Import loopt...");

    const batchSize = 500;
    let updated = 0;

    // 1. Update bestaande orders (alleen systeemvelden)
    for (let i = 0; i < existingOrders.length; i += batchSize) {
      const batch = existingOrders.slice(i, i + batchSize);
      const { error } = await supabase
        .from("work_orders")
        .upsert(batch, {
          onConflict: "work_order_id",
          ignoreDuplicates: false,
        });

      if (error) {
        setStatus(`Fout: ${error.message}`);
        return;
      }
      updated += batch.length;
    }

    // 2. Insert nieuwe orders
    let inserted = 0;
    for (let i = 0; i < newOrders.length; i += batchSize) {
      const batch = newOrders.slice(i, i + batchSize).map((r) => ({
        ...r,
        is_active: makeNewActive,
      }));

      const { error } = await supabase
        .from("work_orders")
        .insert(batch);

      if (error) {
        setStatus(`Fout: ${error.message}`);
        return;
      }
      inserted += batch.length;
    }

    // 3. Verwijder orders ouder dan 1 jaar
    let deleted = 0;
    for (let i = 0; i < oldIds.length; i += batchSize) {
      const batch = oldIds.slice(i, i + batchSize);
      await supabase.from("work_orders").delete().in("work_order_id", batch);
      deleted += batch.length;
    }

    // 4. Verwijder gesloten work orders uit database (op basis van Excel Close Date)
    let closedRemoved = 0;
    for (let i = 0; i < closedIds.length; i += batchSize) {
      const batch = closedIds.slice(i, i + batchSize);
      const { count } = await supabase
        .from("work_orders")
        .delete({ count: "exact" })
        .in("work_order_id", batch);
      closedRemoved += count || 0;
    }

    // 5. Verwijder oude import logs en maak nieuwe aan
    await supabase.from("import_runs").delete().neq("id", 0);

    await supabase.from("import_runs").insert({
      filename: fileName,
      rows_processed: newOrders.length + existingOrders.length + tooOld + skipped + closedSkipped,
      rows_inserted: inserted,
      rows_updated: updated,
      status: "done",
    });

    setResults({
      processed: newOrders.length + existingOrders.length + tooOld + skipped + closedSkipped,
      inserted,
      updated,
      deleted,
      closedRemoved,
      closedSkipped,
      tooOld,
      skipped,
    });
    setStep("done");
    setStatus("Import voltooid!");
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
          <p>Upload een AcMP Excel-export (.xlsx). Gesloten en oude orders worden automatisch overgeslagen en verwijderd.</p>
          <label style={{
            display: "inline-block",
            margin: "1rem 0",
            padding: "10px 20px",
            backgroundColor: "#0070f3",
            color: "white",
            borderRadius: "6px",
            cursor: "pointer",
            fontWeight: "bold",
          }}>
            📂 Bestand kiezen
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
          <div style={{ marginBottom: "1rem", padding: "12px 16px", backgroundColor: "#f0f8ff", border: "1px solid #aad", borderRadius: "6px" }}>
            <strong>📊 Bestand geanalyseerd: {fileName}</strong>
            <br />
            {existingOrders.length} bestaande orders (systeemvelden worden bijgewerkt, handmatige velden blijven intact)
            <br />
            <strong>{newOrders.length} nieuwe open orders gevonden</strong>
            <br />
            {closedSkipped > 0 && <>{closedSkipped} gesloten orders (worden overgeslagen + verwijderd uit database)<br /></>}
            {tooOld > 0 && <>{tooOld} orders ouder dan 1 jaar (worden verwijderd)<br /></>}
            {skipped > 0 && <>{skipped} overgeslagen (geen Work Order ID)<br /></>}
          </div>

          {newOrders.length > 0 && (
            <div style={{ marginBottom: "1rem", padding: "12px 16px", backgroundColor: "#fff8e0", border: "1px solid #dda", borderRadius: "6px" }}>
              <strong>Nieuwe work orders direct actief maken?</strong>
              <p style={{ margin: "8px 0 4px" }}>
                Als je ze actief maakt, verschijnen ze direct in het Dashboard, Planning en Shop.
                Zo niet, komen ze in de Backlog.
              </p>
              <label style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="checkbox"
                  checked={makeNewActive}
                  onChange={(e) => setMakeNewActive(e.target.checked)}
                  style={{ width: "18px", height: "18px" }}
                />
                <span>Ja, maak de {newOrders.length} nieuwe orders direct actief</span>
              </label>
            </div>
          )}

          <button style={buttonStyle} onClick={doImport}>
            ✅ Importeer nu
          </button>
        </>
      )}

      {step === "done" && results && (
        <>
          <table style={{ borderCollapse: "collapse", marginTop: "1rem" }}>
            <tbody>
              <tr><td style={{ padding: "4px 12px" }}>Rijen in bestand</td><td>{results.processed}</td></tr>
              <tr><td style={{ padding: "4px 12px" }}>Nieuw ingevoegd</td><td>{results.inserted}</td></tr>
              <tr><td style={{ padding: "4px 12px" }}>Bijgewerkt</td><td>{results.updated}</td></tr>
              <tr><td style={{ padding: "4px 12px" }}>Gesloten orders overgeslagen</td><td>{results.closedSkipped}</td></tr>
              <tr><td style={{ padding: "4px 12px" }}>Gesloten orders verwijderd uit database</td><td>{results.closedRemoved}</td></tr>
              <tr><td style={{ padding: "4px 12px" }}>Verwijderd (ouder dan 1 jaar)</td><td>{results.deleted}</td></tr>
              <tr><td style={{ padding: "4px 12px" }}>Overgeslagen (geen ID)</td><td>{results.skipped}</td></tr>
            </tbody>
          </table>

          <button
            style={{ ...buttonStyle, marginTop: "1rem", backgroundColor: "#666" }}
            onClick={() => { setStep("upload"); setResults(null); setStatus(""); }}
          >
            Nieuwe import starten
          </button>
        </>
      )}

      {status && <p style={{ marginTop: "1rem" }}><strong>{status}</strong></p>}

      <p style={{ marginTop: "2rem" }}>
        <a href="/">← Terug naar home</a>
      </p>
    </main>
  );
}
