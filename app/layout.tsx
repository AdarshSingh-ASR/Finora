import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://finora-life.pages.dev"),
  title: "Finora — Your money, finally legible",
  description:
    "Turn any bank or UPI statement into a clean, explainable money story — then take it to Google Sheets or your AI agent.",
  openGraph: {
    title: "Finora — Your money, finally legible",
    description: "Statement in. Money story out. Powered by GPT-5.6.",
    type: "website",
    images: [{ url: "/og.png", width: 1728, height: 909, alt: "Finora turns a bank statement into a clear money story" }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
