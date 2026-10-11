import type { Metadata, Viewport } from "next";
import { Barlow_Condensed } from "next/font/google";
import { SessionProvider } from "../ui/session";
import "./globals.css";

const display = Barlow_Condensed({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-display", display: "swap" });

export const metadata: Metadata = {
  title: "Bibleague",
  description: "Run your weekly 5-a-side game: RSVPs, balanced teams, no WhatsApp chaos.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b8a4a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={display.variable}>
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
