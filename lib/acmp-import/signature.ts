type JsonLike =
  | null
  | boolean
  | number
  | string
  | JsonLike[]
  | { [key: string]: JsonLike | undefined };

function normalizeValue(value: unknown): JsonLike {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((entry) => normalizeValue(entry));
  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const sorted: Record<string, JsonLike> = {};
    for (const key of Object.keys(objectValue).sort()) {
      sorted[key] = normalizeValue(objectValue[key]);
    }
    return sorted;
  }
  return String(value);
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeValue(value));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(value: string | ArrayBuffer | Uint8Array): Promise<string> {
  const bytes =
    typeof value === "string"
      ? new TextEncoder().encode(value)
      : value instanceof Uint8Array
        ? value
        : new Uint8Array(value);

  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto SHA-256 support is not available.");
  }

  const digestInput = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", digestInput);
  return bytesToHex(new Uint8Array(digest));
}

export async function createRowsSignature(
  rows: Record<string, unknown>[],
): Promise<string> {
  return sha256(stableStringify(rows));
}

export async function createBufferSha256(
  buffer: ArrayBuffer | Uint8Array,
): Promise<string> {
  return sha256(buffer);
}
