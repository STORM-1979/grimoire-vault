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
        "relative text-[13px] font-light transition-colors",
        isActive ? "text-gold border-b border-gold pb-[2px]" : "text-ivory-dim hover:text-gold"
      )}
    >
      {children}
    </Link>
  );
}
