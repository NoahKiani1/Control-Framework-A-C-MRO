import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import { Navigation } from "./navigation";
import { AcmpPendingGate } from "./components/acmp-pending-gate";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "AcMP Control Board",
  description: "Aircraft and Component MRO Control Board",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <div style={{ display: "flex", minHeight: "100vh" }}>
          <Navigation />
          <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
        </div>
        <AcmpPendingGate />
      </body>
    </html>
  );
}
