import { supabase } from "@/lib/supabase";

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
};

type ImportRunPayload = {
  filename: string;
  rows_processed: number;
  rows_inserted: number;
  rows_updated: number;
  status: string;
};

type OrderableQuery = {
  order: (column: string, options: { ascending: boolean }) => OrderableQuery;
};

function applyOrderBy<T extends OrderableQuery>(query: T, orderBy?: OrderBy | OrderBy[]): T {
  const orders = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];

  let currentQuery = query;

  for (const order of orders) {
    currentQuery = currentQuery.order(order.column, {
      ascending: order.ascending ?? true,
    });
  }

  return currentQuery as T;
}

export async function getWorkOrders<T = unknown>({
  select = "*",
  isOpen,
  isActive,
  workOrderIds,
  orderBy,
}: GetWorkOrdersOptions = {}): Promise<T[]> {
  if (workOrderIds && workOrderIds.length === 0) return [];

  let query = supabase.from("work_orders").select(select);

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
) {
  return supabase.from("work_orders").update(payload).eq("work_order_id", workOrderId);
}

export async function getExistingWorkOrderIds(workOrderIds: string[]): Promise<string[]> {
  if (workOrderIds.length === 0) return [];

  const { data, error } = await supabase
    .from("work_orders")
    .select("work_order_id")
    .in("work_order_id", workOrderIds);

  if (error) {
    console.error("Failed to load existing work order ids", error);
    return [];
  }

  return (data || []).map((row: { work_order_id: string }) => row.work_order_id);
}

export async function upsertWorkOrders(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return { error: null };

  return supabase.from("work_orders").upsert(rows, {
    onConflict: "work_order_id",
    ignoreDuplicates: false,
  });
}

export async function insertWorkOrders(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return { error: null };

  return supabase.from("work_orders").insert(rows);
}

export async function deleteWorkOrdersByIds(
  workOrderIds: string[],
  options: { withCount?: boolean } = {},
) {
  if (workOrderIds.length === 0) {
    return { error: null, count: 0 };
  }

  const query = options.withCount
    ? supabase.from("work_orders").delete({ count: "exact" })
    : supabase.from("work_orders").delete();

  return query.in("work_order_id", workOrderIds);
}

export async function clearImportRuns() {
  return supabase.from("import_runs").delete().neq("id", 0);
}

export async function createImportRun(payload: ImportRunPayload) {
  return supabase.from("import_runs").insert(payload);
}
