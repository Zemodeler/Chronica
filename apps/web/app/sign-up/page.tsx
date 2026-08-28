import type { Metadata } from "next";
import { registerCredentials } from "../actions";
import { StatusMessage } from "../components/status-message";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage({ searchParams }: Readonly<{ searchParams: Promise<{ status?: string; username?: string }> }>) {
  const { status, username } = await searchParams;
  const statusMessage = status === "unavailable"
    ? "Account creation is temporarily unavailable. Please try again shortly."
    : status === "username_taken"
      ? "That username is already in use."
    : status === "invalid_username"
      ? "Use a 3–30 character username with letters, numbers, or underscores."
    : status === "invalid_password"
      ? "Use a password of at least 8 characters."
    : status === "password_mismatch"
      ? "Passwords must match."
      : null;
  return <main id="main-content" className="shell narrow"><header className="page-header"><p className="eyebrow">Chronica</p><h1>Create account</h1><p className="lede">An email address is optional. Add a verified recovery address later; without one, a forgotten password can permanently lock you out of your account and saves.</p></header>{statusMessage && <StatusMessage kind="error" id="status">{statusMessage}</StatusMessage>}<section className="panel"><form action={registerCredentials}><label htmlFor="username">Username</label><input id="username" name="username" defaultValue={username ?? ""} pattern="[A-Za-z0-9_]{3,30}" title="Use 3–30 letters, numbers, or underscores." autoComplete="username" required /><p className="field-help">3–30 letters, numbers, or underscores. Uppercase letters are saved in lowercase.</p><label htmlFor="password">Password</label><input id="password" name="password" type="password" minLength={8} autoComplete="new-password" required /><label htmlFor="passwordConfirmation">Confirm password</label><input id="passwordConfirmation" name="passwordConfirmation" type="password" minLength={8} autoComplete="new-password" required /><button type="submit">Create account</button></form><p>Already have an account? <a href="/login">Log in</a>.</p></section></main>;
}
