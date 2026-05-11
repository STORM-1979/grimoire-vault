"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface NavLinkProps {
  href: string;
  children: React.ReactNode;
  exact?: boolean;
}

export function NavLink({ href, children, exact = false }: NavLinkProps) {
  const pathname = usePathname();
  const isActive = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      className={cn(
        // 15px / regular weight reads as proper navigation; the old
        // 13px / font-light was barely-there ghost text on a busy
        // emerald background.  Active state gets a slight semibold
        // bump so the gold underline + heavier letterforms together
        // signal "you are here" without shouting.
        "relative text-[15px] transition-colors",
        isActive
          ? "text-gold border-b border-gold pb-[2px] font-medium"
          : "text-ivory-dim hover:text-gold font-normal"
      )}
    >
      {children}
    </Link>
  );
}
