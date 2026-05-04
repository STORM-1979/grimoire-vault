interface Props {
  strength: "weak" | "medium" | "strong" | null;
}

export function StrengthDot({ strength }: Props) {
  const s = strength ?? "weak";
  const colour = s === "strong" ? "#26a373" : s === "medium" ? "#d4b76a" : "#f87171";
  const bars = s === "strong" ? 3 : s === "medium" ? 2 : 1;
  const label = s.toUpperCase();
  return (
    <div className="flex items-center gap-2" title={`Сила пароля: ${label}`}>
      <div className="flex items-center gap-0.5">
        {[1, 2, 3].map((n) => (
          <div
            key={n}
            className="w-1 h-3 rounded-sm"
            style={{ background: n <= bars ? colour : "rgba(250,246,233,.12)" }}
          />
        ))}
      </div>
      <span className="font-mono text-[9px] uppercase tracking-widest" style={{ color: colour }}>
        {label}
      </span>
    </div>
  );
}
