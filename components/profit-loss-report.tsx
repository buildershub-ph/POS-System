"use client";

import { useEffect, useMemo, useState } from "react";
import { formatPeso, invoiceNumber } from "@/lib/mock-data";
import { itemTypeLabels, summarizeProfitLoss, type ProfitLossItemType, type ProfitLossLine } from "@/lib/profit-loss";

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function today() {
  return isoDate(new Date());
}

function startOfMonth() {
  const date = new Date();
  return isoDate(new Date(date.getFullYear(), date.getMonth(), 1));
}

function startOfYear() {
  return isoDate(new Date(new Date().getFullYear(), 0, 1));
}

// Far enough back to cover every sale ever recorded.
const allTimeFrom = "2020-01-01";

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-PH", { dateStyle: "medium" });
}

function formatPercent(value: number | null) {
  return value == null ? "—" : `${value.toFixed(1)}%`;
}

function profitClass(value: number) {
  return value < 0 ? "pl-negative" : "pl-positive";
}

export function ProfitLossReport() {
  const [from, setFrom] = useState(allTimeFrom);
  const [to, setTo] = useState(today());
  const [lines, setLines] = useState<ProfitLossLine[] | null>(null);
  const [loadedRange, setLoadedRange] = useState("");
  const [error, setError] = useState("");
  const [view, setView] = useState<"items" | "sales">("items");
  const [typeFilter, setTypeFilter] = useState<"all" | ProfitLossItemType>("all");
  const rangeInvalid = from > to;
  const range = `${from}|${to}`;
  const loading = !rangeInvalid && loadedRange !== range;

  useEffect(() => {
    if (rangeInvalid) return;
    let active = true;
    fetch(`/api/reports/profit-loss?from=${from}&to=${to}`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "The report could not be loaded.");
        return result.data as ProfitLossLine[];
      })
      .then((data) => { if (active) { setLines(data); setError(""); } })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "The report could not be loaded."); })
      .finally(() => { if (active) setLoadedRange(`${from}|${to}`); });
    return () => { active = false; };
  }, [from, to, rangeInvalid]);

  const report = useMemo(
    () => (lines ? summarizeProfitLoss(typeFilter === "all" ? lines : lines.filter((line) => line.type === typeFilter)) : null),
    [lines, typeFilter],
  );
  const summary = report?.summary;
  const typeQuery = typeFilter === "all" ? "" : `&type=${typeFilter}`;

  return (
    <section>
      {error && <div className="error-banner">{error}</div>}
      <div className="transactions-export">
        <div>
          <h3>Report period</h3>
          <p>Completed sales only. In-stock items cost their landed cost; custom items cost what they sold for, so they carry no profit.</p>
        </div>
        <div className="transactions-export__controls">
          <label className="field"><span>From</span><input onChange={(event) => setFrom(event.target.value)} type="date" value={from} /></label>
          <label className="field"><span>To</span><input onChange={(event) => setTo(event.target.value)} type="date" value={to} /></label>
          <div className="transactions-export__presets">
            <button className="button button--secondary button--small" onClick={() => { setFrom(today()); setTo(today()); }} type="button">Today</button>
            <button className="button button--secondary button--small" onClick={() => { setFrom(startOfMonth()); setTo(today()); }} type="button">This month</button>
            <button className="button button--secondary button--small" onClick={() => { setFrom(startOfYear()); setTo(today()); }} type="button">This year</button>
            <button className="button button--secondary button--small" onClick={() => { setFrom(allTimeFrom); setTo(today()); }} type="button">All time</button>
          </div>
          <a
            aria-disabled={rangeInvalid}
            className="button button--primary button--small"
            href={rangeInvalid ? undefined : `/api/reports/profit-loss?from=${from}&to=${to}&format=csv${typeQuery}`}
            onClick={(event) => { if (rangeInvalid) event.preventDefault(); }}
          >
            Download CSV
          </a>
        </div>
        {rangeInvalid && <p className="transactions-export__error">The &ldquo;From&rdquo; date must be on or before the &ldquo;To&rdquo; date.</p>}
      </div>

      <div className="chip-row chip-row--compact pl-type-filter">
        {(["all", "in_stock", "custom"] as const).map((value) => (
          <button className={typeFilter === value ? "is-active" : ""} key={value} onClick={() => setTypeFilter(value)} type="button">
            {value === "all" ? "All items" : itemTypeLabels[value]}
          </button>
        ))}
      </div>

      {loading && !report ? (
        <p>Loading report…</p>
      ) : !summary || summary.saleCount === 0 ? (
        !error && <div className="empty-state"><span>₱</span><h3>No completed sales in this period</h3><p>Pick a wider date range or a different item type to see profit and loss.</p></div>
      ) : (
        <>
          <div className="pl-statement">
            <dl>
              <div><dt>Gross sales <small>({summary.saleCount} completed {summary.saleCount === 1 ? "sale" : "sales"})</small></dt><dd>{formatPeso(summary.grossSales)}</dd></div>
              <div><dt>Less: whole-sale discounts</dt><dd>({formatPeso(summary.totalDiscounts)})</dd></div>
              <div className="pl-statement__subtotal"><dt>Net sales</dt><dd>{formatPeso(summary.netSales)}</dd></div>
              <div><dt>Less: cost of goods sold</dt><dd>({formatPeso(summary.costOfGoodsSold)})</dd></div>
              <div className="pl-statement__total"><dt>Gross profit</dt><dd className={profitClass(summary.grossProfit)}>{formatPeso(summary.grossProfit)}</dd></div>
              <div><dt>Gross margin</dt><dd>{formatPercent(summary.marginPercent)}</dd></div>
            </dl>
            <ul className="pl-notes">
              <li>In-stock item sales: <strong>{formatPeso(summary.inStockSales)}</strong></li>
              <li>Custom item sales (cost = sold price, no profit): <strong>{formatPeso(summary.customItemSales)}</strong></li>
              <li>Net sales still unpaid (pay later): <strong>{formatPeso(summary.unpaidNetSales)}</strong></li>
              {summary.missingCostItemCount > 0 && (
                <li className="pl-warning">
                  {summary.missingCostItemCount} in-stock {summary.missingCostItemCount === 1 ? "item has" : "items have"} no cost on file and {summary.missingCostItemCount === 1 ? "was" : "were"} counted at zero cost, so profit on {summary.missingCostItemCount === 1 ? "it" : "them"} is overstated.
                </li>
              )}
            </ul>
          </div>

          <div className="chip-row chip-row--compact pl-tabs">
            <button className={view === "items" ? "is-active" : ""} onClick={() => setView("items")} type="button">By item</button>
            <button className={view === "sales" ? "is-active" : ""} onClick={() => setView("sales")} type="button">By transaction</button>
          </div>

          {view === "items" ? (
            <div className="pl-table">
              <div className="pl-table__header pl-table__row--items">
                <span>Item</span><span>Qty sold</span><span>Unit cost</span><span>Sales</span><span>Cost</span><span>Gross profit</span><span>Margin</span>
              </div>
              {report.items.map((item) => (
                <div className="pl-table__row pl-table__row--items" key={item.key}>
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {itemTypeLabels[item.type]}
                      {item.sku && ` · ${item.sku}`}
                      {item.type === "custom" && " · cost = sold price"}
                      {item.missingCost && <em className="pl-warning"> No cost on file</em>}
                    </small>
                  </span>
                  <span>{item.quantity}</span>
                  <span>{formatPeso(item.unitCost)}</span>
                  <span>{formatPeso(item.sales)}</span>
                  <span>{formatPeso(item.cost)}</span>
                  <span className={profitClass(item.grossProfit)}><strong>{formatPeso(item.grossProfit)}</strong></span>
                  <span>{formatPercent(item.marginPercent)}</span>
                </div>
              ))}
              <p className="pl-table__footnote">Sales are after whole-sale discounts, split across each sale&apos;s items by value.</p>
            </div>
          ) : (
            <div className="pl-table">
              <div className="pl-table__header pl-table__row--sales">
                <span>Invoice</span><span>Date</span><span>Customer</span><span>Net sales</span><span>Cost</span><span>Gross profit</span><span>Margin</span>
              </div>
              {[...report.sales].reverse().map((sale) => (
                <div className="pl-table__row pl-table__row--sales" key={sale.id}>
                  <span>
                    <strong>{invoiceNumber(sale.saleNumber)}</strong>
                    <small>
                      {sale.paymentStatus === "pending" && "Unpaid · "}
                      {sale.discount > 0 && `Discount ${formatPeso(sale.discount)} · `}
                      {sale.hasCustomItems && "Custom items"}
                      {sale.hasMissingCost && <em className="pl-warning"> Missing cost</em>}
                    </small>
                  </span>
                  <span>{formatDate(sale.createdAt)}</span>
                  <span>{sale.customerName ?? "—"}</span>
                  <span>{formatPeso(sale.sales)}</span>
                  <span>{formatPeso(sale.cost)}</span>
                  <span className={profitClass(sale.grossProfit)}><strong>{formatPeso(sale.grossProfit)}</strong></span>
                  <span>{formatPercent(sale.marginPercent)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
