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
  metadataBase: new URL("https://finora-money-story.stitchboatimmigratio.chatgpt.site"),
  title: "Finora — Statements get messy. Your money story stays clear.",
  description:
    "Turn any bank, card, or UPI statement into an explainable financial memory for Google Sheets and MCP-compatible AI agents.",
  openGraph: {
    title: "Finora — Your money story stays clear",
    description: "Statement in. Money story out. Private, explainable, and agent-ready.",
    type: "website",
    images: [{ url: "/og-v2.png", width: 1728, height: 909, alt: "Finora turns statements into a clear money story" }],
  },
  twitter: { card: "summary_large_image", images: ["/og-v2.png"] },
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
