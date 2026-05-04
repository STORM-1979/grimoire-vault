import { SearchView } from "@/components/search/SearchView";
import { Icon } from "@/components/icons/Icon";

export default function SearchPage() {
  return (
    <div className="fade-in">
      <section className="max-w-[1080px] mx-auto px-10 pt-16 pb-8">
        <div className="text-emerald-200 mb-6"><Icon name="search" size={48} /></div>
        <div className="badge mb-4">Global search</div>
        <h1 className="font-display text-[80px] font-light leading-[0.92] tracking-tightest">
          Find <span className="italic text-gold">anything</span>.
        </h1>
        <p className="text-[15px] text-ivory-dim mt-4 max-w-2xl">
          Полнотекстовый поиск по всем 13 категориям через PostgreSQL tsvector
          с русской морфологией и поддержкой фразовых запросов.
        </p>
      </section>
      <SearchView />
    </div>
  );
}
