import type { Metadata } from "next";
import { requestPasswordReset } from "../../actions";
import { StatusMessage } from "../../components/status-message";

export const metadata: Metadata = { title: "Reset password" };

export default async function ForgotPasswordPage({ searchParams }: Readonly<{ searchParams: Promise<{ status?: string }> }>) {
  const { status } = await searchParams;
  return <main id="main-content" className="shell narrow"><header className="page-header"><p className="eyebrow">Chronica</p><h1>Reset password</h1><p className="lede">Password reset is available only through a verified recovery email. Without one, a forgotten password can permanently lock you out.</p></header>{status === "sent" && <StatusMessage id="status">If that verified address belongs to an account, a reset link is on its way.</StatusMessage>}<section className="panel"><form action={requestPasswordReset}><label htmlFor="email">Verified recovery email</label><input id="email" name="email" type="email" autoComplete="email" required /><button type="submit">Send reset link</button></form><p><a href="/login">Return to login</a></p></section></main>;
}
