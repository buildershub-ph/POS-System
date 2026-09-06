"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { formatPeso } from "@/lib/mock-data";
import { useInventory } from "@/lib/use-inventory";
import { ProductArtwork } from "./product-artwork";
import { StockBadge } from "./stock-badge";

type StockFilter = "all" | "low-stock" | "out-of-stock";

export function InventoryCatalogue() {
  const { categories, loading, products, error, refetch } = useInventory();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [availableOnly, setAvailableOnly] = useState(false);
  const [stockFilter, setStockFilter] = useState<StockFilter>(() => {
    const view = searchParams.get("view");
    return view === "low-stock" || view === "out-of-stock" ? view : "all";
  });

  const filteredProducts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return products.filter((product) => {
      const matchesCategory = category === "All" || product.category === category;
      const matchesAvailability = !availableOnly || product.available > 0;
      const matchesStockFilter = stockFilter === "all"
        || (stockFilter === "low-stock" && product.availability === "stocked" && product.available > 0 && product.available <= product.reorderLevel)
        || (stockFilter === "out-of-stock" && product.availability === "stocked" && product.available <= 0);
      const matchesQuery = !normalized || [product.productName, product.sku, product.supplierSku, product.barcode, product.brand, product.model]
        .join(" ").toLowerCase().includes(normalized);
      return matchesCategory && matchesAvailability && matchesStockFilter && matchesQuery;
    });
  }, [availableOnly, category, products, query, stockFilter]);

  return (
    <section>
      {error && <div className="error-banner">{error} <button className="button button--secondary button--small" onClick={refetch} type="button">Retry</button></div>}
      {stockFilter !== "all" && (
        <div className="active-filter-banner">
          <span>Showing only items {stockFilter === "low-stock" ? "at or below their reorder level" : "out of stock"}.</span>
          <button className="button button--secondary button--small" onClick={() => setStockFilter("all")} type="button">Clear filter</button>
        </div>
      )}
      <div className="catalogue-tools">
        <label className="search-field search-field--large">
          <span>⌕</span>
          <input
            aria-label="Search products"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search product, our SKU, supplier SKU or barcode"
            value={query}
          />
          <Link href="/scan" aria-label="Scan a barcode">⌗</Link>
        </label>
        <button className={`filter-button ${availableOnly ? "is-active" : ""}`} onClick={() => setAvailableOnly((value) => !value)} type="button">
          <span>≡</span> Available only
        </button>
        <Link className="button button--secondary button--small" href="/inventory/labels">🏷 Print barcode labels</Link>
      </div>

      <div className="chip-row" aria-label="Product categories">
        {categories.map((item) => (
          <button className={category === item ? "is-active" : ""} key={item} onClick={() => setCategory(item)} type="button">{item}</button>
        ))}
      </div>

      <div className="catalogue-heading">
        <div><h2>Products</h2><p>{loading ? "Refreshing live inventory…" : `${filteredProducts.length} variants found`}</p></div>
        <select aria-label="Sort inventory"><option>Sort: Relevance</option><option>Stock: Low to high</option><option>Price: Low to high</option></select>
      </div>

      <div className="product-grid">
        {filteredProducts.map((product) => (
          <Link className="product-card" href={`/inventory/${product.productSlug}?variant=${product.id}`} key={product.id}>
            <ProductArtwork alt={product.photoAlt} kind={product.photo} />
            <div className="product-card__body">
              <span className="product-card__category">{product.category}</span>
              <h3>{product.productName}</h3>
              <p>{product.color ?? product.model} · {product.size ?? product.model}</p>
              <small>SKU: {product.sku}</small>
              <div className={`product-card__price ${product.srp == null ? "product-card__price--pending" : ""}`}>{formatPeso(product.srp)} {product.srp != null && <small>/ {product.sellingUnit.replaceAll("_", " ")}</small>}</div>
              <StockBadge compact product={product} />
            </div>
          </Link>
        ))}
      </div>

      {!filteredProducts.length && (
        <div className="empty-state"><span>⌕</span><h3>No matching products</h3><p>Try another own SKU, supplier SKU, barcode, brand or category.</p></div>
      )}
    </section>
  );
}
