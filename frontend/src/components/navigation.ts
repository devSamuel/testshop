import {
  IconBuildingStore,
  IconFileImport,
  IconHeartbeat,
  IconPackage,
  IconReceipt,
  type Icon,
} from "@tabler/icons-react";

export interface NavItem {
  to: string;
  label: string;
  icon: Icon;
  isActive: (pathname: string) => boolean;
}

export const SHOP_NAV: readonly NavItem[] = [
  {
    to: "/",
    label: "Shop",
    icon: IconBuildingStore,
    isActive: (pathname) => pathname === "/" || pathname.startsWith("/products/"),
  },
  {
    to: "/orders",
    label: "Orders",
    icon: IconReceipt,
    isActive: (pathname) => pathname.startsWith("/orders"),
  },
];

export const ADMIN_NAV: readonly NavItem[] = [
  {
    to: "/admin/products",
    label: "Products",
    icon: IconPackage,
    isActive: (pathname) => pathname.startsWith("/admin/products"),
  },
  {
    to: "/admin/import",
    label: "Import",
    icon: IconFileImport,
    isActive: (pathname) => pathname.startsWith("/admin/import"),
  },
  {
    to: "/admin/system",
    label: "System",
    icon: IconHeartbeat,
    isActive: (pathname) => pathname.startsWith("/admin/system"),
  },
];
