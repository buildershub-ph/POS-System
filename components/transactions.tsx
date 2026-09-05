"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatPeso, invoiceNumber, paymentMethods } from "@/lib/mock-data";
import { can } from "@/lib/permissions";
import { useCurrentUser } from "@/lib/use-current-user";
import { useInventory } from "@/lib/use-inventory";
import type { PaymentMethod, SaleHistoryAction, SaleHistoryEntry, SaleRecord } from "@/lib/types";

const statusLabels: Record<SaleRecord["status"], string> = {
  held: "Held",
  quotation: "Quotation",
  completed: "Completed",
  cancelled: "Cancelled",
};

const historyActionLabels: Record<SaleHistoryAction, string> = {
  created_held: "Held as a reservation",
  created_quotation: "Saved as a quotation",
  created_completed: "Sale completed",
  completed: "Reservation completed — stock deducted",
  cancelled: "Sale cancelled",
  payment_recorded: "Payment recorded",
};

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function today() {
  return isoDate(new Date());
}

function startOfWeek() {
  const date = new Date();
  const day = date.getDay();
  const diff = day === 0 ? 6 : day - 1; // Monday as the first day of the week
  date.setDate(date.getDate() - diff);
  return isoDate(date);
}

function startOfMonth() {
  const date = new Date();
  return isoDate(new Date(date.getFullYear(), date.getMonth(), 1));
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
  const [balancePaymentMethod, setBalancePaymentMethod] = useState<PaymentMethod>("cash");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [historyBySale, setHistoryBySale] = useState<Record<string, SaleHistoryEntry[]>>({});
  const [historyLoadingId, setHistoryLoadingId] = useState<string | null>(null);
  const [exportFrom, setExportFrom] = useState(startOfMonth());
  const [exportTo, setExportTo] = useState(today());
  const [statusFilter, setStatusFilter] = useState<"all" | SaleRecord["status"]>("all");
  const [pendingPaymentOnly, setPendingPaymentOnly] = useState(false);
  const [recordingPaymentId, setRecordingPaymentId] = useState<string | null>(null);
  const [recordPaymentMethod, setRecordPaymentMethod] = useState<PaymentMethod>("cash");
  const [recordPaymentDate, setRecordPaymentDate] = useState(today());
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
        body: JSON.stringify({ balancePaidAt: `${balancePaidDate}T00:00:00`, balancePaymentMethod }),
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

  async function recordPayment(sale: SaleRecord) {
    setPayingId(sale.id);
    setError("");
    try {
      const response = await fetch(`/api/sales/${sale.id}/mark-paid`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paidAt: `${recordPaymentDate}T00:00:00`, paymentMethod: recordPaymentMethod }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Payment could not be recorded.");
      setRecordingPaymentId(null);
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Payment could not be recorded.");
    } finally {
      setPayingId(null);
    }
  }

  const filteredSales = useMemo(
    () => sales.filter((sale) => (statusFilter === "all" || sale.status === statusFilter) && (!pendingPaymentOnly || sale.paymentStatus === "pending")),
    [sales, statusFilter, pendingPaymentOnly],
  );

  function lineLabel(line: SaleRecord["lines"][number]) {
    if (line.customItemName) return `${line.customItemName}${line.customSku ? ` (${line.customSku})` : ""} — custom`;
    return line.productName ?? products.find((product) => product.id === line.variantId)?.productName ?? "Unknown item";
  }

  function toggleDetails(sale: SaleRecord) {
    const next = expandedId === sale.id ? null : sale.id;
    setExpandedId(next);
    if (next && !historyBySale[sale.id]) {
      setHistoryLoadingId(sale.id);
      fetch(`/api/sales/${sale.id}/history`, { cache: "no-store" })
        .then(async (response) => {
          const result = await response.json();
          if (!response.ok) throw new Error(result.error ?? "History could not be loaded.");
          return result.data as SaleHistoryEntry[];
        })
        .then((entries) => setHistoryBySale((current) => ({ ...current, [sale.id]: entries })))
        .catch(() => setHistoryBySale((current) => ({ ...current, [sale.id]: [] })))
        .finally(() => setHistoryLoadingId(null));
    }
  }

  const exportUrl = useMemo(
    () => `/api/sales/export?from=${exportFrom}&to=${exportTo}`,
    [exportFrom, exportTo],
  );
  const exportRangeInvalid = exportFrom > exportTo;

  return (
    <section>
      {error && <div className="error-banner">{error}</div>}
      <div className="transactions-export">
        <div>
          <h3>Export transactions</h3>
          <p>Pick a range, or use a quick preset, then download as CSV for reporting.</p>
        </div>
        <div className="transactions-export__controls">
          <label className="field"><span>From</span><input onChange={(event) => setExportFrom(event.target.value)} type="date" value={exportFrom} /></label>
          <label className="field"><span>To</span><input onChange={(event) => setExportTo(event.target.value)} type="date" value={exportTo} /></label>
          <div className="transactions-export__presets">
            <button className="button button--secondary button--small" onClick={() => { setExportFrom(today()); setExportTo(today()); }} type="button">Today</button>
            <button className="button button--secondary button--small" onClick={() => { setExportFrom(startOfWeek()); setExportTo(today()); }} type="button">This week</button>
            <button className="button button--secondary button--small" onClick={() => { setExportFrom(startOfMonth()); setExportTo(today()); }} type="button">This month</button>
          </div>
          <a
            aria-disabled={exportRangeInvalid}
            className="button button--primary button--small"
            href={exportRangeInvalid ? undefined : exportUrl}
            onClick={(event) => { if (exportRangeInvalid) event.preventDefault(); }}
          >
            Download CSV
          </a>
        </div>
        {exportRangeInvalid && <p className="transactions-export__error">The &ldquo;From&rdquo; date must be on or before the &ldquo;To&rdquo; date.</p>}
      </div>
      <div className="transactions-filters">
        <div className="chip-row chip-row--compact">
          {(["all", "held", "quotation", "completed", "cancelled"] as const).map((value) => (
            <button className={statusFilter === value ? "is-active" : ""} key={value} onClick={() => setStatusFilter(value)} type="button">
              {value === "all" ? "All" : statusLabels[value]}
            </button>
          ))}
        </div>
        <label className="checkbox-field checkbox-field--inline">
          <input checked={pendingPaymentOnly} onChange={(event) => setPendingPaymentOnly(event.target.checked)} type="checkbox" />
          <span>Pending payment only</span>
        </label>
      </div>
      {loading ? (
        <p>Loading transactions…</p>
      ) : !filteredSales.length ? (
        <div className="empty-state"><span>⇄</span><h3>No matching transactions</h3><p>{sales.length ? "Try a different filter." : "Sales made in Cashier Mode will show up here."}</p></div>
      ) : (
        <div className="transactions-list">
          {filteredSales.map((sale) => {
            const expanded = expandedId === sale.id;
            const history = historyBySale[sale.id];
            return (
              <article className="transaction-card" key={sale.id}>
                <div className="transaction-card__head">
                  <div>
                    <strong>{invoiceNumber(sale.saleNumber)}</strong>
                    <span className={`transaction-status transaction-status--${sale.status}`}>{statusLabels[sale.status]}</span>
                    {sale.status === "completed" && sale.paymentStatus === "pending" && (
                      <span className="transaction-status transaction-status--pending-payment">Payment Pending</span>
                    )}
                  </div>
                  <span>{formatDate(sale.createdAt)}</span>
                </div>
                <div className="transaction-card__body">
                  <div>
                    <small>Customer</small>
                    <p>{sale.customerName ?? "—"}{sale.customerContactNumber && <><br /><small>{sale.customerContactNumber}</small></>}</p>
                  </div>
                  <div>
                    <small>Sold by</small>
                    <p>{sale.createdByName ?? "—"}</p>
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
                    {sale.balancePaidAt && <span>Balance paid: <strong>{new Date(sale.balancePaidAt).toLocaleDateString("en-PH")}{sale.balancePaymentMethod ? ` (${sale.balancePaymentMethod.replaceAll("_", " ")})` : ""}</strong></span>}
                  </div>
                )}
                {sale.notes && <p className="transaction-card__note">{sale.notes}</p>}
                <div className="transaction-card__actions">
                  <button className="button button--secondary button--small" onClick={() => toggleDetails(sale)} type="button">
                    {expanded ? "Hide order details" : "View order details"}
                  </button>
                  {sale.status === "completed" && sale.paymentStatus === "pending" && canProcessSale && recordingPaymentId !== sale.id && (
                    <button className="button button--primary button--small" onClick={() => { setRecordingPaymentId(sale.id); setRecordPaymentDate(today()); setRecordPaymentMethod("cash"); }} type="button">
                      Record payment received
                    </button>
                  )}
                  {sale.status === "completed" && canCancel && (
                    <button className="button button--secondary button--small" disabled={cancellingId === sale.id} onClick={() => cancelSale(sale)} type="button">
                      {cancellingId === sale.id ? "Cancelling…" : "Cancel & Return Stock"}
                    </button>
                  )}
                  {(sale.status === "held" || sale.status === "quotation") && (
                    <>
                      {canProcessSale && completingId !== sale.id && (
                        <button className="button button--primary button--small" onClick={() => { setCompletingId(sale.id); setBalancePaidDate(today()); setBalancePaymentMethod("cash"); }} type="button">
                          {sale.status === "held" ? "Customer picked up — complete sale" : "Convert to completed sale"}
                        </button>
                      )}
                      {canCancel && (
                        <button className="button button--secondary button--small" disabled={cancellingId === sale.id} onClick={() => cancelSale(sale)} type="button">
                          {cancellingId === sale.id ? "Cancelling…" : "Cancel"}
                        </button>
                      )}
                    </>
                  )}
                </div>
                {recordingPaymentId === sale.id && (
                  <div className="transaction-card__complete-form">
                    <label className="field"><span>Paid on</span><input onChange={(event) => setRecordPaymentDate(event.target.value)} type="date" value={recordPaymentDate} /></label>
                    <label className="field"><span>Mode of payment</span><select onChange={(event) => setRecordPaymentMethod(event.target.value as PaymentMethod)} value={recordPaymentMethod}>{paymentMethods.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}</select></label>
                    <div className="transaction-card__complete-form__actions">
                      <button className="button button--secondary button--small" onClick={() => setRecordingPaymentId(null)} type="button">Cancel</button>
                      <button className="button button--primary button--small" disabled={payingId === sale.id} onClick={() => recordPayment(sale)} type="button">{payingId === sale.id ? "Recording…" : "Confirm payment"}</button>
                    </div>
                  </div>
                )}
                {completingId === sale.id && (
                  <div className="transaction-card__complete-form">
                    <label className="field"><span>Balance paid on</span><input onChange={(event) => setBalancePaidDate(event.target.value)} type="date" value={balancePaidDate} /></label>
                    <label className="field"><span>Mode of payment</span><select onChange={(event) => setBalancePaymentMethod(event.target.value as PaymentMethod)} value={balancePaymentMethod}>{paymentMethods.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}</select></label>
                    <div className="transaction-card__complete-form__actions">
                      <button className="button button--secondary button--small" onClick={() => setCompletingId(null)} type="button">Cancel</button>
                      <button className="button button--primary button--small" disabled={payingId === sale.id} onClick={() => completeSale(sale)} type="button">{payingId === sale.id ? "Completing…" : "Confirm & deduct stock"}</button>
                    </div>
                  </div>
                )}
                {expanded && (
                  <div className="transaction-card__details">
                    <div className="transaction-card__lines">
                      <h4>Order details</h4>
                      <table>
                        <thead>
                          <tr><th>Item</th><th>SKU</th><th>Qty</th><th>SRP</th><th>Sold at</th><th>Discount reason</th></tr>
                        </thead>
                        <tbody>
                          {sale.lines.map((line, index) => (
                            <tr key={index}>
                              <td>{lineLabel(line)}</td>
                              <td>{line.sku ?? line.customSku ?? "—"}</td>
                              <td>{line.quantity}</td>
                              <td>{formatPeso(line.originalSrp)}</td>
                              <td>{formatPeso(line.actualSellingPrice)}</td>
                              <td>{line.discountReason ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="transaction-card__history">
                      <h4>History of edits</h4>
                      {historyLoadingId === sale.id ? (
                        <p>Loading history…</p>
                      ) : !history?.length ? (
                        <p>No history recorded.</p>
                      ) : (
                        <ul>
                          {history.map((entry) => (
                            <li key={entry.id}>
                              <strong>{historyActionLabels[entry.action] ?? entry.action}</strong>
                              <span>{entry.actorName ?? "Unknown user"} · {formatDate(entry.createdAt)}</span>
                              {entry.note && <em>{entry.note}</em>}
                            </li>
                          ))}
                        </ul>
                      )}
                      {(sale.completedByName || sale.cancelledByName || sale.paidByName) && (
                        <p className="transaction-card__history-summary">
                          {sale.completedByName && <>Completed by <strong>{sale.completedByName}</strong>. </>}
                          {sale.paidByName && <>Payment recorded by <strong>{sale.paidByName}</strong>{sale.paidAt ? ` on ${formatDate(sale.paidAt)}` : ""}. </>}
                          {sale.cancelledByName && <>Cancelled by <strong>{sale.cancelledByName}</strong>{sale.cancelledAt ? ` on ${formatDate(sale.cancelledAt)}` : ""}.</>}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
