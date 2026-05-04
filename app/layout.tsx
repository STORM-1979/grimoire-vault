import type { Metadata, Viewport } from "next";
import { Fraunces, Manrope, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/layout/ServiceWorkerRegister";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"], // Fraunces lacks cyrillic glyphs — DM Sans handles RU body text
  display: "swap",
  weight: ["300", "400", "500", "600", "700"],
  style: ["normal", "italic"],
});

const manrope = Manrope({
  variable: "--font-sans-display",
  subsets: ["latin", "cyrillic"],
  display: "swap",
  weight: ["200", "300", "400", "500", "600", "700"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-mono-display",
  subsets: ["latin", "cyrillic"],
  display: "swap",
  weight: ["300", "400", "500"],
});

export const metadata: Metadata = {
  title: {
    default: "Grimoire Vault — A library of everything worth keeping",
    template: "%s · Grimoire Vault",
  },
  description:
    "Personal knowledge base — thirteen rooms, one password, multi-device sync, Telegram attaché.",
  applicationName: "Grimoire Vault",
  authors: [{ name: "Storm-1979" }],
  keywords: ["knowledge base", "personal", "kanban", "ai", "second brain"],
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#031912",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="ru"
      className={`${fraunces.variable} ${manrope.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <head>
        {/* Pre-warm DNS + TLS to every host the app talks to.
            Saves 100-300ms on the first request to each origin. */}
        <link
          rel="preconnect"
          href={process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://ahwpvygtbxvreoxwjdwn.supabase.co"}
        />
        <link rel="preconnect" href="https://images.unsplash.com" crossOrigin="" />
        <link rel="preconnect" href="https://i.ytimg.com" crossOrigin="" />
        <link rel="dns-prefetch" href="https://api.telegram.org" />
      </head>
      <body className="min-h-full flex flex-col">
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
