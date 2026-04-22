import { supabase } from "@/lib/supabase";

type OrderBy = {
  column: string;
  ascending?: boolean;
};

type GetEngineersOptions = {
  select?: string;
  isActive?: boolean;
  role?: string;
  startedOn?: string;
  orderBy?: OrderBy | OrderBy[];
};

type GetEngineerAbsencesOptions = {
  select?: string;
  fromDate?: string;
  orderBy?: OrderBy | OrderBy[];
};

type OrderableQuery = {
  order: (column: string, options: { ascending: boolean }) => unknown;
};

const STAFF_PHOTOS_BUCKET = "staff-photos";

type EmploymentDatedEngineer = {
  employment_start_date?: string | null;
};

function ensureEmploymentStartDateSelected(select: string): string {
  if (select.trim() === "*") return select;
  if (/\bemployment_start_date\b/.test(select)) return select;
  return `${select}, employment_start_date`;
}

export function isEngineerStartedOnDateKey<T extends EmploymentDatedEngineer>(
  engineer: T,
  dateKey: string,
): boolean {
  const employmentStartDate = engineer.employment_start_date?.trim();
  return !employmentStartDate || employmentStartDate <= dateKey;
}

export function filterEngineersStartedOnDateKey<T extends EmploymentDatedEngineer>(
  engineers: T[],
  dateKey: string,
): T[] {
  return engineers.filter((engineer) => isEngineerStartedOnDateKey(engineer, dateKey));
}

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

export async function getEngineers<T = unknown>({
  select = "*",
  isActive,
  role,
  startedOn,
  orderBy,
}: GetEngineersOptions = {}): Promise<T[]> {
  let query = supabase
    .from("engineers")
    .select(startedOn ? ensureEmploymentStartDateSelected(select) : select);

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

  const engineers = ((data as T[]) || []) as Array<T & EmploymentDatedEngineer>;

  if (!startedOn) {
    return engineers as T[];
  }

  return filterEngineersStartedOnDateKey(engineers, startedOn) as T[];
}

export async function insertEngineer(payload: Record<string, unknown>) {
  return supabase.from("engineers").insert(payload);
}

export async function updateEngineer(id: number, payload: Record<string, unknown>) {
  return supabase.from("engineers").update(payload).eq("id", id);
}

export async function deleteEngineerPhoto(photoPath: string | null | undefined) {
  if (!photoPath) return { error: null };

  const { error } = await supabase.storage
    .from(STAFF_PHOTOS_BUCKET)
    .remove([photoPath]);

  return { error };
}

export async function uploadEngineerPhoto(
  engineerId: number,
  file: File,
  previousPhotoPath?: string | null,
) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const safeExtension = extension.replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${engineerId}/${Date.now()}.${safeExtension}`;

  const { error: uploadError } = await supabase.storage
    .from(STAFF_PHOTOS_BUCKET)
    .upload(path, file, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    return { path: null, error: uploadError };
  }

  const { error: updateError } = await updateEngineer(engineerId, {
    photo_path: path,
  });

  if (updateError) {
    await deleteEngineerPhoto(path);
    return { path: null, error: updateError, cleanupError: null };
  }

  const { error: cleanupError } = await deleteEngineerPhoto(previousPhotoPath);

  return { path, error: null, cleanupError };
}

export function getEngineerPhotoUrl(photoPath: string | null | undefined): string | null {
  if (!photoPath) return null;

  const { data } = supabase.storage
    .from(STAFF_PHOTOS_BUCKET)
    .getPublicUrl(photoPath);

  return data.publicUrl;
}

export async function deleteEngineer(id: number) {
  return supabase.from("engineers").delete().eq("id", id);
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
