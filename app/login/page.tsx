"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getCurrentProfile, getRouteForRole, signInWithPassword } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    async function checkExistingSession() {
      const { profile, error } = await getCurrentProfile();

      if (error) {
        setStatus(`Error: ${error.message}`);
        setCheckingSession(false);
        return;
      }

      if (profile) {
        router.replace(getRouteForRole(profile.role));
        return;
      }

      setCheckingSession(false);
    }

    void checkExistingSession();
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setStatus("");

    const { error: signInError } = await signInWithPassword(email, password);

    if (signInError) {
      setStatus(`Error: ${signInError.message}`);
      setLoading(false);
      return;
    }

    const { profile, error: profileError } = await getCurrentProfile();

    if (profileError) {
      setStatus(`Error: ${profileError.message}`);
      setLoading(false);
      return;
    }

    if (!profile) {
      setStatus("Error: No profile found for this account.");
      setLoading(false);
      return;
    }

    router.replace(getRouteForRole(profile.role));
  }

  if (checkingSession) {
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          backgroundColor: "#f2efe9",
          fontFamily: "var(--font-inter), var(--font-geist-sans), sans-serif",
        }}
      >
        Checking session...
      </main>
    );
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        backgroundColor: "#f2efe9",
        padding: "24px",
        fontFamily: "var(--font-inter), var(--font-geist-sans), sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "420px",
          backgroundColor: "#ffffff",
          border: "1px solid #e5e7eb",
          borderRadius: "16px",
          padding: "28px",
          boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)",
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: "28px",
            fontWeight: 700,
            color: "#0f172a",
          }}
        >
          Sign in
        </h1>

        <p
          style={{
            marginTop: "8px",
            marginBottom: "22px",
            color: "#475569",
            fontSize: "14px",
            lineHeight: 1.5,
          }}
        >
          Log in with the Office, Shop, Screen, or Developer account.
        </p>

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: "14px" }}>
          <div>
            <label
              htmlFor="email"
              style={{
                display: "block",
                marginBottom: "6px",
                fontSize: "13px",
                fontWeight: 600,
                color: "#334155",
              }}
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: "10px",
                border: "1px solid #cbd5e1",
                fontSize: "14px",
                boxSizing: "border-box",
              }}
            />
          </div>

          <div>
            <label
              htmlFor="password"
              style={{
                display: "block",
                marginBottom: "6px",
                fontSize: "13px",
                fontWeight: 600,
                color: "#334155",
              }}
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: "10px",
                border: "1px solid #cbd5e1",
                fontSize: "14px",
                boxSizing: "border-box",
              }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: "4px",
              padding: "11px 14px",
              border: "none",
              borderRadius: "10px",
              backgroundColor: "#2563eb",
              color: "white",
              fontSize: "14px",
              fontWeight: 700,
              cursor: loading ? "default" : "pointer",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        {status && (
          <div
            style={{
              marginTop: "16px",
              padding: "10px 12px",
              borderRadius: "10px",
              border: "1px solid #fecaca",
              backgroundColor: "#fef2f2",
              color: "#b91c1c",
              fontSize: "13px",
              lineHeight: 1.5,
            }}
          >
            {status}
          </div>
        )}
      </div>
    </main>
  );
}