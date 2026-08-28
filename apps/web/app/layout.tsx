import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Suspense } from "react";
import Image from "next/image";
import { headers } from "next/headers";
import "./styles.css";
import { resolveAccount } from "../lib/account-service";
import { TopNavLink } from "./components/top-nav-link";

export const metadata: Metadata = {
  title: {
    default: "Chronica",
    template: "%s — Chronica",
  },
  description: "A deterministic historical map game where you play a person.",
};

async function TopBarAvatar() {
  try {
    const account = await resolveAccount(await headers());
    if (account !== null) {
      return (
        <TopNavLink className="top-bar-avatar top-bar-avatar--img" href="/account" aria-label="Account">
          <Image src={`/avatars/${account.avatarKey}.svg`} width={32} height={32} alt="" />
        </TopNavLink>
      );
    }
  } catch {
    // fallthrough
  }
  return <TopNavLink className="top-bar-pill" href="/login">Log in</TopNavLink>;
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <header className="top-bar">
          <div className="top-bar-inner">
            <TopNavLink className="top-bar-wordmark" href="/">Chronica</TopNavLink>
            <nav className="top-bar-nav" aria-label="Primary">
              <TopNavLink className="top-bar-pill" href="/">Dashboard</TopNavLink>
              <TopNavLink className="top-bar-pill" href="/worlds">Worlds</TopNavLink>
              <TopNavLink className="top-bar-pill" href="/account">Account</TopNavLink>
            </nav>
            <div className="top-bar-right">
              <Suspense fallback={<TopNavLink className="top-bar-pill" href="/login">Log in</TopNavLink>}>
                <TopBarAvatar />
              </Suspense>
            </div>
          </div>
        </header>
        {children}
        <footer className="site-footer">
          <p>Chronica — sign-in and billing work without JavaScript.</p>
        </footer>
      </body>
    </html>
  );
}
