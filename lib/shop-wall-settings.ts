import type { SupabaseClient } from "@supabase/supabase-js";

export type ShopWallSettings = {
  aviationNewsEnabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
};

type ShopWallSettingsRow = {
  aviation_news_enabled: boolean | null;
  updated_at: string | null;
  updated_by: string | null;
};

const SHOP_WALL_SETTINGS_ID = "default";

export const DEFAULT_SHOP_WALL_SETTINGS: ShopWallSettings = {
  aviationNewsEnabled: false,
  updatedAt: null,
  updatedBy: null,
};

function isMissingShopWallSettingsTableError(error: {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}): boolean {
  const errorText = [
    error.code,
    error.message,
    error.details,
    error.hint,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    errorText.includes("shop_wall_settings") &&
    (errorText.includes("does not exist") ||
      errorText.includes("could not find") ||
      errorText.includes("schema cache") ||
      error.code === "42P01")
  );
}

function mapShopWallSettingsRow(
  row: ShopWallSettingsRow | null,
): ShopWallSettings {
  if (!row) return DEFAULT_SHOP_WALL_SETTINGS;

  return {
    aviationNewsEnabled: row.aviation_news_enabled === true,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export async function getShopWallSettings(
  client: SupabaseClient,
): Promise<ShopWallSettings> {
  const { data, error } = await client
    .from("shop_wall_settings")
    .select("aviation_news_enabled, updated_at, updated_by")
    .eq("id", SHOP_WALL_SETTINGS_ID)
    .maybeSingle();

  if (error) {
    if (isMissingShopWallSettingsTableError(error)) {
      console.warn(
        "shop_wall_settings is not available yet; using default shop wall settings.",
      );
      return DEFAULT_SHOP_WALL_SETTINGS;
    }

    throw error;
  }

  return mapShopWallSettingsRow(data as ShopWallSettingsRow | null);
}

export async function updateShopWallAviationNewsEnabled({
  client,
  enabled,
  userId,
}: {
  client: SupabaseClient;
  enabled: boolean;
  userId: string;
}): Promise<ShopWallSettings> {
  const { data, error } = await client
    .from("shop_wall_settings")
    .upsert(
      {
        id: SHOP_WALL_SETTINGS_ID,
        aviation_news_enabled: enabled,
        updated_at: new Date().toISOString(),
        updated_by: userId,
      },
      { onConflict: "id" },
    )
    .select("aviation_news_enabled, updated_at, updated_by")
    .single();

  if (error) throw error;

  return mapShopWallSettingsRow(data as ShopWallSettingsRow);
}
