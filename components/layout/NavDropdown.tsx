"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { InboxBadge } from "./InboxBadge";
import type { IconName } from "@/lib/types";

/**
 * Header dropdown that pools the secondary navigation items
 * (Сегодня / Inbox / Review / Граф / Настройки) under a single
 * "Меню" trigger.  Reduces nav row clutter and lets the primary
 * top-level links — Категории, Поиск, Корзина — breathe.
 *
 * Trigger highlights gold when the user is on any of the bundled
 * routes; click toggles open; outside-click / Escape close.
 */
const ITEMS: Array<{ href: string; label: string; hint: string; icon: IconName }> = [
  { href: "/today",    label: "Сегодня",  hint: "Заметки и события дня",     icon: "star" },
  { href: "/inbox",    label: "Inbox",    hint: "Импорт из Telegram-бота",   icon: "inbox" },
  { href: "/review",   label: "Review",   hint: "SM-2 повторение знаний",    icon: "refresh" },
  { href: "/graph",    label: "Граф",     hint: "Связи между записями",      icon: "drag" },
  { href: "/settings", label: "Настройки", hint: "Аккаунт · Telegram · PAT", icon: "settings" },
];

export function NavDropdown() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Active = any bundled route is the current pathname.  The
  // trigger picks up the gold underline so the user can still tell
  // "I'm somewhere inside the menu's contents".
  const isActive = ITEMS.some(
    (it) => pathname === it.href || pathname.startsWith(`${it.href}/`),
  );

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Close on route change — without this the menu stays open after
  // the user clicks a link and navigates.
  useEffect(() => { setOpen(false); }, [pathname]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={
          "inline-flex items-center gap-1.5 text-[15px] transition-colors " +
          (isActive
            ? "text-gold border-b border-gold pb-[2px] font-medium"
            : "text-ivory-dim hover:text-gold")
        }
      >
        <span>Меню</span>
        <svg
          aria-hidden="true"
          width="11" height="11"
          viewBox="0 0 24 24"
          className={"transition-transform " + (open ? "rotate-180" : "")}
        >
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {/* Inbox pending count even when the menu is closed — the
            user shouldn't need to open the dropdown to see "you've
            got mail". */}
        <span className="ml-0.5"><InboxBadge /></span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 mt-3 w-72 z-50 bg-emerald-deep border border-gold/30 rounded-xl shadow-2xl backdrop-blur p-1.5"
        >
          {ITEMS.map((it) => {
            const active = pathname === it.href || pathname.startsWith(`${it.href}/`);
            return (
              <Link
                key={it.href}
                href={it.href}
                role="menuitem"
                className={
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg transition group " +
                  (active
                    ? "bg-gold/10 text-gold"
                    : "text-ivory hover:bg-white/[0.05] hover:text-gold")
                }
              >
                <div className={active ? "text-gold" : "text-emerald-200 group-hover:text-gold transition"}>
                  <Icon name={it.icon} size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-display text-[14px] font-medium leading-tight">
                    {it.label}
                  </div>
                  <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute mt-0.5">
                    {it.hint}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
