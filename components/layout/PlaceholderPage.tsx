import { Icon } from "@/components/icons/Icon";
import type { IconName } from "@/lib/types";

interface PlaceholderPageProps {
  icon: IconName;
  badge: string;
  title: string;
  italic?: string;
  description: string;
  comingIn: string;
}

export function PlaceholderPage({
  icon, badge, title, italic, description, comingIn,
}: PlaceholderPageProps) {
  return (
    <div className="fade-in">
      <section className="max-w-[1080px] mx-auto px-10 pt-20 pb-16">
        <div className="text-emerald-200 mb-8"><Icon name={icon} size={56} /></div>
        <div className="badge mb-5">{badge}</div>
        <h1 className="font-display text-[80px] font-light leading-[0.92] tracking-tightest">
          {title}{" "}
          {italic && <span className="italic text-gold">{italic}</span>}
        </h1>
        <p className="text-[16px] text-ivory-dim mt-6 max-w-2xl leading-[1.6]">
          {description}
        </p>
        <div className="mt-10 keynote rounded-xl p-6 max-w-xl">
          <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-3">
            Roadmap
          </div>
          <p className="text-[14px] text-ivory-dim leading-snug">
            {comingIn}
          </p>
        </div>
      </section>
    </div>
  );
}
