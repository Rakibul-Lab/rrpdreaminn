import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RRP Dream Inn + CloudView ERP",
  description: "Hotel & Restaurant ERP System - RRP Dream Inn and CloudView Restaurant Management",
  keywords: ["ERP", "Hotel", "Restaurant", "Management", "Booking", "POS"],
  authors: [{ name: "RRP Dream Inn" }],
  icons: {
    icon: "/brand-logo.png",
  },
  openGraph: {
    title: "RRP Dream Inn + CloudView ERP",
    description: "Hotel & Restaurant ERP System for operations, billing, and POS.",
    url: "http://localhost:3000",
    siteName: "RRP Dream Inn + CloudView",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "RRP Dream Inn + CloudView ERP",
    description: "Hotel & Restaurant ERP System for operations, billing, and POS.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
