import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { developerGiftList, loadAccountDashboard } from "../../lib/account-service";
import { isAuthenticationConfigured } from "../../lib/authentication";
import { gameRepository } from "../../lib/game-repository";
import { redeemGift } from "../actions";
import { AccountDashboard, type SerializedGift } from "./account-dialogs";
import { createDatabase, listInventedWorkflows } from "@chronica/db";
import { getLocalAiProviderConfiguration } from "@chronica/ai";

export const metadata: Metadata = { title: "Account and coins" };

export default async function AccountPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ gift?: string; checkout?: string; profile?: string; developer?: string; email?: string; aiProvider?: string; status?: string }> }>) {
  const [params, persistedAccount] = await Promise.all([searchParams, loadAccountDashboard(await headers())]);
  const account = persistedAccount ?? (!isAuthenticationConfigured() && process.env.NODE_ENV !== "production" ? await gameRepository.getAccount() : null);
  if (account === null) redirect("/login?returnTo=%2Faccount");

  const isDev = account.role === "developer" || account.role === "admin";
  const localAiProviderConfiguration = isDev ? getLocalAiProviderConfiguration() : undefined;
  const rawGifts = isDev ? await developerGiftList(await headers()) : [];
  const gifts: SerializedGift[] = rawGifts.map((g) => ({
    id: g.id,
    grantCoins: formatGiftAmount(g.grantMicroUnits),
    state: g.state,
    codeExpiresAt: g.codeExpiresAt?.toISOString() ?? null,
    createdAt: g.createdAt.toISOString(),
    redemptionCount: g.redemptionCount,
  }));

  let pendingProposalCount = 0;
  if (isDev && process.env.DATABASE_URL) {
    const { db, close } = createDatabase(process.env.DATABASE_URL);
    try {
      const workflows = await listInventedWorkflows(db, 50);
      pendingProposalCount = workflows.length;
    } catch { /* non-critical */ } finally {
      await close();
    }
  }

  return (
    <main id="main-content" className="shell">
      <AccountDashboard account={account} gifts={gifts} params={params} pendingProposalCount={pendingProposalCount} localAiProviderConfiguration={localAiProviderConfiguration} />
      <noscript>
        <section className="panel account-noscript" aria-labelledby="redeem-gift-without-javascript">
          <h2 id="redeem-gift-without-javascript">Redeem a gift</h2>
          <p>Enter a gift code to add coins to your wallet. Purchasing is not available yet.</p>
          <form action={redeemGift}>
            <label htmlFor="gift-code-without-javascript">Gift code</label>
            <input id="gift-code-without-javascript" name="code" autoComplete="off" required placeholder="CHR-..." />
            <button type="submit">Redeem gift</button>
          </form>
        </section>
      </noscript>
    </main>
  );
}

function formatGiftAmount(value: bigint): string {
  const whole = value / 1_000_000n;
  const fraction = value % 1_000_000n;
  return fraction === 0n ? whole.toString() : `${whole}.${fraction.toString().padStart(6, "0").replace(/0+$/, "")}`;
}
