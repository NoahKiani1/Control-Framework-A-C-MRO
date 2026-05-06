import { supabase } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

type OrderBy = {
  column: string;
  ascending?: boolean;
};

type GetWorkOrdersOptions = {
  select?: string;
  isOpen?: boolean;
  isActive?: boolean;
  workOrderIds?: string[];
  orderBy?: OrderBy | OrderBy[];
  client?: SupabaseClient;
};

type ImportRunPayload = {
  filename: string;
  rows_processed: number;
  rows_inserted: number;
  rows_updated: number;
  status: string;
};

type OrderableQuery = {
  order: (column: string, options: { ascending: boolean }) => unknown;
};

function applyOrderBy<T>(query: T, orderBy?: OrderBy | OrderBy[]): T {
  const orders = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];

  let currentQuery = query as T & OrderableQuery;

  for (const order of orders) {
    currentQuery = currentQuery.order(order.column, {
      ascending: order.ascending ?? true,
    }) as T & OrderableQuery;
  }

  return currentQuery as T;
}

export async function getWorkOrders<T = unknown>({
  select = "*",
  isOpen,
  isActive,
  workOrderIds,
  orderBy,
  client = supabase,
}: GetWorkOrdersOptions = {}): Promise<T[]> {
  if (workOrderIds && workOrderIds.length === 0) return [];

  let query = client.from("work_orders").select(select);

  if (typeof isOpen === "boolean") {
    query = query.eq("is_open", isOpen);
  }

  if (typeof isActive === "boolean") {
    query = query.eq("is_active", isActive);
  }

  if (workOrderIds?.length) {
    query = query.in("work_order_id", workOrderIds);
  }

  query = applyOrderBy(query, orderBy);

  const { data, error } = await query;

  if (error) {
    console.error("Failed to load work orders", error);
    return [];
  }

  return (data as T[]) || [];
}

export async function updateWorkOrder(
  workOrderId: string,
  payload: Record<string, unknown>,
  client: SupabaseClient = supabase,
) {
  return client.from("work_orders").update(payload).eq("work_order_id", workOrderId);
}

export async function updateWorkOrderAndFetch<T = unknown>(
  workOrderId: string,
  payload: Record<string, unknown>,
  select = "*",
  client: SupabaseClient = supabase,
): Promise<{
  data: T | null;
  error: { message: string } | null;
}> {
  const { data, error } = await client
    .from("work_orders")
    .update(payload)
    .eq("work_order_id", workOrderId)
    .select(select)
    .maybeSingle();

  if (error) {
    return { data: null, error };
  }

  if (!data) {
    return {
      data: null,
      error: { message: `No work order was updated for ${workOrderId}.` },
    };
  }

  return { data: data as T, error: null };
}

export async function getExistingWorkOrderIds(
  workOrderIds: string[],
  client: SupabaseClient = supabase,
): Promise<string[]> {
  if (workOrderIds.length === 0) return [];

  const { data, error } = await client
    .from("work_orders")
    .select("work_order_id")
    .in("work_order_id", workOrderIds);

  if (error) {
    console.error("Failed to load existing work order ids", error);
    return [];
  }

  return (data || []).map((row: { work_order_id: string }) => row.work_order_id);
}

export async function getCurrentWorkOrderIds(
  client: SupabaseClient = supabase,
): Promise<string[]> {
  const { data, error } = await client
    .from("work_orders")
    .select("work_order_id");

  if (error) {
    console.error("Failed to load current work order ids", error);
    return [];
  }

  return (data || []).map((row: { work_order_id: string }) => row.work_order_id);
}

export async function upsertWorkOrders(
  rows: Record<string, unknown>[],
  client: SupabaseClient = supabase,
) {
  if (rows.length === 0) return { error: null };

  return client.from("work_orders").upsert(rows, {
    onConflict: "work_order_id",
    ignoreDuplicates: false,
  });
}

export async function insertWorkOrders(
  rows: Record<string, unknown>[],
  client: SupabaseClient = supabase,
) {
  if (rows.length === 0) return { error: null };

  return client.from("work_orders").insert(rows);
}

export async function deleteWorkOrdersByIds(
  workOrderIds: string[],
  options: { withCount?: boolean } = {},
  client: SupabaseClient = supabase,
) {
  if (workOrderIds.length === 0) {
    return { error: null, count: 0 };
  }

  const query = options.withCount
    ? client.from("work_orders").delete({ count: "exact" })
    : client.from("work_orders").delete();

  return query.in("work_order_id", workOrderIds);
}

export async function clearImportRuns(client: SupabaseClient = supabase) {
  return client.from("import_runs").delete().neq("id", 0);
}

export async function createImportRun(
  payload: ImportRunPayload,
  client: SupabaseClient = supabase,
) {
  return client.from("import_runs").insert(payload);
}
