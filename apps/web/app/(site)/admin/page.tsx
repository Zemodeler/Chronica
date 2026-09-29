import type { Metadata } from "next";
import { createAdminGift } from "../../actions";
import { StatusMessage } from "../../components/status-message";
import { gameRepository } from "../../../lib/game-repository";

export const metadata: Metadata = { title: "Administration" };

export default async function AdminPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ gift?: string; developer?: string }> }>) {
  const [params, viewer] = await Promise.all([searchParams, gameRepository.getViewer()]);
  if (viewer.role !== "admin") {
    return (
      <main id="main-content" className="shell">
        <h1>Not authorized</h1>
      </main>
    );
  }

  return (
    <main id="main-content" className="shell">
      <header className="page-header">
        <h1>Credits and fulfillment</h1>
        <p className="lede">Sensitive mutations require a recent verified sign-in.</p>
      </header>

      <section className="panel" aria-labelledby="gift-heading">
        <h2 id="gift-heading">Create a gift campaign</h2>
        {params.developer === "invalid" && (
          <StatusMessage kind="error" id="gift-status">Check the grant, limits, and audit note.</StatusMessage>
        )}
        {params.developer === "reauth" && (
          <StatusMessage kind="error" id="gift-status">Request a fresh sign-in link before creating gifts.</StatusMessage>
        )}
        <form action={createAdminGift}>
          <div className="form-grid">
            <div>
              <label htmlFor="grantCoins">Coins per redemption</label>
              <input id="grantCoins" name="grantCoins" inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,6})?" required placeholder="e.g. 10" />
            </div>
            <div>
              <label htmlFor="maxRedemptions">Maximum redemptions</label>
              <input id="maxRedemptions" name="maxRedemptions" type="number" min="1" max="100000" required defaultValue="1" />
            </div>
            <div>
              <label htmlFor="perAccountLimit">Per-account limit</label>
              <input id="perAccountLimit" name="perAccountLimit" type="number" min="1" max="100" required defaultValue="1" />
            </div>
          </div>
          <label htmlFor="codeExpiresAt">Code expiry (optional, UTC)</label>
          <input id="codeExpiresAt" name="codeExpiresAt" type="text" placeholder="2026-12-31T23:59:59Z" />
          <label htmlFor="grantedCoinsExpireAt">Granted coin expiry (optional, UTC)</label>
          <input id="grantedCoinsExpireAt" name="grantedCoinsExpireAt" type="text" placeholder="2026-12-31T23:59:59Z" />
          <label htmlFor="auditNote">Required audit note</label>
          <textarea id="auditNote" name="auditNote" rows={3} required maxLength={500} minLength={3} />
          <button type="submit">Create and reveal code</button>
        </form>
      </section>

      <section className="panel" aria-labelledby="operations-heading">
        <h2 id="operations-heading">Operational review</h2>
        <ul>
          <li>No failed billing events need review.</li>
          <li>Two catalog products are active.</li>
          <li>Wallet adjustments are disabled in the fixture adapter; the real helper requires a reason and append-only ledger entry.</li>
        </ul>
      </section>
    </main>
  );
}
