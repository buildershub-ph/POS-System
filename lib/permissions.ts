import type { UserRole } from "./types";

export const roleLabels: Record<UserRole, string> = {
  owner: "Owner",
  manager: "Manager",
  sales_employee: "Sales Employee",
  stock_employee: "Stock Employee",
  cashier: "Cashier",
};

export type Permission =
  | "viewCatalogue"
  | "receiveStock"
  | "transferStock"
  | "countStock"
  | "processSale"
  | "approvePriceOverride"
  | "manageProducts"
  | "manageUsers"
  | "viewAuditLog"
  | "viewPrivateCosts"
  | "backdateSale";

const permissions: Record<Permission, UserRole[]> = {
  viewCatalogue: ["owner", "manager", "sales_employee", "stock_employee", "cashier"],
  receiveStock: ["owner", "manager"],
  transferStock: ["owner", "manager"],
  countStock: ["owner", "manager"],
  processSale: ["owner", "manager", "sales_employee", "cashier"],
  approvePriceOverride: ["owner", "manager"],
  manageProducts: ["owner", "manager"],
  manageUsers: ["owner"],
  viewAuditLog: ["owner"],
  viewPrivateCosts: ["owner"],
  // Recording a sale under a date other than today is a bookkeeping
  // correction (a forgotten walk-in sale, entered the next day) -- open to
  // anyone who can process a sale in the first place.
  backdateSale: ["owner", "manager", "sales_employee", "cashier"],
};

export function can(role: UserRole, permission: Permission): boolean {
  return permissions[permission].includes(role);
}

export const permissionMatrix = (Object.keys(permissions) as Permission[]).map(
  (permission) => ({ permission, roles: permissions[permission] }),
);
