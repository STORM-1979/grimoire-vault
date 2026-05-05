import { Suspense } from "react";
import { LoginForm } from "@/components/auth/LoginForm";
import { Logo } from "@/components/layout/Logo";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12 relative">
      <div className="absolute inset-0 grid-bg opacity-25 pointer-events-none" />

      <div className="w-full max-w-md relative">
        <div className="text-center mb-10">
          <div className="inline-block mb-7"><Logo size="lg" showText={false} /></div>
          <h1 className="font-display italic font-medium text-[36px] text-ivory leading-none tracking-tightest">
            Grimoire <span className="not-italic font-normal text-emerald-200">Vault</span>
          </h1>
          <div className="font-mono text-[10px] tracking-widest uppercase text-ivory-mute mt-2">
            Atelier · Personal Edition
          </div>
        </div>

        <div className="keynote rounded-2xl p-8">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
