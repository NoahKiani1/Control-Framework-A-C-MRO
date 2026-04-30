"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Gauge,
  CalendarDays,
  ClipboardList,
  Wrench,
  Upload,
  Users,
  Archive,
  Database,
  Monitor,
  BriefcaseBusiness,
  LogOut,
  Menu,
  X,
  type LucideIcon,
} from "lucide-react";
import { AppRole, getCurrentProfile, signOut } from "@/lib/auth";

type NavItem = { href: string; label: string; icon: LucideIcon };
type NavGroup = { label: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    label: "Planning",
    items: [
      { href: "/capacity", label: "Capacity Management", icon: Gauge },
      { href: "/planning", label: "Shared Planning", icon: CalendarDays },
    ],
  },
  {
    label: "Updates",
    items: [
      { href: "/office-update", label: "Office Update", icon: ClipboardList },
      { href: "/shop-update", label: "Shop Update", icon: Wrench },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/import", label: "AcMP Import", icon: Upload },
      { href: "/staff", label: "Staff Management", icon: Users },
      { href: "/backlog", label: "Inactive Work Orders", icon: Archive },
      { href: "/work-order-data", label: "Work Order Data", icon: Database },
    ],
  },
  {
    label: "Screens",
    items: [{ href: "/shop", label: "Shop Wall Screen", icon: Monitor }],
  },
];

export function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<AppRole | null>(null);

  const hideSidebar =
    pathname === "/shop" || pathname === "/shop-form" || pathname === "/login";

  useEffect(() => {
    let active = true;

    async function loadRole() {
      if (hideSidebar) {
        setRole(null);
        return;
      }

      const { profile } = await getCurrentProfile();

      if (active) {
        setRole(profile?.role ?? null);
      }
    }

    void loadRole();

    return () => {
      active = false;
    };
  }, [hideSidebar]);

  if (hideSidebar || role !== "office") return null;

  const close = () => setOpen(false);

  async function handleLogout() {
    await signOut();
    router.replace("/login");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        className="fixed left-3 top-3 z-40 inline-flex h-10 w-10 items-center justify-center rounded-md bg-[#201c18] text-[#c9bfae] shadow-sm md:hidden"
      >
        <Menu size={20} />
      </button>

      {open && (
        <div
          onClick={close}
          aria-hidden
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
        />
      )}

      <aside
        style={{ width: "var(--layout-sidebar-w)" }}
        className={[
          "fixed inset-y-0 left-0 z-50 flex shrink-0 flex-col",
          "bg-[#201c18] text-[#c9bfae]",
          "rounded-r-[24px]",
          "shadow-[10px_0_40px_-4px_rgba(0,0,0,0.45)]",
          "transition-transform duration-200",
          "md:sticky md:top-3 md:ml-3 md:my-3 md:h-[calc(100vh-24px)] md:min-h-0 md:rounded-[24px] md:self-start md:translate-x-0",
          "md:shadow-[0_14px_40px_-8px_rgba(0,0,0,0.35)]",
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        ].join(" ")}
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close navigation"
          className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-md text-[#c9bfae] hover:bg-white/5 md:hidden"
        >
          <X size={18} />
        </button>

        <Link
          href="/dashboard"
          onClick={close}
          aria-label="Dashboard home"
        className="flex flex-col items-center gap-2 px-4 pb-4 pt-4"
        >
          <div className="flex h-[76px] w-[76px] shrink-0 items-center justify-center">
            <Image
              src="/company-logo.png"
              alt="Aircraft & Component"
              width={1094}
              height={1094}
              priority
              className="h-[66px] w-[66px] object-contain"
            />
          </div>
          <div className="flex flex-col items-center leading-tight">
            <span className="text-[14px] font-semibold tracking-tight text-white">Aircraft &amp; Component</span>
            <span className="text-[10px] text-[#8a8374]">Control Board</span>
          </div>
        </Link>

        <div className="mx-3 h-px bg-white/5" />

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {navGroups.map((group, idx) => (
            <div key={group.label} className={idx > 0 ? "mt-4" : ""}>
              <div className="px-3 pb-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#6e6759]">
                {group.label}
              </div>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const active = pathname === item.href;
                  const Icon = item.icon;
                  return (
                    <li key={item.href} className="relative">
                      {active && (
                        <span
                          aria-hidden
                          className="absolute bottom-1.5 left-0 top-1.5 w-[3px] rounded-r bg-[#dc2626]"
                        />
                      )}
                      <Link
                        href={item.href}
                        onClick={close}
                        className={[
                          "group flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[11px] transition-colors",
                          active
                            ? "bg-white/[0.06] font-medium text-white"
                            : "text-[#c9bfae] hover:bg-white/[0.04] hover:text-white",
                        ].join(" ")}
                      >
                        <Icon
                          size={16}
                          strokeWidth={1.75}
                          className={
                            active
                              ? "text-white"
                              : "text-[#8a8374] group-hover:text-[#c9bfae]"
                          }
                        />
                        <span className="min-w-0 truncate">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="mt-auto border-t border-white/5 p-2">
          <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#dc2626]/15 text-[#f87171] ring-1 ring-[#dc2626]/25">
              <BriefcaseBusiness size={14} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-[11px] font-medium text-white">
                Office
              </span>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              aria-label="Log out"
              className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-[#8a8374] hover:bg-white/5 hover:text-[#c9bfae]"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
