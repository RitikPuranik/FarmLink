import { UserRole } from "@/types/api";

/**
 * Where each role lands after login. Only FARMER has a real destination in
 * Module 1 — every other role still routes somewhere real (so the frontend
 * routing infrastructure is fully wired for when those modules ship) but
 * the page itself just shows "this module is not yet enabled" instead of a
 * fake dashboard.
 */
export const ROLE_HOME_ROUTE: Record<UserRole, string> = {
  FARMER: "/dashboard",
  FPO_ADMIN: "/fpo",
  BUYER: "/buyer",
  TRANSPORTER: "/transporter",
  WAREHOUSE_OPERATOR: "/warehouse",
  ADMIN: "/admin",
  GOVERNMENT_VIEWER: "/government",
};

export const ROLES_WITH_LIVE_UI: UserRole[] = ["FARMER"];
