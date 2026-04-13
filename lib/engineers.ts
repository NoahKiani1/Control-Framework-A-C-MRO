import { supabase } from "@/lib/supabase";

type OrderBy = {
  column: string;
  ascending?: boolean;
};

type GetEngineersOptions = {
  select?: string;
  isActive?: boolean;
  role?: string;
  orderBy?: OrderBy | OrderBy[];
};

type GetEngineerAbsencesOptions = {
  select?: string;
  fromDate?: string;
  orderBy?: OrderBy | OrderBy[];
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

export async function getEngineers<T = unknown>({
  select = "*",
  isActive,
  role,
  orderBy,
}: GetEngineersOptions = {}): Promise<T[]> {
  let query = supabase.from("engineers").select(select);

  if (typeof isActive === "boolean") {
    query = query.eq("is_active", isActive);
  }

  if (role) {
    query = query.eq("role", role);
  }

  query = applyOrderBy(query, orderBy);

  const { data, error } = await query;

  if (error) {
    console.error("Failed to load engineers", error);
    return [];
  }

  return (data as T[]) || [];
}

export async function insertEngineer(payload: Record<string, unknown>) {
  return supabase.from("engineers").insert(payload);
}

export async function updateEngineer(id: number, payload: Record<string, unknown>) {
  return supabase.from("engineers").update(payload).eq("id", id);
}

export async function deletePastEngineerAbsences(beforeDate: string) {
  return supabase.from("engineer_absences").delete().lt("absence_date", beforeDate);
}

export async function getEngineerAbsences<T = unknown>({
  select = "*",
  fromDate,
  orderBy,
}: GetEngineerAbsencesOptions = {}): Promise<T[]> {
  let query = supabase.from("engineer_absences").select(select);

  if (fromDate) {
    query = query.gte("absence_date", fromDate);
  }

  query = applyOrderBy(query, orderBy);

  const { data, error } = await query;

  if (error) {
    console.error("Failed to load engineer absences", error);
    return [];
  }

  return (data as T[]) || [];
}

export async function upsertEngineerAbsences(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return { error: null };

  return supabase.from("engineer_absences").upsert(rows, {
    onConflict: "engineer_id,absence_date",
  });
}

export async function deleteEngineerAbsenceGroup(groupId: string) {
  return supabase.from("engineer_absences").delete().eq("absence_group_id", groupId);
}

export async function deleteEngineerAbsencesByIds(ids: number[]) {
  if (ids.length === 0) return { error: null };

  return supabase.from("engineer_absences").delete().in("id", ids);
}
