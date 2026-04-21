"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Gauge,
  CalendarDays,
  ClipboardList,
  Wrench,
  Upload,
  Users,
  Archive,
  Monitor,
  Settings,
  Menu,
  X,
  type LucideIcon,
} from "lucide-react";

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
    ],
  },
  {
    label: "Screens",
    items: [{ href: "/shop", label: "Shop Wall Screen", icon: Monitor }],
  },
];

const CURRENT_USER = { name: "Noah Kiani", role: "Planner", initials: "NK" };

export function Navigation() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  if (pathname === "/shop") return null;

  const close = () => setOpen(false);

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
        className={[
          "fixed inset-y-0 left-0 z-50 flex w-[260px] shrink-0 flex-col",
          "bg-[#201c18] text-[#c9bfae]",
          "rounded-r-[28px]",
          "shadow-[10px_0_40px_-4px_rgba(0,0,0,0.45)]",
          "transition-transform duration-200",
          "md:sticky md:top-3 md:ml-3 md:my-3 md:h-[calc(100vh-24px)] md:min-h-0 md:rounded-[28px] md:self-start md:translate-x-0",
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
          className="flex flex-col items-center gap-3 px-5 pb-6 pt-7"
        >
          <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-2xl bg-white/5 ring-1 ring-white/10">
            <Image
              src="/company-logo.png"
              alt="Aircraft & Component"
              width={1094}
              height={1094}
              priority
              className="h-24 w-24 object-contain"
            />
          </div>
          <div className="flex flex-col items-center leading-tight">
            <span className="text-2xl font-semibold tracking-tight text-white">A&amp;C MRO</span>
            <span className="text-[13px] text-[#8a8374]">Control Board</span>
          </div>
        </Link>

        <div className="mx-3 h-px bg-white/5" />

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {navGroups.map((group, idx) => (
            <div key={group.label} className={idx > 0 ? "mt-6" : ""}>
              <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6e6759]">
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
                          "group flex items-center gap-3 rounded-md px-3 py-2 text-[13px] transition-colors",
                          active
                            ? "bg-white/[0.06] font-medium text-white"
                            : "text-[#c9bfae] hover:bg-white/[0.04] hover:text-white",
                        ].join(" ")}
                      >
                        <Icon
                          size={18}
                          strokeWidth={1.75}
                          className={
                            active
                              ? "text-white"
                              : "text-[#8a8374] group-hover:text-[#c9bfae]"
                          }
                        />
                        <span>{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="mt-auto border-t border-white/5 p-3">
          <div className="flex items-center gap-3 rounded-md px-2 py-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#dc2626]/15 text-[13px] font-semibold text-[#f87171] ring-1 ring-[#dc2626]/25">
              {CURRENT_USER.initials}
            </div>
            <div className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-[13px] font-medium text-white">
                {CURRENT_USER.name}
              </span>
              <span className="truncate text-[11px] text-[#8a8374]">
                {CURRENT_USER.role}
              </span>
            </div>
            <button
              type="button"
              aria-label="Settings"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#8a8374] hover:bg-white/5 hover:text-[#c9bfae]"
            >
              <Settings size={16} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
