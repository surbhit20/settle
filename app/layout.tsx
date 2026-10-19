import type { Metadata } from "next";
import { EB_Garamond, Figtree } from "next/font/google";
import "./globals.css";

// next/font downloads the fonts at build time and serves them from our own domain.
// `variable` exposes each one as a CSS variable, which globals.css maps to font-sans / font-serif.
const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
});

const garamond = EB_Garamond({
  variable: "--font-garamond",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Settle: find your ideal home",
  description: "Ranked Bay Area neighborhoods for your salary, office, and priorities.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${figtree.variable} ${garamond.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
