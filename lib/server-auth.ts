import { getSupabaseServiceClient } from "@/lib/supabase-service";
import type { AppProfile } from "@/lib/auth";

export type ServerAuthResult =
  | {
      ok: true;
      userId: string;
      profile: AppProfile;
    }
  | {
      ok: false;
      response: Response;
    };

function jsonError(message: string, status: number): Response {
  return Response.json({ error: { message } }, { status });
}

export async function requireAppRole(
  request: Request,
  allowedRoles: AppProfile["role"][],
): Promise<ServerAuthResult> {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return {
      ok: false,
      response: jsonError("Authentication required.", 401),
    };
  }

  const supabase = getSupabaseServiceClient();
  const token = match[1];
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return {
      ok: false,
      response: jsonError("Invalid authentication token.", 401),
    };
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      response: jsonError(error.message, 500),
    };
  }

  if (!data) {
    return {
      ok: false,
      response: jsonError("No profile found for this user.", 403),
    };
  }

  const profile = data as AppProfile;
  if (!allowedRoles.includes(profile.role)) {
    return {
      ok: false,
      response: jsonError("Insufficient role.", 403),
    };
  }

  return { ok: true, userId: user.id, profile };
}

export async function requireOfficeUser(
  request: Request,
): Promise<ServerAuthResult> {
  return requireAppRole(request, ["office"]);
}
