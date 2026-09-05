"use client";

import { useCallback, useEffect, useState } from "react";
import { roleLabels } from "@/lib/permissions";
import type { TeamMember, UserRole } from "@/lib/types";

const roleOptions: UserRole[] = ["owner", "manager", "sales_employee", "stock_employee", "cashier"];

export function TeamManagement() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<UserRole>("cashier");
  const [saving, setSaving] = useState(false);
  const [newLogin, setNewLogin] = useState<{ email: string; temporaryPassword: string } | null>(null);

  const load = useCallback(() => {
    fetch("/api/team", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Team list could not be loaded.");
        return result.data as TeamMember[];
      })
      .then(setMembers)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Team list could not be loaded."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNewLogin(null);
    try {
      const response = await fetch("/api/team", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, fullName, role }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Team member could not be added.");
      setNewLogin({ email, temporaryPassword: result.data.temporaryPassword });
      setEmail("");
      setFullName("");
      setRole("cashier");
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Team member could not be added.");
    } finally {
      setSaving(false);
    }
  }

  async function updateMember(id: string, patch: { role?: UserRole; active?: boolean }) {
    setError("");
    const response = await fetch(`/api/team/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      setError(result?.error ?? "Team member could not be updated.");
      return;
    }
    load();
  }

  return (
    <div className="workflow-layout">
      <section className="workflow-card">
        <h2>Add a team member</h2>
        <p>Every employee — including owners — gets their own login. Only the owner role can see cost and profit.</p>
        <form className="form-grid" onSubmit={addMember} style={{ marginTop: 18 }}>
          <label className="field"><span>Full name *</span><input required value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="e.g. Ana Cruz" /></label>
          <label className="field"><span>Email *</span><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@business.com" /></label>
          <label className="field field--wide"><span>Role *</span><select value={role} onChange={(event) => setRole(event.target.value as UserRole)}>{roleOptions.map((item) => <option key={item} value={item}>{roleLabels[item]}</option>)}</select></label>
          <div className="field--wide"><button className="button button--primary" disabled={saving} type="submit">{saving ? "Creating login…" : "Create login"}</button></div>
        </form>
        {error && <div className="error-banner">{error}</div>}
        {newLogin && (
          <div className="success-banner">
            <span>✓</span>
            <div>
              <strong>Login created for {newLogin.email}</strong>
              <p>Temporary password: <code>{newLogin.temporaryPassword}</code></p>
              <p>Share this with them securely — they should sign in and it&apos;s good practice to change it afterwards.</p>
            </div>
          </div>
        )}
      </section>

      <aside className="workflow-summary">
        <span className="summary-kicker">Team</span>
        <h3>{loading ? "Loading…" : `${members.length} member(s)`}</h3>
        <dl>
          {members.map((member) => (
            <div key={member.id}>
              <dt>{member.fullName}<br /><small style={{ color: "var(--muted)" }}>{member.email}</small></dt>
              <dd style={{ display: "grid", gap: 6, justifyItems: "end" }}>
                <select value={member.role} onChange={(event) => updateMember(member.id, { role: event.target.value as UserRole })}>
                  {roleOptions.map((item) => <option key={item} value={item}>{roleLabels[item]}</option>)}
                </select>
                <button className="button button--secondary button--small" type="button" onClick={() => updateMember(member.id, { active: !member.active })}>
                  {member.active ? "Deactivate" : "Reactivate"}
                </button>
              </dd>
            </div>
          ))}
        </dl>
      </aside>
    </div>
  );
}
