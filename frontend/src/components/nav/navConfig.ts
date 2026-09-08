import {
  LayoutDashboard,
  Sprout,
  Wheat,
  Package,
  ShieldCheck,
  LineChart,
  Scale,
  Warehouse,
  Handshake,
  ReceiptText,
  UserCircle,
  Users,
  ClipboardList,
  BarChart3,
  Building2,
  ShieldAlert,
  Landmark,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { UserRole } from "@/types/api";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  match?: string;
}

export const NAV_BY_ROLE: Record<UserRole, NavItem[]> = {
  FARMER: [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/farms", label: "My Farms", icon: Sprout },
    { href: "/crops", label: "My Crops", icon: Wheat },
    { href: "/lots", label: "My Lots", icon: Package },
    { href: "/quality", label: "Quality", icon: ShieldCheck },
    { href: "/market", label: "Market Prices", icon: LineChart },
    { href: "/forecasts", label: "Price Forecast", icon: BarChart3 },
    { href: "/sell-vs-store", label: "Sell vs Store", icon: Scale },
    { href: "/warehouses", label: "Warehouses", icon: Warehouse },
    { href: "/trade-offers", label: "Trade Offers", icon: Handshake },
    { href: "/net-realization", label: "Net Realization", icon: ReceiptText },
    { href: "/fpo-membership", label: "My FPO", icon: Building2 },
    { href: "/profile", label: "Profile", icon: UserCircle },
  ],
  BUYER: [
    { href: "/buyer", label: "Dashboard", icon: LayoutDashboard },
    { href: "/buyer/demands", label: "My Demands", icon: ClipboardList },
    { href: "/trade-offers", label: "Trade Offers", icon: Handshake },
    { href: "/buyer/profile", label: "Company Profile", icon: UserCircle },
  ],
  FPO_ADMIN: [
    { href: "/fpo", label: "Dashboard", icon: LayoutDashboard },
    { href: "/fpo/members", label: "Members", icon: Users },
    { href: "/fpo/lots", label: "Pooled Lots", icon: Package },
    { href: "/fpo/aggregation", label: "Aggregation", icon: BarChart3 },
  ],
  ADMIN: [
    { href: "/admin", label: "Overview", icon: LayoutDashboard },
    { href: "/admin/fpos", label: "FPOs", icon: Building2 },
    { href: "/admin/buyers", label: "Buyers", icon: ShieldAlert },
    { href: "/admin/warehouses", label: "Warehouses", icon: Warehouse },
    { href: "/admin/users", label: "Users", icon: Users },
    { href: "/admin/transporters", label: "Transport Network", icon: Truck },
  ],
  GOVERNMENT_VIEWER: [
    { href: "/government", label: "FPO Insights", icon: Landmark },
  ],
  TRANSPORTER: [{ href: "/transporter", label: "Transport Network", icon: Truck }, { href: "/trade-offers", label: "Offers", icon: Handshake }],
  WAREHOUSE_OPERATOR: [{ href: "/warehouse", label: "Storage Operations", icon: Warehouse }],
};

export const ROLE_LABEL: Record<UserRole, string> = {
  FARMER: "Farmer",
  BUYER: "Buyer",
  FPO_ADMIN: "FPO Admin",
  ADMIN: "Platform Admin",
  GOVERNMENT_VIEWER: "Government Viewer",
  TRANSPORTER: "Transporter",
  WAREHOUSE_OPERATOR: "Warehouse Operator",
};

export { ReceiptText, Scale };
