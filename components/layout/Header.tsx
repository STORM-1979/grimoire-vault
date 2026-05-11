import { Logo } from "./Logo";
import { NavLink } from "./NavLink";
import { CommandHint } from "./CommandHint";
import { InboxBadge } from "./InboxBadge";
import { VaultPicker } from "./VaultPicker";
import { SignOutButton } from "@/components/auth/SignOutButton";
import type { User } from "@supabase/supabase-js";

interface HeaderProps {
  user: User | null;
}

export function Header({ user }: HeaderProps) {
  return (
    <header className="border-b border-white/10 bg-emerald-deep/80 backdrop-blur-sm sticky top-0 z-30">
      <div className="max-w-[1480px] mx-auto px-10 py-4 flex items-center justify-between gap-8">
        <Logo />

        <nav className="flex items-center gap-6">
          <NavLink href="/" exact>Главная</NavLink>
          <NavLink href="/today">Сегодня</NavLink>
          <NavLink href="/categories">Категории</NavLink>
          <span className="inline-flex items-center">
            <NavLink href="/inbox">Inbox</NavLink>
            <InboxBadge />
          </span>
          <NavLink href="/search">Поиск</NavLink>
          <NavLink href="/kanban">Канбан</NavLink>
          <NavLink href="/review">Review</NavLink>
          <NavLink href="/graph">Граф</NavLink>
          <NavLink href="/settings">Настройки</NavLink>
          <NavLink href="/trash">Корзина</NavLink>
        </nav>

        <div className="flex items-center gap-4">
          <VaultPicker />
          <CommandHint />
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
