"use client";

import { useCallback, useEffect, useState } from "react";
import { formatPeso, invoiceNumber } from "@/lib/mock-data";
import { can } from "@/lib/permissions";
import { useCurrentUser } from "@/lib/use-current-user";
import { useInventory } from "@/lib/use-inventory";
import type { SaleRecord } from "@/lib/types";

const statusLabels: Record<SaleRecord["status"], string> = {
  held: "Held",
  quotation: "Quotation",
  completed: "Completed",
  cancelled: "Cancelled",
};

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function Transactions() {
  const { user } = useCurrentUser();
  const { products, refetch } = useInventory();
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [balancePaidDate, setBalancePaidDate] = useState(today());
  const canCancel = can(user.role, "transferStock");
  const canProcessSale = can(user.role, "processSale");

  const load = useCallback(() => {
    fetch("/api/sales", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Transactions could not be loaded.");
        return result.data as SaleRecord[];
      })
      .then(setSales)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Transactions could not be loaded."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function cancelSale(sale: SaleRecord) {
    if (!confirm(`Cancel ${invoiceNumber(sale.saleNumber)}? This will return the sold items to stock.`)) return;
    setCancellingId(sale.id);
    setError("");
    try {
      const response = await fetch(`/api/sales/${sale.id}/cancel`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Sale could not be cancelled.");
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sale could not be cancelled.");
    } finally {
      setCancellingId(null);
    }
  }

  async function completeSale(sale: SaleRecord) {
    setPayingId(sale.id);
    setError("");
    try {
      const response = await fetch(`/api/sales/${sale.id}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ balancePaidAt: `${balancePaidDate}T00:00:00` }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Sale could not be completed.");
      setCompletingId(null);
      load();
      refetch();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sale could not be completed.");
    } finally {
      setPayingId(null);
    }
  }

  function lineLabel(line: SaleRecord["lines"][number]) {
    if (line.customItemName) return `${line.customItemName}${line.customSku ? ` (${line.customSku})` : ""} — custom`;
    return products.find((product) => product.id === line.variantId)?.productName ?? "Unknown item";
  }

  return (
    <section>
      {error && <div className="error-banner">{error}</div>}
      {loading ? (
        <p>Loading transactions…</p>
      ) : !sales.length ? (
        <div className="empty-state"><span>⇄</span><h3>No transactions yet</h3><p>Sales made in Cashier Mode will show up here.</p></div>
      ) : (
        <div className="transactions-list">
          {sales.map((sale) => (
            <article className="transaction-card" key={sale.id}>
              <div className="transaction-card__head">
                <div>
                  <strong>{invoiceNumber(sale.saleNumber)}</strong>
                  <span className={`transaction-status transaction-status--${sale.status}`}>{statusLabels[sale.status]}</span>
                </div>
                <span>{formatDate(sale.createdAt)}</span>
              </div>
              <div className="transaction-card__body">
                <div>
                  <small>Customer</small>
                  <p>{sale.customerName ?? "—"}{sale.customerContactNumber && <><br /><small>{sale.customerContactNumber}</small></>}</p>
                </div>
                <div>
                  <small>Payment</small>
                  <p>{sale.paymentMethod ? sale.paymentMethod.replaceAll("_", " ") : "—"}</p>
                </div>
                <div>
                  <small>Items</small>
                  <p>{sale.lines.map((line) => `${lineLabel(line)} × ${line.quantity}`).join(", ")}</p>
                </div>
                <div>
                  <small>Total</small>
                  <p><strong>{formatPeso(sale.totalAmount)}</strong>{sale.totalAmount < sale.totalSrp && <small> (SRP {formatPeso(sale.totalSrp)})</small>}</p>
                </div>
              </div>
              {sale.downpaymentAmount > 0 && (
                <div className="transaction-card__reservation">
                  <span>Downpayment: <strong>{formatPeso(sale.downpaymentAmount)}</strong></span>
                  <span>Balance due: <strong>{formatPeso(sale.balanceDue)}</strong></span>
                  {sale.balancePaidAt && <span>Balance paid: <strong>{new Date(sale.balancePaidAt).toLocaleDateString("en-PH")}</strong></span>}
                </div>
              )}
              {sale.notes && <p className="transaction-card__note">{sale.notes}</p>}
              {sale.status === "completed" && canCancel && (
                <div className="transaction-card__actions">
                  <button className="button button--secondary button--small" disabled={cancellingId === sale.id} onClick={() => cancelSale(sale)} type="button">
                    {cancellingId === sale.id ? "Cancelling…" : "Cancel & Return Stock"}
                  </button>
                </div>
              )}
              {(sale.status === "held" || sale.status === "quotation") && (
                <div className="transaction-card__actions">
                  {canProcessSale && completingId !== sale.id && (
                    <button className="button button--primary button--small" onClick={() => { setCompletingId(sale.id); setBalancePaidDate(today()); }} type="button">
                      {sale.status === "held" ? "Customer picked up — complete sale" : "Convert to completed sale"}
                    </button>
                  )}
                  {canCancel && (
                    <button className="button button--secondary button--small" disabled={cancellingId === sale.id} onClick={() => cancelSale(sale)} type="button">
                      {cancellingId === sale.id ? "Cancelling…" : "Cancel"}
                    </button>
                  )}
                </div>
              )}
              {completingId === sale.id && (
                <div className="transaction-card__complete-form">
                  <label className="field"><span>Balance paid on</span><input onChange={(event) => setBalancePaidDate(event.target.value)} type="date" value={balancePaidDate} /></label>
                  <div className="transaction-card__complete-form__actions">
                    <button className="button button--secondary button--small" onClick={() => setCompletingId(null)} type="button">Cancel</button>
                    <button className="button button--primary button--small" disabled={payingId === sale.id} onClick={() => completeSale(sale)} type="button">{payingId === sale.id ? "Completing…" : "Confirm & deduct stock"}</button>
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
