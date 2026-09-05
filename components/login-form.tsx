"use client";

import { useState } from "react";

export function LoginForm() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(formData: FormData) {
    setLoading(true);
    setError("");
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: formData.get("email"), password: formData.get("password") }),
    });
    if (!response.ok) {
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(result?.error ?? "Unable to sign in. Check your account details.");
      setLoading(false);
      return;
    }
    window.location.href = "/";
  }

  return (
    <form action={submit} className="login-card">
      <div className="login-brand"><span className="brand__mark"><span>BH</span></span><span>BUILDERS <strong>HUB</strong></span></div>
      <p className="eyebrow">Secure team access</p>
      <h1>Welcome back</h1>
      <p>Sign in to inventory, receiving, scanning and cashier tools.</p>
      <label className="field"><span>Email address</span><input autoComplete="email" name="email" placeholder="name@business.com" required type="email" /></label>
      <label className="field"><span>Password</span><input autoComplete="current-password" name="password" placeholder="Enter your password" required type="password" /></label>
      {error && <div className="form-error" role="alert">{error}</div>}
      <button className="button button--primary button--full" disabled={loading} type="submit">{loading ? "Signing in…" : "Sign in securely"}</button>
      <small>Access and private data are controlled by your assigned role.</small>
    </form>
  );
}

