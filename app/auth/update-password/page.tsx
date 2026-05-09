import { UpdatePasswordForm } from "@/components/auth/UpdatePasswordForm";
import { Logo } from "@/components/layout/Logo";

/**
 * Landing page for the "Set new password" step of the recovery flow.
 *
 * Flow:
 *   1. User clicks "Забыли пароль?" on /login → app calls
 *      supabase.auth.resetPasswordForEmail with redirectTo pointing
 *      at /auth/callback?next=/auth/update-password.
 *   2. Supabase sends an email; the link in it goes to
 *      /auth/callback?code=... which exchanges the code for a
 *      one-time recovery session, then redirects here.
 *   3. The user sets a new password.  After update we sign them in
 *      properly and bounce them home.
 */
export default function UpdatePasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12 relative">
      <div className="absolute inset-0 grid-bg opacity-25 pointer-events-none" />

      <div className="w-full max-w-md relative">
        <div className="text-center mb-10">
          <div className="inline-block mb-7"><Logo size="lg" showText={false} /></div>
          <h1 className="font-display italic font-medium text-[36px] text-ivory leading-none tracking-tightest">
            Новый <span className="not-italic font-normal text-emerald-200">пароль</span>
          </h1>
          <div className="font-mono text-[10px] tracking-widest uppercase text-ivory-mute mt-2">
            Set a new password
          </div>
        </div>

        <div className="keynote rounded-2xl p-8">
          <UpdatePasswordForm />
        </div>
      </div>
    </div>
  );
}
