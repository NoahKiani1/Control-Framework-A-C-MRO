import { requireAppRole } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NEWS_SCRIPT_URL =
  "https://www.luchtvaartnieuws.nl/objects/remote/luchtvaartnieuws.js";
const SOURCE_URL = "https://www.luchtvaartnieuws.nl/";
const SOURCE_NAME = "Luchtvaartnieuws.nl";

type AviationNewsItem = {
  title: string;
  url: string;
  summary: string | null;
  imageUrl: string | null;
  publishedAt: string | null;
};

function noStoreJson(payload: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store, max-age=0");
  return Response.json(payload, { ...init, headers });
}

function decodeJavascriptString(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function decodeHtmlEntities(value: string): string {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    quot: '"',
  };

  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
    const normalizedCode = code.toLowerCase();

    if (normalizedCode.startsWith("#x")) {
      const codePoint = Number.parseInt(normalizedCode.slice(2), 16);
      if (Number.isFinite(codePoint)) {
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return entity;
        }
      }
    }

    if (normalizedCode.startsWith("#")) {
      const codePoint = Number.parseInt(normalizedCode.slice(1), 10);
      if (Number.isFinite(codePoint)) {
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return entity;
        }
      }
    }

    return namedEntities[normalizedCode] ?? entity;
  });
}

function getAttribute(tag: string, attributeName: string): string | null {
  const pattern = new RegExp(`\\b${attributeName}\\s*=\\s*(["'])(.*?)\\1`, "i");
  const match = pattern.exec(tag);
  return match ? decodeHtmlEntities(match[2]) : null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}

function resolveNewsUrl(value: string): string | null {
  try {
    return new URL(value, SOURCE_URL).toString();
  } catch {
    return null;
  }
}

function resolveSourceUrl(value: string | null): string | null {
  if (!value) return null;

  try {
    return new URL(value, SOURCE_URL).toString();
  } catch {
    return null;
  }
}

function getMetaContent(html: string, names: string[]): string | null {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  const contentByName = new Map<string, string>();

  for (const metaTag of metaTags) {
    const property = getAttribute(metaTag, "property")?.toLowerCase();
    const name = getAttribute(metaTag, "name")?.toLowerCase();
    const content = normalizeWhitespace(getAttribute(metaTag, "content") ?? "");
    if (!content) continue;

    if (property && !contentByName.has(property)) {
      contentByName.set(property, content);
    }

    if (name && !contentByName.has(name)) {
      contentByName.set(name, content);
    }
  }

  for (const name of names) {
    const content = contentByName.get(name.toLowerCase());
    if (content) return content;
  }

  return null;
}

async function enrichNewsItem(item: AviationNewsItem): Promise<AviationNewsItem> {
  try {
    const response = await fetch(item.url, {
      headers: {
        Accept: "text/html,*/*",
        "User-Agent": "ACMP Shop Wall News Preview",
      },
      next: { revalidate: 600 },
    });

    if (!response.ok) return item;

    const html = await response.text();
    const summary = getMetaContent(html, [
      "og:description",
      "description",
      "abstract",
    ]);
    const imageUrl = resolveSourceUrl(getMetaContent(html, ["og:image"]));
    const publishedAt = getMetaContent(html, [
      "article:published_time",
      "dcterms.date",
    ]);

    return {
      ...item,
      summary: summary ?? item.summary,
      imageUrl,
      publishedAt,
    };
  } catch {
    return item;
  }
}

function extractDocumentWriteHtml(script: string): string {
  const htmlParts: string[] = [];
  const documentWritePattern = /document\.write\('((?:\\.|[^'\\])*)'\);?/g;
  let match: RegExpExecArray | null;

  while ((match = documentWritePattern.exec(script)) !== null) {
    htmlParts.push(decodeJavascriptString(match[1]));
  }

  return htmlParts.join("");
}

function parseNewsItems(script: string): AviationNewsItem[] {
  const html = extractDocumentWriteHtml(script);
  const anchors = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) ?? [];
  const seenUrls = new Set<string>();
  const items: AviationNewsItem[] = [];

  for (const anchor of anchors) {
    const className = getAttribute(anchor, "class") ?? "";
    if (!className.split(/\s+/).includes("widget-titel-lvn")) continue;

    const href = getAttribute(anchor, "href");
    if (!href) continue;

    const url = resolveNewsUrl(href);
    if (!url || seenUrls.has(url)) continue;

    const title =
      normalizeWhitespace(getAttribute(anchor, "title") ?? "") ||
      normalizeWhitespace(decodeHtmlEntities(stripTags(anchor)));

    if (!title) continue;

    seenUrls.add(url);
    items.push({
      title,
      url,
      summary: null,
      imageUrl: null,
      publishedAt: null,
    });
  }

  return items;
}

export async function GET(request: Request) {
  const auth = await requireAppRole(request, ["office", "wall"]);
  if (!auth.ok) return auth.response;

  try {
    const response = await fetch(NEWS_SCRIPT_URL, {
      headers: {
        Accept: "application/javascript,text/javascript,*/*",
        "User-Agent": "ACMP Shop Wall News Preview",
      },
      next: { revalidate: 600 },
    });

    if (!response.ok) {
      throw new Error(`Luchtvaartnieuws responded with ${response.status}`);
    }

    const script = await response.text();
    const items = parseNewsItems(script);
    const enrichedItems = await Promise.all(items.map(enrichNewsItem));

    return noStoreJson({
      sourceName: SOURCE_NAME,
      sourceUrl: SOURCE_URL,
      scriptUrl: NEWS_SCRIPT_URL,
      updatedAt: new Date().toISOString(),
      items: enrichedItems,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to load aviation news.";

    return noStoreJson({ error: { message } }, { status: 502 });
  }
}
// noah was hier
