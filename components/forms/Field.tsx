interface FieldProps {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}

export function Field({ label, required, hint, children }: FieldProps) {
  return (
    <label className="block mb-4">
      <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mb-1.5">
        {label}
        {required && <span className="text-gold ml-1">*</span>}
      </div>
      {children}
      {hint && <div className="font-mono text-[10px] text-ivory-mute/70 mt-1">{hint}</div>}
    </label>
  );
}
