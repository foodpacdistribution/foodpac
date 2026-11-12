import type { Role } from "../db/schema";

/** The roles a login may use: the one it starts in, then the extra jobs (never "customer"). */
export const rolesOf = (u: { role: Role; extraRoles: Role[] }): Role[] => [
  u.role,
  ...u.extraRoles.filter((r, i, all) => r !== u.role && r !== "customer" && all.indexOf(r) === i),
];
