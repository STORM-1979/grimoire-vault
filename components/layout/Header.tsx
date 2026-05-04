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

        <nav className="flex items-center gap-9">
          <NavLink href="/" exact>Index</NavLink>
          <NavLink href="/categories">Categories</NavLink>
          <span className="inline-flex items-center">
            <NavLink href="/inbox">Inbox</NavLink>
            <InboxBadge />
          </span>
          <NavLink href="/search">Search</NavLink>
          <NavLink href="/kanban">Kanban</NavLink>
          <NavLink href="/settings">Settings</NavLink>
        </nav>

        <div className="flex items-center gap-4">
          <VaultPicker />
          <CommandHint />
          {user?.email && (
            <span className="font-mono text-[11px] text-ivory-mute hidden md:inline">
              {user.email}
            </span>
          )}
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
