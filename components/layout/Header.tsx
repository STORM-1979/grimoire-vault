import Link from "next/link";
import { Logo } from "./Logo";
import { NavLink } from "./NavLink";
import { NavDropdown } from "./NavDropdown";
import { VaultPicker } from "./VaultPicker";
import { Icon } from "@/components/icons/Icon";
import { SignOutButton } from "@/components/auth/SignOutButton";
import type { User } from "@supabase/supabase-js";

interface HeaderProps {
  user: User | null;
}

/**
 * Header navigation.
 *
 * Left:  Logo → home.
 * Centre: Категории · Поиск · Меню (the dropdown that pools
 *   Сегодня / Inbox / Review / Граф / Настройки).
 * Right: VaultPicker, email, Sign-out, then Корзина as an icon-
 *   only chip — sits past the sign-out so the destructive /
 *   recoverable triad (sign out / trash) clusters at the very
 *   edge of the bar.
 *
 * Padding got bumped (nav gap-8, container px-12) so the items
 * have room to breathe instead of crowding the row.
 */
export function Header({ user }: HeaderProps) {
  return (
    <header className="border-b border-white/10 bg-emerald-deep/80 backdrop-blur-sm sticky top-0 z-30">
      <div className="max-w-[1480px] mx-auto px-12 py-4 flex items-center justify-between gap-10">
        <Logo />

        <nav className="flex items-center gap-16">
          <NavLink href="/categories">Категории</NavLink>
          <NavLink href="/search">Поиск</NavLink>
          <NavDropdown />
        </nav>

        <div className="flex items-center gap-4">
          <VaultPicker />
          {user?.email && (
            <span className="font-mono text-[12px] text-ivory-mute hidden md:inline">
              {user.email}
            </span>
          )}
          <SignOutButton />
          {/* Корзина: icon-only chip, natural width (just the icon
              + .badge padding).  Height matches SignOut because both
              share the .badge frame.  No min-width — width is
              icon-sized as requested. */}
          <Link
            href="/trash"
            className="badge inline-flex items-center hover:border-gold hover:text-gold transition"
            title="Корзина"
            aria-label="Корзина"
          >
            <Icon name="trash" size={18} />
          </Link>
        </div>
      </div>
    </header>
  );
}
