import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Fraunces } from "next/font/google";
import "./globals.css";
import { AppProviders } from "./providers/AppProviders";

const fontSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const fontDisplay = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700", "900"],
  style: ["normal"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Anndata — Every Meal Begins With a Farmer",
  description:
    "Direct produce markets, real-time mandi prices, and AI-driven crop intelligence for farmers, buyers, and FPOs.",
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%2315150f'/%3E%3Cpath d='M16 19.5s-6.5-2.2-7.8-8.9c-.3-1.6-.2-3.2.2-4.6 3.3.7 5.8 2.6 7 5.6 1 2.4 1 5.2.6 7.9Z' fill='%23e3b23c' opacity='.6'/%3E%3Cpath d='M16 19.5s6.5-2.2 7.8-8.9c.3-1.6.2-3.2-.2-4.6-3.3.7-5.8 2.6-7 5.6-1 2.4-1 5.2-.6 7.9Z' fill='%23e3b23c' opacity='.6'/%3E%3Cpath d='M16 21.5s-3.4-3.3-3.4-9.1c0-2.5.7-4.7 1.8-6.4.6.8 1.6 2.4 1.6 6 0-3.6 1-5.2 1.6-6 1.1 1.7 1.8 3.9 1.8 6.4 0 5.8-3.4 9.1-3.4 9.1Z' fill='%23e3b23c'/%3E%3Cpath d='M16 20.5V27M12.5 27h7' stroke='%23e3b23c' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#15150f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fontSans.variable} ${fontDisplay.variable}`}>
      <body className="min-h-screen bg-background font-sans antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
