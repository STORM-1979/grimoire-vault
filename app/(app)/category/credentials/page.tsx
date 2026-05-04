import Link from "next/link";
import { getCategory } from "@/lib/categories";
import { Icon } from "@/components/icons/Icon";
// Crypto + master-key bundle loaded on demand from a client wrapper.
import { CredentialsViewLazy as CredentialsView } from "@/components/credentials/CredentialsViewLazy";

export default function CredentialsPage() {
  const cat = getCategory("credentials")!;

  return (
    <div className="fade-in">
      <section className="max-w-[1480px] mx-auto px-10 pt-12 pb-8 border-b border-white/10">
        <div className="flex items-center gap-3 mb-6 text-[12px] font-mono uppercase tracking-widest text-ivory-mute">
          <Link href="/" className="hover:text-gold">Index</Link>
          <span>/</span>
          <Link href="/categories" className="hover:text-gold">Categories</Link>
          <span>/</span>
          <span className="text-gold">№ {cat.no} · {cat.en}</span>
        </div>
        <div className="flex items-end gap-7">
          <div className="text-emerald-200 flex-shrink-0"><Icon name={cat.icon} size={68} /></div>
          <div>
            <div className="font-mono text-[11px] uppercase tracking-widest text-gold mb-2 flex items-center gap-2">
              <Icon name="shield" size={12} /> № {cat.no} · Secure category
            </div>
            <h1 className="font-display text-[88px] font-light leading-[0.92] tracking-tightest">{cat.en}</h1>
            <div className="font-mono text-[12px] uppercase tracking-widest text-ivory-mute mt-2">{cat.ru}</div>
          </div>
        </div>
      </section>

      <CredentialsView />
    </div>
  );
}
