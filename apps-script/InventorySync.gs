const INVENTORY_SYNC = {
  supabaseUrl: "__SUPABASE_URL__",
  supabaseAnonKey: "__SUPABASE_ANON_KEY__",
  syncSecret: "__SHEET_SYNC_SECRET__",
  spreadsheetId: "1kPvWg8KtIpdftPtW7MbYhx8xLA7uQlRfGrWrwGgf2Rc",
  ownerEmail: "abillarjhona@gmail.com",
};

const READ_ONLY_SHEETS = new Set([
  "InventoryPositions",
  "StockMovements",
  "StockCounts",
  "Users",
  "Lists",
]);

const EDITABLE_SHEETS = new Set([
  "Products",
  "Variants",
  "Locations",
  "PrivateCosts",
  "PurchaseInvoices",
  "PurchaseCharges",
]);

function setupInventorySync() {
  if (!INVENTORY_SYNC.supabaseUrl.startsWith("https://") || !INVENTORY_SYNC.supabaseAnonKey.startsWith("sb_publishable_") || !INVENTORY_SYNC.syncSecret.startsWith("bhsync_")) {
    throw new Error("Run the secured bootstrap version once before removing its temporary credentials.");
  }

  const spreadsheet = SpreadsheetApp.openById(INVENTORY_SYNC.spreadsheetId);
  PropertiesService.getScriptProperties().setProperties({
    SUPABASE_URL: INVENTORY_SYNC.supabaseUrl,
    SUPABASE_ANON_KEY: INVENTORY_SYNC.supabaseAnonKey,
    SHEET_SYNC_SECRET: INVENTORY_SYNC.syncSecret,
    INVENTORY_SPREADSHEET_ID: spreadsheet.getId(),
    INVENTORY_OWNER_EMAIL: INVENTORY_SYNC.ownerEmail,
  });

  ScriptApp.getProjectTriggers().forEach((trigger) => {
    if (["handleInventoryEdit", "syncAllFromSupabase"].includes(trigger.getHandlerFunction())) ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger("handleInventoryEdit").forSpreadsheet(spreadsheet).onEdit().create();
  ScriptApp.newTrigger("syncAllFromSupabase").timeBased().everyMinutes(5).create();

  READ_ONLY_SHEETS.forEach((name) => {
    const sheet = spreadsheet.getSheetByName(name);
    if (!sheet) return;
    const existing = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).find((item) => item.getDescription() === "Portal-controlled inventory data");
    const protection = existing || sheet.protect().setDescription("Portal-controlled inventory data");
    protection.setWarningOnly(true);
  });

  syncAllFromSupabase();
  spreadsheet.toast("Inventory synchronization is active.", "Builders Hub", 8);
}

function handleInventoryEdit(event) {
  const sheet = event.range.getSheet();
  const sheetName = sheet.getName();
  if (event.range.getRow() === 1) return;

  if (READ_ONLY_SHEETS.has(sheetName)) {
    SpreadsheetApp.getActive().toast("This tab is read-only. Use a portal transaction to change stock.", "Inventory protected", 8);
    syncAllFromSupabase();
    return;
  }
  if (!EDITABLE_SHEETS.has(sheetName)) return;

  const row = rowObject_(sheet, event.range.getRow());
  try {
    supabaseRpc_("apply_sheet_edit_secure", {
      p_sheet: sheetName,
      p_row: row,
      p_actor_email: property_("INVENTORY_OWNER_EMAIL"),
      p_sync_secret: property_("SHEET_SYNC_SECRET"),
    });
    event.range.setNote(`Synced to Supabase ${new Date().toLocaleString()}`);
  } catch (error) {
    event.range.setNote(`Sync failed: ${error.message}`);
    SpreadsheetApp.getActive().toast(error.message, "Sync failed", 10);
    throw error;
  }
}

function syncAllFromSupabase() {
  const spreadsheet = SpreadsheetApp.openById(property_("INVENTORY_SPREADSHEET_ID"));
  const snapshot = supabaseRpc_("sheet_sync_snapshot", { p_sync_secret: property_("SHEET_SYNC_SECRET") });
  const categories = snapshot.categories;
  const categoryById = objectMap_(categories, "id");
  const suppliers = snapshot.suppliers || [];
  const supplierById = objectMap_(suppliers, "id");
  const products = snapshot.products;
  const productById = objectMap_(products, "id");
  const variants = snapshot.variants;
  const variantById = objectMap_(variants, "id");
  const locations = snapshot.locations;
  const locationById = objectMap_(locations, "id");
  const profiles = snapshot.profiles;
  const profileById = objectMap_(profiles, "id");
  const transactions = snapshot.transactions;
  const transactionLines = snapshot.transactionLines;
  const balances = snapshot.balances;
  const privateCosts = snapshot.privateCosts;
  const invoices = snapshot.invoices;
  const invoiceById = objectMap_(invoices, "id");
  const charges = snapshot.charges;

  replaceRows_(spreadsheet, "Products", [
    "ProductID", "CategoryCode", "Brand", "Model", "ProductName", "Description", "PrimaryPhoto", "Active", "CreatedAt", "CreatedBy", "UpdatedAt", "UpdatedBy",
  ], products.map((product) => [
    product.sheet_product_id, categoryById[product.category_id]?.code || "", product.brand, product.model, product.name,
    product.description || "", product.main_photo_path || "", product.active, product.created_at,
    profileById[product.created_by]?.email || "", product.updated_at, profileById[product.created_by]?.email || "",
  ]));

  replaceRows_(spreadsheet, "Variants", [
    "SKU", "ProductID", "SupplierSKU", "Supplier", "Barcode", "VariantName", "Size", "Color", "Finish", "Unit", "PackQty", "SRP", "ReorderLevel", "Active",
  ], variants.map((variant) => [
    variant.sku, productById[variant.product_id]?.sheet_product_id || "", variant.supplier_sku || "",
    supplierById[variant.supplier_id]?.name || "", variant.barcode,
    variant.attributes?.["Variant name"] || productById[variant.product_id]?.name || "",
    variant.attributes?.Size || "", variant.attributes?.Color || "", variant.attributes?.Finish || "",
    unitForSheet_(variant.selling_unit), variant.pieces_per_box || "", Number(variant.srp) || "", Number(variant.reorder_level) || 0, variant.active,
  ]));

  replaceRows_(spreadsheet, "Locations", ["LocationID", "LocationName", "LocationType", "Address", "Active", "Notes"], locations.map((location) => [
    location.code, location.name, location.code === "SHOWROOM" ? "Showroom" : location.code === "DISPLAY" ? "Display" : "Warehouse",
    location.address || "", location.active, "Synced from Supabase",
  ]));

  replaceRows_(spreadsheet, "InventoryPositions", ["SKU", "LocationID", "AvailableQty", "LastSync"], balances.map((balance) => [
    variantById[balance.variant_id]?.sku || "", locationById[balance.location_id]?.code || "", Number(balance.available_quantity), new Date(),
  ]));

  const transactionById = objectMap_(transactions, "id");
  replaceRows_(spreadsheet, "StockMovements", [
    "MovementID", "Timestamp", "MovementType", "SKU", "Quantity", "LocationID", "OtherLocationID", "StockEffect", "ReferenceNo", "Status", "Reason", "EnteredBy", "ApprovedBy", "Notes", "ReversalOf",
  ], transactionLines.map((line) => {
    const transaction = transactionById[line.transaction_id] || {};
    return [
      line.id, transaction.created_at, String(transaction.transaction_type || "").toUpperCase(), variantById[line.variant_id]?.sku || "",
      Math.abs(Number(line.quantity_delta)), locationById[line.location_id]?.code || "",
      transaction.source_location_id === line.location_id ? locationById[transaction.destination_location_id]?.code || "" : locationById[transaction.source_location_id]?.code || "",
      transaction.status === "posted" ? Number(line.quantity_delta) : 0, transaction.reference_number || transaction.delivery_reference || "",
      titleCase_(transaction.status), transaction.reason || "", profileById[transaction.created_by]?.email || "",
      profileById[transaction.posted_by]?.email || "", transaction.notes || "", transaction.reverses_transaction_id || "",
    ];
  }));

  replaceRows_(spreadsheet, "StockCounts", ["CountID", "Timestamp", "LocationID", "SKU", "SystemQty", "PhysicalQty", "Difference", "Reason", "Notes", "Photo", "CountedBy", "ApprovedBy"], []);
  replaceRows_(spreadsheet, "Users", ["Email", "FullName", "Role", "Active", "CreatedAt", "UpdatedAt"], profiles.map((profile) => [
    profile.email || "", profile.full_name, profile.role, profile.active, profile.created_at, profile.updated_at,
  ]));
  replaceRows_(spreadsheet, "Lists", ["ListType", "Code", "Label"], [
    ...categories.map((category) => ["Category", category.code, category.name]),
    ...suppliers.map((supplier) => ["Supplier", supplier.code, supplier.name]),
    ...locations.map((location) => ["Location", location.code, location.name]),
    ...["owner", "manager", "sales_employee", "stock_employee", "cashier"].map((role) => ["Role", role, titleCase_(role)]),
  ]);

  const currentPrivate = currentRowsByKey_(spreadsheet.getSheetByName("PrivateCosts"), "SKU");
  replaceRows_(spreadsheet, "PrivateCosts", [
    "CostRecordID", "SKU", "InvoiceNo", "Supplier", "Currency", "Quantity", "GrossUnitPrice", "DiscountPct", "NetUnitPurchaseCost", "PalletAllocationPerUnit", "FreightPerUnit", "DutiesPerUnit", "OtherPerUnit", "LandedCost", "EffectiveDate", "Ready",
  ], privateCosts.map((cost, index) => {
    const sku = variantById[cost.variant_id]?.sku || "";
    const existing = currentPrivate[sku] || {};
    return [
      existing.CostRecordID || `COST-${String(index + 1).padStart(3, "0")}`, sku, existing.InvoiceNo || "", existing.Supplier || "",
      existing.Currency || "PHP", existing.Quantity || "", existing.GrossUnitPrice || cost.unit_cost, existing.DiscountPct || 0,
      Number(cost.unit_cost), existing.PalletAllocationPerUnit || "", existing.FreightPerUnit || "", existing.DutiesPerUnit || "",
      existing.OtherPerUnit || "", Number(cost.landed_cost), cost.effective_at, "Yes",
    ];
  }));

  replaceRows_(spreadsheet, "PurchaseInvoices", [
    "InvoiceNo", "DeliveryReference", "SourceOrder", "InvoiceDate", "DeliveryDate", "DocumentType", "Merchandise", "Packaging", "CalculatedTotal", "InvoiceTotal", "Variance", "ReceiptStatus", "SourceImage", "ReviewNote",
  ], invoices.map((invoice) => [
    invoice.invoice_number, invoice.delivery_reference || "", invoice.source_order || "", invoice.invoice_date || "", invoice.delivery_date || "",
    invoice.document_type, Number(invoice.merchandise_amount), Number(invoice.packaging_amount), Number(invoice.merchandise_amount) + Number(invoice.packaging_amount),
    Number(invoice.invoice_total), Number(invoice.invoice_total) - Number(invoice.merchandise_amount) - Number(invoice.packaging_amount),
    titleCase_(invoice.receipt_status), invoice.source_file_name || "", invoice.review_note || "",
  ]));

  replaceRows_(spreadsheet, "PurchaseCharges", ["ChargeID", "InvoiceNo", "ChargeType", "SupplierItemCode", "Quantity", "UnitCost", "Amount", "AllocationStatus", "Notes"], charges.map((charge) => [
    charge.sheet_charge_id, invoiceById[charge.invoice_id]?.invoice_number || "", charge.charge_type, charge.supplier_item_code || "",
    Number(charge.quantity), Number(charge.unit_cost), Number(charge.amount), charge.allocation_status, charge.notes || "",
  ]));

  PropertiesService.getScriptProperties().setProperty("LAST_SUCCESSFUL_SYNC", new Date().toISOString());
}

function supabaseRpc_(name, payload) {
  const response = UrlFetchApp.fetch(`${property_("SUPABASE_URL")}/rest/v1/rpc/${name}`, {
    method: "post",
    contentType: "application/json",
    headers: { apikey: property_("SUPABASE_ANON_KEY") },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() >= 300) throw new Error(`Supabase update failed: ${response.getContentText()}`);
  return JSON.parse(response.getContentText() || "null");
}

function replaceRows_(spreadsheet, sheetName, headers, rows) {
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) return;
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows.map((row) => row.map(cellValue_)));
  sheet.setFrozenRows(1);
}

function rowObject_(sheet, rowNumber) {
  const width = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, width).getValues()[0];
  const values = sheet.getRange(rowNumber, 1, 1, width).getValues()[0];
  return Object.fromEntries(headers.map((header, index) => [String(header), cellValue_(values[index])]));
}

function currentRowsByKey_(sheet, keyHeader) {
  if (!sheet || sheet.getLastRow() < 2) return {};
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();
  const keyIndex = headers.indexOf(keyHeader);
  return Object.fromEntries(values.map((row) => [String(row[keyIndex]), Object.fromEntries(headers.map((header, index) => [header, row[index]]))]));
}

function objectMap_(rows, key) {
  return Object.fromEntries(rows.map((row) => [row[key], row]));
}

function property_(name) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error(`Missing script property: ${name}`);
  return value;
}

function cellValue_(value) {
  return value instanceof Date ? value.toISOString() : value === null || value === undefined ? "" : value;
}

function titleCase_(value) {
  return String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function unitForSheet_(unit) {
  return ({ piece: "pc", box: "box", set: "set", pair: "pair", square_metre: "sqm", linear_metre: "lm" })[unit] || "pc";
}
