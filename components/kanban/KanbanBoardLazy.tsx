"use client";

import dynamic from "next/dynamic";

// Tiny client-side wrapper so the parent page can stay a Server Component.
// `next/dynamic({ ssr: false })` is only allowed inside a client boundary
// in Next 16, so we add one here.
export const KanbanBoardLazy = dynamic(
  () => import("./KanbanBoard").then((m) => m.KanbanBoard),
  {
    ssr: false,
    loading: () => (
      <div className="text-center py-32 font-mono text-[11px] uppercase tracking-widest text-ivory-mute">
        Загружаю доску…
      </div>
    ),
  },
);
