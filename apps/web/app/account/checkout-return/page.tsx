import type { Metadata } from "next";
import { StatusMessage } from "../../components/status-message";

export const metadata: Metadata = { title: "Coin purchasing unavailable" };

export default function CheckoutReturnPage() {
  return <main id="main-content" className="shell narrow"><header className="page-header"><p className="eyebrow">Coin wallet</p><h1>Coin purchasing is not available</h1></header>
    <StatusMessage>No coins were granted. Wallets can currently be funded only with a developer gift code.</StatusMessage>
    <p><a href="/account">Return to your account</a>.</p>
  </main>;
}
