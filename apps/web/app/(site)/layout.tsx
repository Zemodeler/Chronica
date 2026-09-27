import type { ReactNode } from "react";
import { Suspense } from "react";
import Image from "next/image";
import { headers } from "next/headers";
import { resolveAccount } from "../../lib/account-service";
import { TopNavLink } from "../components/top-nav-link";

async function TopBarAvatar() {
  try {
    const account = await resolveAccount(await headers());
    if (account !== null) {
      return (
        <TopNavLink className="top-bar-avatar" href="/account" aria-label="Account">
          <Image src={`/avatars/${account.avatarKey}.svg`} width={34} height={34} alt="" />
        </TopNavLink>
      );
    }
  } catch {
    // fallthrough
  }
  return <TopNavLink className="top-bar-pill" href="/login">Log in</TopNavLink>;
}

/**
 * Everything outside a game: the dashboard, the scenarios, sign-in, the
 * account. The game itself is outside this group, so none of this renders
 * under its room.
 */
export default function SiteLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="top-bar">
        <div className="top-bar-inner">
          <TopNavLink className="top-bar-wordmark" href="/">Chronica</TopNavLink>
          <nav className="top-bar-nav" aria-label="Primary">
            <TopNavLink className="top-bar-pill" href="/">Your games</TopNavLink>
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
        <p>Chronica. Sign-in and billing work without JavaScript.</p>
      </footer>
    </>
  );
}
