import { supabase } from "@/lib/supabase";

export type ExtraActionInsert = {
  description: string;
  responsible_person_team: string;
  due_date?: string | null;
};

export type ExtraAction = {
  id: number;
  description: string;
  responsible_person_team: string;
  due_date: string | null;
  created_at?: string | null;
};

export async function createExtraAction(payload: ExtraActionInsert) {
  return supabase.from("extra_actions").insert({
    description: payload.description,
    responsible_person_team: payload.responsible_person_team,
    due_date: payload.due_date || null,
  });
}

export async function getExtraActions(): Promise<ExtraAction[]> {
  const { data, error } = await supabase
    .from("extra_actions")
    .select("id, description, responsible_person_team, due_date, created_at");

  if (error || !data) return [];
  return data as ExtraAction[];
}

export async function deleteExtraAction(id: number) {
  return supabase.from("extra_actions").delete().eq("id", id);
}

export type ExtraActionUpdate = {
  responsible_person_team?: string;
  due_date?: string | null;
};

export async function updateExtraActionAndFetch(
  id: number,
  payload: ExtraActionUpdate,
) {
  return supabase
    .from("extra_actions")
    .update(payload)
    .eq("id", id)
    .select("id, description, responsible_person_team, due_date, created_at")
    .single();
}

/** Sort helper shared across screens: earliest due date first, no-due-date last. */
export function sortExtraActionsByDueDate<T extends { due_date: string | null }>(
  actions: T[],
): T[] {
  return [...actions].sort((a, b) => {
    if (!a.due_date && !b.due_date) return 0;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date.localeCompare(b.due_date);
  });
}
