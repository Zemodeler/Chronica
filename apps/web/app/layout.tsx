import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Alegreya, Alegreya_Sans, Alegreya_SC } from "next/font/google";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/primitives.css";
import "./styles/office.css";
import "./styles/documents.css";
import "./styles/map.css";
import "./styles/pages.css";

export const metadata: Metadata = {
  title: {
    default: "Chronica",
    template: "%s — Chronica",
  },
  description: "A deterministic historical map game where you play a person.",
};

// One family, three cuts: DESIGN.md says why. Each becomes a CSS variable
// that tokens.css builds its --font-* stacks on.
const serif = Alegreya({
  subsets: ["latin", "latin-ext"],
  style: ["normal", "italic"],
  variable: "--font-alegreya",
  display: "swap",
});
const sans = Alegreya_Sans({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "700"],
  style: ["normal", "italic"],
  variable: "--font-alegreya-sans",
  display: "swap",
});
const caps = Alegreya_SC({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500"],
  variable: "--font-alegreya-sc",
  display: "swap",
});

/**
 * The document, and nothing else. The site's bar and footer live in the
 * (site) group's layout; the game draws its own lintel over the room.
 */
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${caps.variable}`}>
      <body>{children}</body>
    </html>
  );
}
