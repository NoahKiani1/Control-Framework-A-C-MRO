import { supabase } from "@/lib/supabase";

export type AppRole = "office" | "shop" | "wall";

export type AppProfile = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: AppRole;
};

export async function signInWithPassword(email: string, password: string) {
  return supabase.auth.signInWithPassword({
    email,
    password,
  });
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function getCurrentUser() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  return { user, error };
}

export async function getCurrentProfile(): Promise<{
  profile: AppProfile | null;
  error: { message: string } | null;
}> {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    return { profile: null, error: { message: sessionError.message } };
  }

  if (!session?.user) {
    return { profile: null, error: null };
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role")
    .eq("id", session.user.id)
    .maybeSingle();

  if (error) {
    return { profile: null, error: { message: error.message } };
  }

  if (!data) {
    return { profile: null, error: { message: "No profile found for this user." } };
  }

  return { profile: data as AppProfile, error: null };
}

export function getRouteForRole(role: AppRole): string {
  if (role === "office") return "/dashboard";
  if (role === "shop") return "/shop-form";
  return "/shop";
}
