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
  | "viewPrivateCosts";

const permissions: Record<Permission, UserRole[]> = {
  viewCatalogue: ["owner", "manager", "sales_employee", "stock_employee", "cashier"],
  receiveStock: ["owner", "manager", "stock_employee"],
  transferStock: ["owner", "manager", "stock_employee"],
  countStock: ["owner", "manager", "stock_employee"],
  processSale: ["owner", "manager", "sales_employee", "cashier"],
  approvePriceOverride: ["owner", "manager"],
  manageProducts: ["owner", "manager"],
  manageUsers: ["owner"],
  viewAuditLog: ["owner"],
  viewPrivateCosts: ["owner"],
};

export function can(role: UserRole, permission: Permission): boolean {
  return permissions[permission].includes(role);
}

export const permissionMatrix = (Object.keys(permissions) as Permission[]).map(
  (permission) => ({ permission, roles: permissions[permission] }),
);
