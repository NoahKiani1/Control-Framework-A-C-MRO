import { supabase } from "@/lib/supabase";
import { DEFAULT_ASSIGNED_PERSON_TEAM, normalizeAssignedPersonTeam } from "@/lib/work-order-rules";
import type { ExtraAction } from "@/lib/extra-actions";

export type CompletedTaskType = "corrective_action" | "additional_task";

export type CompletedTask = {
  id: number;
  source_key: string;
  task_type: CompletedTaskType;
  source_work_order_id: string | null;
  source_extra_action_id: number | null;
  required_next_action: string;
  assigned_person_team: string | null;
  created_at: string;
  closed_at: string;
  inserted_at: string | null;
};

type CorrectiveActionArchiveOrder = {
  work_order_id: string;
  required_next_action: string | null;
  action_owner: string | null;
  action_created_at?: string | null;
  last_manual_update?: string | null;
  last_system_update?: string | null;
};

type CompletedTaskArchivePayload = {
  source_key: string;
  task_type: CompletedTaskType;
  source_work_order_id?: string | null;
  source_extra_action_id?: number | null;
  required_next_action: string;
  assigned_person_team?: string | null;
  created_at: string;
  closed_at: string;
};

const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function retentionCutoffIso(): string {
  return new Date(Date.now() - RETENTION_DAYS * DAY_MS).toISOString();
}

function cleanSourcePart(value: string | null | undefined): string {
  return (value || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
}

async function archiveCompletedTask(payload: CompletedTaskArchivePayload) {
  const cleanupResult = await cleanupCompletedTasks();
  if (cleanupResult.error) {
    console.error("Failed to clean completed task retention", cleanupResult.error);
  }

  const result = await supabase.from("completed_tasks").insert({
    source_key: payload.source_key,
    task_type: payload.task_type,
    source_work_order_id: payload.source_work_order_id ?? null,
    source_extra_action_id: payload.source_extra_action_id ?? null,
    required_next_action: payload.required_next_action,
    assigned_person_team: payload.assigned_person_team ?? null,
    created_at: payload.created_at,
    closed_at: payload.closed_at,
  });

  if (result.error?.code === "23505") {
    return { ...result, error: null };
  }

  return result;
}

export async function cleanupCompletedTasks() {
  return supabase.rpc("cleanup_completed_tasks_retention");
}

export async function getCompletedTasks(): Promise<CompletedTask[]> {
  await cleanupCompletedTasks();

  const { data, error } = await supabase
    .from("completed_tasks")
    .select(
      "id, source_key, task_type, source_work_order_id, source_extra_action_id, required_next_action, assigned_person_team, created_at, closed_at, inserted_at",
    )
    .gte("closed_at", retentionCutoffIso())
    .order("closed_at", { ascending: false });

  if (error || !data) {
    if (error) console.error("Failed to load completed tasks", error);
    return [];
  }

  return data as CompletedTask[];
}

export async function archiveCompletedCorrectiveAction(
  order: CorrectiveActionArchiveOrder,
  closedAt = new Date().toISOString(),
) {
  const action = order.required_next_action?.trim();
  if (!action) {
    return { error: { message: "No corrective action details were available to archive." } };
  }

  const createdAt =
    order.action_created_at ||
    order.last_manual_update ||
    order.last_system_update ||
    closedAt;

  return archiveCompletedTask({
    source_key: `corrective:${cleanSourcePart(order.work_order_id)}:${cleanSourcePart(createdAt)}`,
    task_type: "corrective_action",
    source_work_order_id: order.work_order_id,
    required_next_action: action,
    assigned_person_team: order.action_owner?.trim() || DEFAULT_ASSIGNED_PERSON_TEAM,
    created_at: createdAt,
    closed_at: closedAt,
  });
}

export async function completeExtraAction(action: ExtraAction, closedAt = new Date().toISOString()) {
  const archiveResult = await archiveCompletedTask({
    source_key: `additional:${action.id}`,
    task_type: "additional_task",
    source_extra_action_id: action.id,
    required_next_action: action.description.trim(),
    assigned_person_team: normalizeAssignedPersonTeam(action.responsible_person_team),
    created_at: action.created_at || closedAt,
    closed_at: closedAt,
  });

  if (archiveResult.error) return { error: archiveResult.error };

  return supabase.from("extra_actions").delete().eq("id", action.id);
}
// noah was hier
