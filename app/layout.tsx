import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { ORLANDO_TIME_PATCH } from "@/lib/orlando-time";

// Orlando time is the default for every date/time shown (server render too).
// eslint-disable-next-line no-new-func
new Function(ORLANDO_TIME_PATCH)();

// Inter is stored in the repo (latin, variable 400–700) so the build never
// has to reach Google Fonts — a bad Google reply failed the 2026-11-07 deploy.
const inter = localFont({
  src: "./fonts/inter-latin-var.woff2",
  weight: "400 700",
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Carbon Rewards",
  description: "Carbon Jeans Company — rewards service",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        {/* Must run before any app code: show all times in Orlando time. */}
        <script dangerouslySetInnerHTML={{ __html: ORLANDO_TIME_PATCH }} />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=swap"
        />
      </head>
      <body className={inter.className}>{children}</body>
    </html>
  );
}
