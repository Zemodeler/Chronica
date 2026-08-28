import type { Metadata } from "next";
import { acceptGuestInvitation } from "../../actions";
import { StatusMessage } from "../../components/status-message";

export const metadata: Metadata = { title: "Join a match" };

export default async function JoinPage({ params, searchParams }: Readonly<{ params: Promise<{ token: string }>; searchParams: Promise<{ status?: string }> }>) {
  const { token } = await params;
  const { status } = await searchParams;
  return <main id="main-content" className="shell narrow"><header className="page-header"><p className="eyebrow">Match-scoped invitation</p><h1>Join The Sicilian Crisis</h1><p className="lede">Guests need no account, wallet or API key. This invitation grants access only to one seat in this match.</p></header><section className="panel"><h2>Accept invitation</h2>{status === "unavailable" && <StatusMessage kind="error" id="status">This invitation cannot be used.</StatusMessage>}<p>Acceptance consumes this invitation once and creates a match-scoped guest session. Only its hash is stored.</p><form action={acceptGuestInvitation}><input type="hidden" name="token" value={token} /><button type="submit">Accept and choose a character</button></form></section></main>;
}
