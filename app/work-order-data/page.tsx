"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Trash2 } from "lucide-react";
import * as XLSX from "xlsx";
import { PageHeader } from "@/app/components/page-header";
import { RequireRole } from "@/app/components/require-role";
import {
  ClosedWorkOrderReport,
  StepDurationDays,
  WorkOrderDataSummary,
  cleanWorkOrderDataYear,
  getClosedWorkOrderReports,
  getWorkOrderDataSummary,
  getWorkOrderDataTypes,
  hasUncleanedYearEndReport,
  recordWorkOrderDataExport,
} from "@/lib/work-order-data";
import { INTAKE_STEP, PROCESS_STEPS } from "@/lib/process-steps";

type SequenceStatus = "all" | "valid" | "invalid";

const COLORS = {
  pageBg: "#f2efe9",
  panelBg: "#ffffff",
  cardBg: "#faf8f3",
  border: "#e2ddd1",
  borderStrong: "#ccc4b4",
  text: "#1f2937",
  textSoft: "#5f6b7c",
  textMuted: "#8590a0",
  blue: "#2555c7",
  blueSoft: "#eef3ff",
  green: "#166534",
  greenSoft: "#eef9f1",
  red: "#b42318",
  redSoft: "#fff2ef",
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

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "-";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatDaysDuration(days: number | null): string {
  if (days === null) return "-";
  return formatDuration(Math.round(days * 86400));
}

function roundDays(days: number): number {
  return Math.round(days * 1000) / 1000;
}

function totalDaysForReport(row: ClosedWorkOrderReport): number | null {
  if (typeof row.total_days_to_certification === "number") {
    return roundDays(row.total_days_to_certification);
  }
  if (typeof row.total_seconds_to_easa === "number") {
    return roundDays(row.total_seconds_to_easa / 86400);
  }
  return null;
}

function normalizeStepDurationValue(value: StepDurationDays[string] | undefined) {
  if (value === "NaN") return "NaN";
  return typeof value === "number" ? value : "";
}

function possibleProcessSteps(): string[] {
  const seen = new Set<string>();
  return Object.values(PROCESS_STEPS)
    .flat()
    .filter((step) => step !== INTAKE_STEP)
    .filter((step) => {
      if (seen.has(step)) return false;
      seen.add(step);
      return true;
    });
}

function stepHeader(step: string): string {
  return `${step} Days`;
}

function reportExportRows(
  reports: ClosedWorkOrderReport[],
  stepColumns: string[],
): (string | number | boolean | null)[][] {
  return reports.map((row) => {
    const includedSteps = new Set(row.included_process_steps ?? []);
    const totalDays = totalDaysForReport(row);
    return [
      row.work_order_id,
      row.customer,
      row.part_number,
      row.work_order_type,
      formatDateTime(row.activated_at),
      formatDateTime(row.easa_selected_at),
      totalDays,
      formatDaysDuration(totalDays),
      row.sequence_valid,
      row.sequence_issue,
      ...stepColumns.map((step) => {
        if (!includedSteps.has(step)) return "";
        if (!row.sequence_valid) return "NaN";
        const value = normalizeStepDurationValue(row.step_durations_days?.[step]);
        return typeof value === "number" ? roundDays(value) : "NaN";
      }),
    ];
  });
}

function styleWorksheet(
  worksheet: XLSX.WorkSheet,
  widths: number[],
  numericColumnIndexes: number[] = [],
) {
  worksheet["!cols"] = widths.map((wch) => ({ wch }));
  worksheet["!rows"] = [{ hpt: 32 }];
  worksheet["!freeze"] = { xSplit: 0, ySplit: 1 };

  const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1:A1");
  worksheet["!autofilter"] = { ref: XLSX.utils.encode_range(range) };

  for (let column = range.s.c; column <= range.e.c; column += 1) {
    const cellRef = XLSX.utils.encode_cell({ r: 0, c: column });
    const cell = worksheet[cellRef];
    if (cell) {
      cell.s = {
        font: { bold: true, sz: 13, color: { rgb: "FFFFFF" } },
        fill: { patternType: "solid", fgColor: { rgb: "1D4ED8" } },
        alignment: { horizontal: "center", vertical: "center", wrapText: true },
        border: {
          top: { style: "thin", color: { rgb: "93C5FD" } },
          bottom: { style: "thin", color: { rgb: "1E3A8A" } },
          left: { style: "thin", color: { rgb: "93C5FD" } },
          right: { style: "thin", color: { rgb: "93C5FD" } },
        },
      };
    }
  }

  for (let row = 1; row <= range.e.r; row += 1) {
    for (const column of numericColumnIndexes) {
      const cellRef = XLSX.utils.encode_cell({ r: row, c: column });
      const cell = worksheet[cellRef];
      if (cell && typeof cell.v === "number") {
        cell.z = "0.000";
      }
    }
  }
}

function WorkOrderDataContent() {
  const currentYear = new Date().getFullYear();
  const [workOrderType, setWorkOrderType] = useState("all");
  const [sequenceStatus, setSequenceStatus] = useState<SequenceStatus>("all");
  const [reports, setReports] = useState<ClosedWorkOrderReport[]>([]);
  const [summary, setSummary] = useState<WorkOrderDataSummary>({
    trackedClosedWorkOrders: 0,
    validSequences: 0,
    invalidSequences: 0,
    averageDaysToCertification: null,
  });
  const [types, setTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [yearEndCleanRequired, setYearEndCleanRequired] = useState(false);

  const filters = useMemo(
    () => ({
      year: currentYear,
      workOrderType,
      sequenceStatus,
    }),
    [currentYear, workOrderType, sequenceStatus],
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    const [nextReports, nextSummary, nextTypes] = await Promise.all([
      getClosedWorkOrderReports(filters),
      getWorkOrderDataSummary(filters),
      getWorkOrderDataTypes(),
    ]);
    const cleanRequired =
      new Date().getMonth() === 11
        ? await hasUncleanedYearEndReport(currentYear)
        : false;
    setReports(nextReports);
    setSummary(nextSummary);
    setTypes(nextTypes);
    setYearEndCleanRequired(cleanRequired);
    setLoading(false);
  }, [currentYear, filters]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void loadData();
    }, 0);
    return () => window.clearTimeout(id);
  }, [loadData]);

  async function downloadYear(year: number) {
    setStatus("Preparing Excel export...");
    const yearReports = await getClosedWorkOrderReports({ year });

    const workbook = XLSX.utils.book_new();
    const stepColumns = possibleProcessSteps();
    const summaryHeaders = [
      "Work Order ID",
      "Customer",
      "Part Number",
      "Work Order Type",
      "Activated At",
      "Certification Selected At",
      "Total Days to Certification",
      "Total Time to Certification",
      "Sequence Valid",
      "Sequence Issue",
      ...stepColumns.map(stepHeader),
    ];
    const summarySheet = XLSX.utils.aoa_to_sheet([
      summaryHeaders,
      ...reportExportRows(yearReports, stepColumns),
    ]);
    styleWorksheet(
      summarySheet,
      [18, 26, 20, 22, 30, 36, 28, 28, 18, 48, ...stepColumns.map(() => 20)],
      [6, ...stepColumns.map((_, index) => index + 10)],
    );
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Work Order Summary");
    XLSX.writeFile(workbook, `work-order-data-${year}.xlsx`);

    const exportResult = await recordWorkOrderDataExport(year);
    setStatus(
      exportResult.error
        ? `Downloaded, but export logging failed: ${exportResult.error.message}`
        : `Downloaded Work Order Data for ${year}.`,
    );
  }

  async function cleanCurrentYear() {
    const ok = window.confirm(
      `This will permanently delete exported Work Order Data for ${currentYear} from Supabase. Make sure the Excel export has been saved. Continue?`,
    );
    if (!ok) return;

    setStatus("Cleaning this year's data...");
    const result = await cleanWorkOrderDataYear(currentYear);
    if (result.error) {
      setStatus(`Error: ${result.error.message}`);
      return;
    }

    setStatus(`Work Order Data for ${currentYear} was cleaned successfully.`);
    await loadData();
  }

  const pageStyle: React.CSSProperties = {
    minHeight: "100vh",
    backgroundColor: COLORS.pageBg,
    padding: "var(--layout-page-py) var(--layout-page-px) var(--layout-page-px)",
    fontFamily: FONT_STACK,
    color: COLORS.text,
  };

  const shellStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: "var(--layout-content-max-w)",
    marginInline: "auto",
  };

  const panelStyle: React.CSSProperties = {
    backgroundColor: COLORS.panelBg,
    border: `1px solid ${COLORS.border}`,
    borderRadius: "var(--card-radius)",
    padding: "var(--card-py) var(--card-px)",
    boxShadow: COLORS.shadow,
    minWidth: 0,
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    minHeight: "36px",
    padding: "8px 10px",
    border: `1px solid ${COLORS.borderStrong}`,
    borderRadius: "8px",
    backgroundColor: COLORS.inputBg,
    color: COLORS.text,
    fontSize: "var(--fs-body)",
  };

  const primaryButtonStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    minHeight: "38px",
    padding: "9px 14px",
    borderRadius: "8px",
    border: `1px solid ${COLORS.blue}`,
    backgroundColor: COLORS.blue,
    color: "white",
    fontSize: "var(--fs-body)",
    fontWeight: 700,
    cursor: "pointer",
  };

  const dangerButtonStyle: React.CSSProperties = {
    ...primaryButtonStyle,
    borderColor: COLORS.red,
    backgroundColor: COLORS.red,
  };

  const cellStyle: React.CSSProperties = {
    padding: "9px 10px",
    borderBottom: `1px solid ${COLORS.border}`,
    fontSize: "var(--fs-body)",
    textAlign: "left",
    verticalAlign: "top",
    overflowWrap: "anywhere",
  };

  const headerStyle: React.CSSProperties = {
    ...cellStyle,
    color: COLORS.textMuted,
    fontSize: "var(--fs-xs)",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    backgroundColor: COLORS.cardBg,
  };

  return (
    <main style={pageStyle}>
      <div style={shellStyle}>
        <PageHeader
          title="Work Order Data"
          description="View, export, and clean tracked work order timing data."
          actions={
            <>
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={() => void downloadYear(currentYear)}
              >
                <Download size={16} />
                {"Download this year's data"}
              </button>
              {yearEndCleanRequired && (
                <button
                  type="button"
                  style={dangerButtonStyle}
                  onClick={() => void cleanCurrentYear()}
                >
                  <Trash2 size={16} />
                  Clean this year after export
                </button>
              )}
            </>
          }
        />

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
            gap: "12px",
            marginBottom: "14px",
          }}
        >
          {[
            ["Tracked closed work orders", summary.trackedClosedWorkOrders],
            ["Valid sequences", summary.validSequences],
            ["Invalid sequences", summary.invalidSequences],
            [
              "Average time to Certification",
              formatDaysDuration(summary.averageDaysToCertification),
            ],
          ].map(([label, value]) => (
            <div key={label} style={panelStyle}>
              <div
                style={{
                  color: COLORS.textMuted,
                  fontSize: "var(--fs-xs)",
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  marginBottom: "6px",
                }}
              >
                {label}
              </div>
              <div style={{ fontSize: "24px", fontWeight: 700 }}>{value}</div>
            </div>
          ))}
        </section>

        <section style={{ ...panelStyle, marginBottom: "14px" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "10px",
            }}
          >
            <label>
              <div style={{ marginBottom: "4px", color: COLORS.textMuted, fontSize: "var(--fs-sm)", fontWeight: 700 }}>
                Work Order Type
              </div>
              <select
                value={workOrderType}
                onChange={(event) => setWorkOrderType(event.target.value)}
                style={inputStyle}
              >
                <option value="all">All</option>
                {types.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <div style={{ marginBottom: "4px", color: COLORS.textMuted, fontSize: "var(--fs-sm)", fontWeight: 700 }}>
                Sequence Status
              </div>
              <select
                value={sequenceStatus}
                onChange={(event) =>
                  setSequenceStatus(event.target.value as SequenceStatus)
                }
                style={inputStyle}
              >
                <option value="all">All</option>
                <option value="valid">Valid</option>
                <option value="invalid">Invalid</option>
              </select>
            </label>
          </div>
        </section>

        <section style={panelStyle}>
          {loading ? (
            <div style={{ color: COLORS.textSoft }}>Loading Work Order Data...</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  minWidth: "1060px",
                  borderCollapse: "collapse",
                  tableLayout: "fixed",
                }}
              >
                <thead>
                  <tr>
                    <th style={headerStyle}>Work Order</th>
                    <th style={headerStyle}>Customer</th>
                    <th style={headerStyle}>Part Number</th>
                    <th style={headerStyle}>Work Order Type</th>
                    <th style={headerStyle}>Activated At</th>
                    <th style={headerStyle}>Certification Selected At</th>
                    <th style={headerStyle}>Total Time to Certification</th>
                    <th style={headerStyle}>Sequence Status</th>
                    <th style={headerStyle}>Sequence Issue</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ ...cellStyle, color: COLORS.textSoft }}>
                        No tracked Work Order Data for this selection.
                      </td>
                    </tr>
                  ) : (
                    reports.map((row) => (
                      <tr key={row.work_order_id}>
                        <td style={{ ...cellStyle, fontWeight: 700 }}>{row.work_order_id}</td>
                        <td style={cellStyle}>{row.customer || "-"}</td>
                        <td style={cellStyle}>{row.part_number || "-"}</td>
                        <td style={cellStyle}>{row.work_order_type || "-"}</td>
                        <td style={cellStyle}>{formatDateTime(row.activated_at)}</td>
                        <td style={cellStyle}>{formatDateTime(row.easa_selected_at)}</td>
                        <td style={cellStyle}>
                          {formatDaysDuration(totalDaysForReport(row))}
                        </td>
                        <td style={cellStyle}>
                          <span
                            style={{
                              display: "inline-flex",
                              padding: "3px 8px",
                              borderRadius: "999px",
                              fontWeight: 700,
                              color: row.sequence_valid ? COLORS.green : COLORS.red,
                              backgroundColor: row.sequence_valid
                                ? COLORS.greenSoft
                                : COLORS.redSoft,
                            }}
                          >
                            {row.sequence_valid ? "Valid" : "Invalid"}
                          </span>
                        </td>
                        <td style={cellStyle}>{row.sequence_issue || "-"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {status && (
          <div
            style={{
              marginTop: "12px",
              padding: "10px 12px",
              border: `1px solid ${COLORS.borderStrong}`,
              borderRadius: "10px",
              backgroundColor: COLORS.cardBg,
              color: COLORS.textSoft,
              fontSize: "var(--fs-body)",
            }}
          >
            {status}
          </div>
        )}
      </div>
    </main>
  );
}

export default function WorkOrderDataPage() {
  return (
    <RequireRole allowedRoles={["office"]}>
      <WorkOrderDataContent />
    </RequireRole>
  );
}
