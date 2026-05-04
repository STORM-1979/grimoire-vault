"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/icons/Icon";

export function SignOutButton() {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleSignOut = () => {
    startTransition(async () => {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.refresh();
      router.push("/login");
    });
  };

  return (
    <button
      onClick={handleSignOut}
      disabled={isPending}
      className="badge inline-flex items-center gap-1.5 hover:border-gold transition disabled:opacity-50"
      title="Выйти"
    >
      <Icon name="lock" size={11} />
      {isPending ? "…" : "SIGN OUT"}
    </button>
  );
}
