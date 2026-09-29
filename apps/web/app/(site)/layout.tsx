import type { ReactNode } from "react";
import { Suspense } from "react";
import Image from "next/image";
import { headers } from "next/headers";
import { resolveAccount } from "../../lib/account-service";
import { TopNavLink } from "../components/top-nav-link";

/**
 * The bar's links follow who is looking. A stranger sees only the way in:
 * "Your games" and "Account" would lead a signed-out visitor to a login form.
 */
async function SiteNav() {
  let account: Awaited<ReturnType<typeof resolveAccount>> = null;
  try {
    account = await resolveAccount(await headers());
  } catch {
    // fallthrough: treated as signed out
  }
  if (account === null) {
    return (
      <div className="top-bar-right">
        <TopNavLink className="top-bar-pill" href="/login">Log in</TopNavLink>
      </div>
    );
  }
  return (
    <>
      <nav className="top-bar-nav" aria-label="Primary">
        <TopNavLink className="top-bar-pill" href="/">Your games</TopNavLink>
        <TopNavLink className="top-bar-pill" href="/worlds">Worlds</TopNavLink>
        <TopNavLink className="top-bar-pill" href="/account">Account</TopNavLink>
      </nav>
      <div className="top-bar-right">
        <TopNavLink className="top-bar-avatar" href="/account" aria-label="Account">
          <Image src={`/avatars/${account.avatarKey}.svg`} width={34} height={34} alt="" />
        </TopNavLink>
      </div>
    </>
  );
}

/**
 * Everything outside a game: the dashboard, the scenarios, sign-in, the
 * account. The game itself is outside this group, so none of this renders
 * under its room. `.site` carries the site's own palette (site.css), so
 * nothing here reaches the Office or the map.
 */
export default function SiteLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="site">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="top-bar">
        <div className="top-bar-inner">
          <TopNavLink className="top-bar-wordmark" href="/">Chronica</TopNavLink>
          <Suspense fallback={null}>
            <SiteNav />
          </Suspense>
        </div>
      </header>
      {children}
      <footer className="site-footer">
        <p>Chronica is in a closed playtest.</p>
        <p className="site-footer__credits">Map: elevation from AWS Open Data Terrain Tiles (SRTM, GMTED, ETOPO1 and others); Natural Earth; Ancient World Mapping Center; Pleiades.</p>
      </footer>
    </div>
  );
}
