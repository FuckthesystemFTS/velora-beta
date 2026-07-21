import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Manrope } from "next/font/google";

import { CookieBanner } from "@/components/layout/cookie-banner";
import { SWRegister } from "@/components/pwa/sw-register";
import { env } from "@/lib/env";
import "./globals.css";

const serif = Cormorant_Garamond({
  subsets: ["latin"],
  variable: "--font-serif",
  weight: ["500", "600", "700"],
});

const sans = Manrope({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  metadataBase: new URL(env.APP_URL),
  title: "V per Verita",
  description: "V per Verita: social network con feed, profili, messaggi, inviti, moderazione e contenuti media.",
  applicationName: "V per Verita",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    siteName: "V per Verita",
    url: env.APP_URL,
    title: "V per Verita",
    description: "Social network con feed, profili, messaggi, inviti e contenuti media.",
  },
  twitter: {
    card: "summary_large_image",
    title: "V per Verita",
    description: "Social network con feed, profili, messaggi, inviti e contenuti media.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#d53127",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className={`${serif.variable} ${sans.variable}`}>
      <body>
        {children}
        <SWRegister />
        <CookieBanner />
      </body>
    </html>
  );
}
