import type { Metadata } from "next";

export const metadata: Metadata = { title: "Coin purchasing unavailable" };

export default function PortalPage() {
  return <main id="main-content" className="shell narrow"><header className="page-header"><h1>Coin purchasing is not available</h1><p className="lede">Wallets can currently be funded only with a developer gift code.</p></header><p><a className="btn btn--primary" href="/account">Return to account</a></p></main>;
}
