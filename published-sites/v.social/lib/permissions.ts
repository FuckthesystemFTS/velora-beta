import { Role } from "@prisma/client";

export const roleOrder: Role[] = [
  Role.USER,
  Role.VERIFIED_USER,
  Role.MODERATOR,
  Role.ADMIN,
  Role.SUPERADMIN,
];

export function hasRole(currentRole: Role, minimumRole: Role) {
  return roleOrder.indexOf(currentRole) >= roleOrder.indexOf(minimumRole);
}

export function isTeamRole(role: Role) {
  return hasRole(role, Role.MODERATOR);
}

export function isVerifiedRole(role: Role) {
  return role === Role.VERIFIED_USER || hasRole(role, Role.MODERATOR);
}
