"use client";

import dynamic from "next/dynamic";

// Client-side wrapper so the parent page stays a Server Component
// (Next 16 forbids `ssr: false` in RSC). The crypto + master-key bundle
// only loads when the user lands on /category/credentials.
export const CredentialsViewLazy = dynamic(
  () => import("./CredentialsView").then((m) => m.CredentialsView),
  {
    ssr: false,
    loading: () => (
      <section className="text-center py-32 text-ivory-mute font-mono text-[11px] uppercase tracking-widest">
        Загружаю vault…
      </section>
    ),
  },
);
