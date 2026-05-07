import Link from "next/link";
import { Icon } from "@/components/icons/Icon";
import { ReviewSession } from "@/components/review/ReviewSession";

/**
 * /review — spaced-repetition session.  All the logic lives in the
 * ReviewSession client component; this page is just the chrome.
 */
export default function ReviewPage() {
  return (
    <div className="fade-in">
      <section className="max-w-[900px] mx-auto px-10 pt-12 pb-6 border-b border-white/10">
        <div className="flex items-center gap-3 mb-6 text-[12px] font-mono uppercase tracking-widest text-ivory-mute">
          <Link href="/" className="hover:text-gold">Главная</Link>
          <span>/</span>
          <span className="text-gold">Review</span>
        </div>
        <div className="flex items-end gap-7">
          <div className="text-emerald-200 flex-shrink-0">
            <Icon name="star" size={56} />
          </div>
          <div>
            <div className="font-mono text-[11px] uppercase tracking-widest text-gold mb-2">
              Spaced repetition · SM-2
            </div>
            <h1 className="font-display text-[64px] font-light leading-[0.95] tracking-tightest mb-2">
              Review
            </h1>
            <p className="text-[14px] text-ivory-dim font-light max-w-xl">
              Карточки с навыками и заметками всплывают по графику Anki.
              Помнишь — интервал растёт, забыл — обнуляется.  Добавляй
              записи в очередь по кнопке «В review» на странице записи.
            </p>
          </div>
        </div>
      </section>
      <section className="max-w-[900px] mx-auto px-10 py-10">
        <ReviewSession />
      </section>
    </div>
  );
}
