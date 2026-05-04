import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { IdlePreload } from "@/components/layout/IdlePreload";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { KeyboardHelp } from "@/components/layout/KeyboardHelp";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Middleware should already protect, but defence-in-depth.
  if (!user) redirect("/login");

  return (
    <>
      <Header user={user} />
      <main className="flex-1">{children}</main>
      <Footer />
      <IdlePreload />
      <CommandPalette />
      <KeyboardHelp />
    </>
  );
}
