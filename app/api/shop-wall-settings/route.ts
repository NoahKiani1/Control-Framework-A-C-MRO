import { requireAppRole } from "@/lib/server-auth";
import { getShopWallSettings, updateShopWallAviationNewsEnabled } from "@/lib/shop-wall-settings";
import { getSupabaseServiceClient } from "@/lib/supabase-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(payload: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store, max-age=0");
  return Response.json(payload, { ...init, headers });
}

export async function GET(request: Request) {
  const auth = await requireAppRole(request, ["office", "wall"]);
  if (!auth.ok) return auth.response;

  try {
    const settings = await getShopWallSettings(getSupabaseServiceClient());
    return noStoreJson({ settings });
  } catch (error) {
    return noStoreJson(
      {
        error: {
          message:
            error instanceof Error
              ? error.message
              : "Unable to load shop wall settings.",
        },
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const auth = await requireAppRole(request, ["office"]);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noStoreJson(
      { error: { message: "Request body must be valid JSON." } },
      { status: 400 },
    );
  }

  const aviationNewsEnabled =
    body &&
    typeof body === "object" &&
    "aviationNewsEnabled" in body &&
    typeof body.aviationNewsEnabled === "boolean"
      ? body.aviationNewsEnabled
      : null;

  if (aviationNewsEnabled === null) {
    return noStoreJson(
      { error: { message: "aviationNewsEnabled boolean is required." } },
      { status: 400 },
    );
  }

  try {
    const settings = await updateShopWallAviationNewsEnabled({
      client: getSupabaseServiceClient(),
      enabled: aviationNewsEnabled,
      userId: auth.userId,
    });

    return noStoreJson({ settings });
  } catch (error) {
    return noStoreJson(
      {
        error: {
          message:
            error instanceof Error
              ? error.message
              : "Unable to update shop wall settings.",
        },
      },
      { status: 500 },
    );
  }
}
