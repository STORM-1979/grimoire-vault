import Link from "next/link";
import { CATEGORIES } from "@/lib/categories";
import { Icon } from "@/components/icons/Icon";

export default function CategoriesPage() {
  return (
    <div className="fade-in">
      <section className="max-w-[1480px] mx-auto px-10 pt-14 pb-12">
        <div className="badge mb-4">Все категории</div>
        <h1 className="font-display text-[80px] font-light leading-[0.92] tracking-tightest">
          Тринадцать <span className="italic text-gold">комнат</span> одной библиотеки.
        </h1>
        <p className="text-[16px] text-ivory-dim mt-5 max-w-2xl">
          Каждая комната — отдельный раздел со своим списком и ритмом. Любая
          принимает вложенные подкатегории и теги.
        </p>
      </section>

      <section className="max-w-[1480px] mx-auto px-10 pb-12">
        <div className="grid grid-cols-4 gap-px bg-white/10 border border-white/10 rounded-2xl overflow-hidden">
          {CATEGORIES.map((c) => (
            <Link
              key={c.id}
              href={`/category/${c.id}`}
              className="group block p-7 relative bg-emerald-deep/60 hover:bg-white/[0.06] transition"
            >
              <div className="flex items-start justify-between mb-7">
                <span className="font-mono text-[11px] uppercase tracking-widest text-gold">№ {c.no}</span>
                <span className="font-mono text-[14px] text-gold opacity-60 group-hover:opacity-100 transition">→</span>
              </div>
              <div className="text-emerald-200 mb-6 group-hover:text-gold transition-colors">
                <Icon name={c.icon} size={34} />
              </div>
              <h3 className="font-display text-[26px] font-medium leading-none text-ivory">
                {c.en}
              </h3>
              <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mt-2">
                {c.ru}
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
