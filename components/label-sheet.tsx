"use client";

import { useMemo, useState } from "react";
import { code128Modules } from "@/lib/code128";
import { formatPeso } from "@/lib/mock-data";
import { useInventory } from "@/lib/use-inventory";

// Renders a Code 128 barcode as a vector <svg> so it stays crisp at the
// exact physical label size (40x30mm) regardless of print resolution.
function LabelBarcode({ barcode }: { barcode: string }) {
  const { bars, totalModules } = useMemo(() => {
    try {
      const modules = code128Modules(barcode);
      let position = 0;
      const placed = modules.map((bar) => {
        const x = position;
        position += bar.width;
        return { ...bar, x };
      });
      return { bars: placed, totalModules: position };
    } catch {
      return { bars: [], totalModules: 0 };
    }
  }, [barcode]);
  return (
    <svg preserveAspectRatio="none" viewBox={`0 0 ${totalModules || 1} 40`}>
      <rect fill="#fff" height="40" width={totalModules || 1} x="0" y="0" />
      {bars.map((bar, index) => bar.black ? <rect fill="#000" height="40" key={index} width={bar.width} x={bar.x} y="0" /> : null)}
    </svg>
  );
}

export function LabelSheet() {
  const { categories, products } = useInventory();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filteredProducts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return products.filter((product) => {
      const matchesCategory = category === "All" || product.category === category;
      const matchesQuery = !normalized || [product.productName, product.sku, product.barcode].join(" ").toLowerCase().includes(normalized);
      return matchesCategory && matchesQuery;
    });
  }, [category, products, query]);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllFiltered() {
    setSelected((current) => new Set([...current, ...filteredProducts.map((product) => product.id)]));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  const selectedProducts = products.filter((product) => selected.has(product.id));

  return (
    <section>
      <div className="label-sheet-tools">
        <label className="search-field"><span>⌕</span><input onChange={(event) => setQuery(event.target.value)} placeholder="Search product, SKU or barcode" value={query} /></label>
        <span className="label-sheet-tools__count">{selected.size} item(s) selected for printing (labels are 40×30mm)</span>
        <div className="header-button-group">
          <button className="button button--secondary button--small" onClick={selectAllFiltered} type="button">Select all shown</button>
          <button className="button button--secondary button--small" disabled={!selected.size} onClick={clearSelection} type="button">Clear selection</button>
          <button className="button button--primary button--small" disabled={!selected.size} onClick={() => window.print()} type="button">Print {selected.size || ""} label(s)</button>
        </div>
      </div>

      <div className="chip-row chip-row--compact">{categories.map((item) => <button className={category === item ? "is-active" : ""} key={item} onClick={() => setCategory(item)} type="button">{item}</button>)}</div>

      <div className="label-sheet-grid">
        {filteredProducts.map((product) => (
          <label className={`label-pick ${selected.has(product.id) ? "is-selected" : ""}`} key={product.id}>
            <input checked={selected.has(product.id)} onChange={() => toggle(product.id)} type="checkbox" />
            <span><strong>{product.productName}</strong><small>{product.sku} · {formatPeso(product.srp)}</small></span>
          </label>
        ))}
      </div>
      {!filteredProducts.length && <div className="empty-state"><span>🏷</span><h3>No matching products</h3><p>Try another search or category.</p></div>}

      <div className="print-labels-sheet">
        {selectedProducts.map((product) => (
          <div className="print-label" key={product.id}>
            <p className="print-label__name">{product.productName}</p>
            <LabelBarcode barcode={product.barcode} />
            <p className="print-label__code">{product.barcode}</p>
            {product.sku !== product.barcode && <p className="print-label__code print-label__code--sku">SKU: {product.sku}</p>}
            <p className="print-label__price">{formatPeso(product.srp)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
