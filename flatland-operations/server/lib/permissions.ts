/**
 * Role-based permissions. This is the single source of truth: every API route checks
 * these on the server, and the UI receives the same list only to decide what to show.
 */
export type Role = "owner" | "manager" | "employee" | "subcontractor";
export const ROLES: Role[] = ["owner", "manager", "employee", "subcontractor"];

export const PERMISSIONS = [
  "dashboard.company",       // company-wide dashboard
  "users.view",              // see staff directory and profiles
  "users.manage",            // create/edit employees & subcontractors
  "users.manage_privileged", // create/edit owners & managers, change roles
  "financials.view",         // pay rates, labor cost, quoted amounts, estimated margins
  "settings.manage",
  "audit.view",
  "data.export",             // full data export / backups
  "customers.view",
  "customers.manage",
  "jobs.view_all",
  "jobs.manage",
  "time.clock",              // clock in/out for yourself
  "time.view_all",
  "time.edit",               // corrections, manual shifts, missed punches
  "timesheets.approve",
  "payroll.export",
  "timeoff.request",
  "timeoff.review",
  "availability.view_all",
  "inventory.view",
  "inventory.manage",
  "inventory.use",           // record usage of consumables on jobs
  "maintenance.report",      // report equipment problems
  "maintenance.manage",
  "documents.view_all",
  "documents.manage",
  "inspections.perform",
  "inspections.manage",
  "reports.operational",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const MANAGER: Permission[] = [
  "dashboard.company", "users.view", "users.manage",
  "customers.view", "customers.manage", "jobs.view_all", "jobs.manage",
  "time.clock", "time.view_all", "time.edit", "timesheets.approve", "payroll.export",
  "timeoff.request", "timeoff.review", "availability.view_all",
  "inventory.view", "inventory.manage", "inventory.use",
  "maintenance.report", "maintenance.manage",
  "documents.view_all", "documents.manage",
  "inspections.perform", "inspections.manage", "reports.operational",
];

const EMPLOYEE: Permission[] = [
  "time.clock", "timeoff.request", "inventory.view", "inventory.use",
  "maintenance.report", "inspections.perform",
];

const SUBCONTRACTOR: Permission[] = ["time.clock", "inspections.perform"];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(PERMISSIONS),
  manager: new Set(MANAGER),
  employee: new Set(EMPLOYEE),
  subcontractor: new Set(SUBCONTRACTOR),
};

export interface AuthUser {
  id: number;
  email: string;
  role: Role;
  first_name: string;
  last_name: string;
  can_record_time: number;
  must_change_password: number;
}

export function permissionsFor(user: Pick<AuthUser, "role" | "can_record_time">): Permission[] {
  const set = new Set(ROLE_PERMISSIONS[user.role]);
  // Subcontractors only record time when a manager has authorised it.
  if (user.role === "subcontractor" && !user.can_record_time) set.delete("time.clock");
  return [...set];
}

export function can(user: Pick<AuthUser, "role" | "can_record_time">, perm: Permission): boolean {
  if (perm === "time.clock" && user.role === "subcontractor") return Boolean(user.can_record_time);
  return ROLE_PERMISSIONS[user.role].has(perm);
}

export const isPrivilegedRole = (r: Role) => r === "owner" || r === "manager";
