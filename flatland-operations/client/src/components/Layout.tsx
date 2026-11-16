import {
  BarChart3,
  Boxes,
  Briefcase,
  CalendarDays,
  ClipboardCheck,
  Clock,
  FileText,
  Home,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Timer,
  UserCircle,
  Users,
  Contact,
  Wrench,
  MoreHorizontal,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../auth";
import { initials, titleCase } from "../format";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  show: (can: (p: string) => boolean) => boolean;
  group: "Operations" | "People" | "Assets" | "Admin";
}

export const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, show: () => true, group: "Operations" },
  { to: "/clock", label: "Time Clock", icon: Clock, show: (c) => c("time.clock"), group: "Operations" },
  { to: "/jobs", label: "Jobs", icon: Briefcase, show: () => true, group: "Operations" },
  { to: "/customers", label: "Customers", icon: Contact, show: (c) => c("customers.view"), group: "Operations" },
  { to: "/team", label: "Team", icon: Users, show: (c) => c("users.view"), group: "People" },
  { to: "/timesheets", label: "Timesheets", icon: Timer, show: (c) => c("time.view_all"), group: "People" },
  { to: "/time-off", label: "Time Off", icon: CalendarDays, show: (c) => c("timeoff.request") || c("timeoff.review"), group: "People" },
  { to: "/inventory", label: "Inventory", icon: Boxes, show: (c) => c("inventory.view"), group: "Assets" },
  { to: "/maintenance", label: "Shop & Maintenance", icon: Wrench, show: (c) => c("maintenance.report"), group: "Assets" },
  { to: "/inspections", label: "Inspections", icon: ClipboardCheck, show: (c) => c("inspections.perform"), group: "Assets" },
  { to: "/documents", label: "Documents", icon: FileText, show: () => true, group: "Assets" },
  { to: "/reports", label: "Reports", icon: BarChart3, show: (c) => c("reports.operational"), group: "Admin" },
  { to: "/settings", label: "Settings", icon: Settings, show: (c) => c("settings.manage") || c("audit.view"), group: "Admin" },
];

export function Layout({ children }: { children: ReactNode }) {
  const { me, can, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  if (!me) return null;
  const name = `${me.user.first_name} ${me.user.last_name}`;
  const items = NAV.filter((n) => n.show(can));
  const groups = ["Operations", "People", "Assets", "Admin"] as const;

  const bottom = [
    { to: "/", label: "Home", icon: Home },
    ...(can("time.clock") ? [{ to: "/clock", label: "Clock", icon: Clock }] : []),
    { to: "/jobs", label: "Jobs", icon: Briefcase },
    can("inspections.perform") ? { to: "/inspections", label: "Inspect", icon: ClipboardCheck } : { to: "/documents", label: "Docs", icon: FileText },
  ].slice(0, 4);

  return (
    <div className="shell">
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">FO</div>
          <div>
            <div className="brand-name">Flatland Operations</div>
            <div className="brand-sub">{me.company.name || "Company"}</div>
          </div>
        </div>
        {groups.map((g) => {
          const list = items.filter((i) => i.group === g);
          if (!list.length) return null;
          return (
            <nav className="nav-section" key={g} aria-label={g}>
              <div className="nav-label">{g}</div>
              {list.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.to === "/"} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                  <n.icon size={18} />
                  {n.label}
                </NavLink>
              ))}
            </nav>
          );
        })}
        <div className="sidebar-footer">
          <NavLink to={`/team/${me.user.id}`} className="user-chip" style={{ textDecoration: "none" }}>
            <div className="avatar">{initials(name)}</div>
            <div className="grow">
              <div style={{ fontWeight: 600, fontSize: 14 }}>{name}</div>
              <div style={{ fontSize: 12, color: "#9fb8a8" }}>{titleCase(me.user.role)}</div>
            </div>
            <UserCircle size={16} color="#9fb8a8" />
          </NavLink>
          <button className="nav-link" style={{ width: "100%", background: "none", border: 0, cursor: "pointer", marginTop: 8, fontFamily: "inherit" }} onClick={logout}>
            <LogOut size={18} /> Sign out
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn ghost icon" style={{ color: "#fff" }} onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu size={22} />
          </button>
          <div className="brand-mark" style={{ width: 28, height: 28, fontSize: 12 }}>FO</div>
          <div className="brand-name">Flatland Operations</div>
        </header>
        <main className="content">{children}</main>
        <nav className="bottom-nav" aria-label="Quick navigation">
          {bottom.map((b) => (
            <NavLink key={b.to} to={b.to} end={b.to === "/"} className={({ isActive }) => (isActive ? "active" : "")}>
              <b.icon size={22} />
              {b.label}
            </NavLink>
          ))}
          <button onClick={() => setOpen(true)}>
            <MoreHorizontal size={22} />
            More
          </button>
        </nav>
      </div>
    </div>
  );
}
