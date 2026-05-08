"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Tiny pill rendered next to the "Inbox" nav link in Header when there
 * are bot-imported entries waiting for triage.
 *
 * Live behaviour:
 *   • Initial fetch on mount.
 *   • Subscribes to Supabase realtime on `entries` filtered to bot
 *     rows; INSERT bumps the count, UPDATE/DELETE refetches (cheaper
 *     than parsing the change payload to figure out whether
 *     triaged_at flipped).
 *   • Re-fetches on tab focus and on socket reconnect — earlier
 *     versions trusted realtime to deliver every event but we kept
 *     getting stuck stale counts after laptop-sleep / network blip /
 *     long idle tabs.  Both events are cheap (one HEAD count) and
 *     bring the badge back in sync without a page reload.
 *   • RLS scopes the count to the calling user.  Anonymous sessions
 *     return 0 and the pill stays hidden.
 *
 * Returns nothing visible when count is 0 — keeps the header tidy.
 */
export function InboxBadge() {
  const [count, setCount] = useState<number>(0);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    const refetch = async () => {
      const { count: c } = await supabase
        .from("entries")
        .select("id", { count: "exact", head: true })
        .eq("imported_via", "bot")
        .is("triaged_at", null);
      if (!cancelled) setCount(c ?? 0);
    };

    refetch();

    const ch = supabase
      .channel("inbox-badge")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "entries", filter: "imported_via=eq.bot" },
        () => { void refetch(); },
      )
      .subscribe((status) => {
        // Reconnect — we may have missed events while disconnected.
        if (status === "SUBSCRIBED") void refetch();
      });

    // Window focus / visibility — covers laptop-wake, tab-switch,
    // browser-restore.  A user who triaged the inbox in another tab
    // sees the badge come back to 0 the moment they refocus this one.
    const onFocus = () => { void refetch(); };
    const onVisibility = () => { if (!document.hidden) void refetch(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      supabase.removeChannel(ch);
    };
  }, []);

  if (count <= 0) return null;
  return (
    <span
      title={`${count} непрочитанн${count === 1 ? "ая запись" : count < 5 ? "ые записи" : "ых записей"} от бота`}
      className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-gold text-emerald-deep font-mono text-[10px] font-medium leading-none"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
