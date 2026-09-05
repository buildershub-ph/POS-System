"use client";

import { useEffect, useMemo, useState } from "react";
import { formatPeso } from "@/lib/mock-data";
import type { CustomerSummary } from "@/lib/types";

function formatDate(value?: string) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-PH", { dateStyle: "medium" });
}

export function Customers() {
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/customers", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Customers could not be loaded.");
        return result.data as CustomerSummary[];
      })
      .then(setCustomers)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Customers could not be loaded."))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const list = !normalized
      ? customers
      : customers.filter((customer) => `${customer.name} ${customer.phone ?? ""}`.toLowerCase().includes(normalized));
    return [...list].sort((a, b) => b.totalSpent - a.totalSpent);
  }, [customers, query]);

  return (
    <section>
      {error && <div className="error-banner">{error}</div>}
      <label className="search-field search-field--large">
        <span>⌕</span>
        <input aria-label="Search customers" onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or phone number" value={query} />
      </label>
      {loading ? (
        <p>Loading customers…</p>
      ) : !filtered.length ? (
        <div className="empty-state"><span>☺</span><h3>No customers yet</h3><p>Customers are recognised automatically from the name and contact number entered in Cashier Mode.</p></div>
      ) : (
        <div className="customers-table">
          <div className="customers-table__header">
            <span>Customer</span><span>Phone</span><span>Orders</span><span>Total spent</span><span>First purchase</span><span>Last purchase</span>
          </div>
          {filtered.map((customer, index) => (
            <div className="customers-table__row" key={customer.id}>
              <span className="customers-table__rank">{index < 3 && customer.totalSpent > 0 ? "★" : ""} {customer.name}</span>
              <span>{customer.phone ?? "—"}</span>
              <span>{customer.completedOrders}</span>
              <span><strong>{formatPeso(customer.totalSpent)}</strong></span>
              <span>{formatDate(customer.firstPurchaseAt)}</span>
              <span>{formatDate(customer.lastPurchaseAt)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
