import type { Metadata } from "next";
import { beginGoogleSignIn, loginWithCredentials } from "../../actions";
import { StatusMessage } from "../../components/status-message";
import { googleSignInAvailable } from "../../../lib/authentication";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: Readonly<{ searchParams: Promise<{ status?: string }> }>) {
  const { status } = await searchParams;
  const googleAvailable = googleSignInAvailable();
  return <main id="main-content" className="shell narrow"><header className="page-header"><p className="eyebrow">Chronica</p><h1>Log in</h1><p className="lede">Use your username and password, or continue with Google.</p></header>{(status === "invalid" || status === "signed-out") && <StatusMessage kind={status === "invalid" ? "error" : "notice"} id="status">{status === "invalid" ? "Username or password is incorrect." : "You have signed out."}</StatusMessage>}<div className="auth-grid"><section className="panel"><h2>Username and password</h2><form action={loginWithCredentials}><label htmlFor="username">Username</label><input id="username" name="username" autoComplete="username" required /><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required /><p><a href="/forgot-password">Forgot password?</a></p><button type="submit">Log in</button></form><p>New to Chronica? <a href="/sign-up">Create an account</a>.</p></section><section className="panel"><h2>Continue with Google</h2>{googleAvailable ? <form action={beginGoogleSignIn}><button type="submit">Continue with Google</button></form> : <><button type="button" disabled aria-describedby="google-unavailable">Continue with Google</button><p id="google-unavailable">Google sign-in is being configured.</p></>}</section></div></main>;
}
