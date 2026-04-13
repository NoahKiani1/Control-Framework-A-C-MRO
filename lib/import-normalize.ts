export function mapWorkOrderType(compType: string, description: string): string | null {
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

export function parseExcelDate(value: unknown): string | null {
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

export function isOlderThanOneYear(value: unknown): boolean {
  const dateStr = parseExcelDate(value);
  if (!dateStr) return false;
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  return new Date(dateStr) < oneYearAgo;
}

export function normalizeImportedRfqState(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const normalized = raw.toLowerCase().replace(/\s+/g, " ");

  if (normalized === "rfq denied" || normalized === "rfq rejected") {
    return "RFQ Rejected";
  }

  if (normalized === "rfq send") {
    return "RFQ Send";
  }

  if (normalized === "rfq send - continue") {
    return "RFQ Send - Continue";
  }

  return raw;
}
