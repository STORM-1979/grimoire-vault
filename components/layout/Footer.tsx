export function Footer() {
  return (
    <footer className="border-t border-white/10 mt-20">
      <div className="max-w-[1480px] mx-auto px-10 py-10 flex justify-between items-end gap-6 flex-wrap">
        <div>
          <div className="font-display italic text-[36px] font-light text-ivory leading-none">
            grimoire vault
          </div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mt-3">
            Atelier — A.D. MMXXVI · Set in Fraunces &amp; DM Sans
          </div>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute text-right">
          <div className="flex items-center gap-2 justify-end mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>All systems nominal</span>
          </div>
          <div className="text-gold">— ad astra per kanban —</div>
        </div>
      </div>
    </footer>
  );
}
