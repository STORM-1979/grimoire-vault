import { Logo } from "./Logo";
import { NavLink } from "./NavLink";
import { NavDropdown } from "./NavDropdown";
import { VaultPicker } from "./VaultPicker";
import { SignOutButton } from "@/components/auth/SignOutButton";
import type { User } from "@supabase/supabase-js";

interface HeaderProps {
  user: User | null;
}

/**
 * Header navigation.  Layout decisions:
 *   • Wordmark on the left is the home link — no separate
 *     "Главная" item in the nav row.
 *   • Secondary destinations (Сегодня / Inbox / Review / Граф /
 *     Настройки) are pooled into a "Меню" dropdown so the row
 *     stays focused on the three primary surfaces.
 *   • Primary top-level: Категории, Поиск, Корзина.
 *   • Kanban removed by request — still reachable via direct URL
 *     if anyone needs it.
 *   • CommandHint search-button removed — full search is one
 *     click away as a top-level link, and Cmd+K still works as
 *     a global shortcut (it just has no visible affordance now).
 */
export function Header({ user }: HeaderProps) {
  return (
    <header className="border-b border-white/10 bg-emerald-deep/80 backdrop-blur-sm sticky top-0 z-30">
      <div className="max-w-[1480px] mx-auto px-10 py-4 flex items-center justify-between gap-8">
        <Logo />

        <nav className="flex items-center gap-6">
          <NavDropdown />
          <NavLink href="/categories">Категории</NavLink>
          <NavLink href="/search">Поиск</NavLink>
          <NavLink href="/trash">Корзина</NavLink>
        </nav>

        <div className="flex items-center gap-4">
          <VaultPicker />
          {user?.email && (
            <span className="font-mono text-[12px] text-ivory-mute hidden md:inline">
              {user.email}
            </span>
          )}
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
