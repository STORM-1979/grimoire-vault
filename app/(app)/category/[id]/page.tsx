import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCategory } from "@/lib/categories";
import { listEntries } from "@/lib/data/entries";
import { Icon } from "@/components/icons/Icon";
import { CategoryView } from "@/components/category/CategoryView";
import type { CategoryId } from "@/lib/types";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CategoryPage({ params }: PageProps) {
  const { id } = await params;
  const cat = getCategory(id as CategoryId);
  if (!cat) notFound();
  if (cat.id === "kanban") redirect("/kanban");
  // Credentials renders via the generic view for now — dedicated encrypted UI ships in Phase 3.

  // Initial server-rendered fetch — RLS scopes by user
  const { items } = await listEntries({ categoryId: cat.id, limit: 200, offset: 0 });

  return (
    <div className="fade-in">
      {/* Breadcrumb + hero */}
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
            <div className="font-mono text-[11px] uppercase tracking-widest text-gold mb-2">
              № {cat.no} · Category
            </div>
            <h1 className="font-display text-[88px] font-light leading-[0.92] tracking-tightest">{cat.en}</h1>
            <div className="font-mono text-[12px] uppercase tracking-widest text-ivory-mute mt-2">{cat.ru}</div>
          </div>
        </div>
      </section>

      <CategoryView category={cat} initialItems={items} />
    </div>
  );
}
