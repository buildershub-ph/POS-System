"use client";

import { useState } from "react";
import type { Supplier } from "@/lib/types";

type SupplierSelectProps = {
  suppliers: Supplier[];
  value: string;
  onChange(value: string): void;
  onAdd(name: string): Promise<Supplier>;
  required?: boolean;
};

export function SupplierSelect({ suppliers, value, onChange, onAdd, required = false }: SupplierSelectProps) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function createSupplier() {
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const supplier = await onAdd(name.trim());
      onChange(supplier.id);
      setName("");
      setAdding(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Supplier could not be added.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="supplier-control">
      <div className="supplier-control__row">
        <select aria-label="Supplier" required={required} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Select supplier</option>
          {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
        </select>
        <button className="button button--secondary button--small" onClick={() => setAdding((current) => !current)} type="button">＋ New supplier</button>
      </div>
      {adding && <div className="supplier-control__add"><input autoFocus aria-label="New supplier name" onChange={(event) => setName(event.target.value)} placeholder="Supplier name" value={name} /><button className="button button--primary button--small" disabled={saving || !name.trim()} onClick={createSupplier} type="button">{saving ? "Adding…" : "Add"}</button></div>}
      {error && <small className="inline-error">{error}</small>}
    </div>
  );
}
