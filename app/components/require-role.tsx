"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppRole, getCurrentProfile, getRouteForRole } from "@/lib/auth";

type RequireRoleProps = {
  allowedRoles: AppRole[];
  children: React.ReactNode;
};

export function RequireRole({ allowedRoles, children }: RequireRoleProps) {
  const router = useRouter();
  const [status, setStatus] = useState<"checking" | "allowed" | "blocked">("checking");

  useEffect(() => {
    async function checkRole() {
      const { profile, error } = await getCurrentProfile();

      if (error) {
        router.replace("/login");
        return;
      }

      if (!profile) {
        router.replace("/login");
        return;
      }

      if (!allowedRoles.includes(profile.role)) {
        router.replace(getRouteForRole(profile.role));
        return;
      }

      setStatus("allowed");
    }

    void checkRole();
  }, [allowedRoles, router]);

  if (status !== "allowed") {
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          backgroundColor: "#f2efe9",
          color: "#475569",
          fontFamily: "var(--font-inter), var(--font-geist-sans), sans-serif",
        }}
      >
        Checking access...
      </main>
    );
  }

  return <>{children}</>;
}