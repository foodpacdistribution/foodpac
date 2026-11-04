// Account helpers shared by server pages and the client account menu.

export type AccountLink = { href: string; label: string };

export const ROLE_LABEL = { admin: "Admin", dispatcher: "Dispatcher", driver: "Driver", customer: "Customer" } as const;

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/** Links for each role's menu. */
export function accountLinks(role: keyof typeof ROLE_LABEL): AccountLink[] {
  if (role === "customer")
    return [
      { href: "/portal", label: "My account" },
      { href: "/portal/orders", label: "My orders" },
      { href: "/portal/list", label: "My list" },
      { href: "/portal/deliveries", label: "Track deliveries" },
      { href: "/portal/invoices", label: "Invoices & payments" },
      { href: "/portal/profile", label: "Profile & password" },
    ];
  if (role === "driver")
    return [
      { href: "/driver", label: "Today's route" },
      { href: "/quick-route", label: "Quick route" },
      { href: "/account", label: "Profile & password" },
    ];
  return [
    { href: "/admin", label: "Back office" },
    { href: "/admin/sales", label: "Sales orders" },
    { href: "/admin/planner", label: "Route planner" },
    { href: "/account", label: "Profile & password" },
  ];
}
