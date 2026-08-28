import "server-only";

import { createBetterAuthDatabaseAdapter, createDatabase } from "@chronica/db";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { username } from "better-auth/plugins";
import { Resend } from "resend";

const FIFTEEN_MINUTES_SECONDS = 15 * 60;
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

type ChronicaAuth = ReturnType<typeof buildAuth>;
let configuredAuth: ChronicaAuth | undefined;

export function isAuthenticationConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim() && process.env.BETTER_AUTH_SECRET?.trim());
}

export function googleSignInAvailable(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

export function getAuthentication(): ChronicaAuth {
  if (!isAuthenticationConfigured()) {
    throw new Error("Authentication requires DATABASE_URL and BETTER_AUTH_SECRET.");
  }
  configuredAuth ??= buildAuth();
  return configuredAuth;
}

function buildAuth() {
  const databaseUrl = requiredEnvironmentValue("DATABASE_URL");
  const secret = requiredEnvironmentValue("BETTER_AUTH_SECRET");
  const baseURL = process.env.BETTER_AUTH_URL?.trim()
    || process.env.CHRONICA_PUBLIC_URL?.trim()
    || "http://localhost:3000";
  const { db } = createDatabase(databaseUrl);

  return betterAuth({
    appName: "Chronica",
    baseURL,
    secret,
    database: createBetterAuthDatabaseAdapter(db),
    trustedOrigins: [baseURL],
    session: {
      expiresIn: THIRTY_DAYS_SECONDS,
      updateAge: 24 * 60 * 60,
    },
    advanced: {
      database: { generateId: "uuid" },
      useSecureCookies: process.env.NODE_ENV === "production",
    },
    user: {
      changeEmail: {
        enabled: true,
        // New credential accounts begin with an internal placeholder email.
        // Let them replace it, then send the normal verification message.
        updateEmailWithoutVerification: true,
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      resetPasswordTokenExpiresIn: FIFTEEN_MINUTES_SECONDS,
      sendResetPassword: async ({ user, url }) => sendAuthEmail(user.email, url, "Reset your Chronica password", "Use this link to set a new Chronica password"),
    },
    emailVerification: {
      expiresIn: FIFTEEN_MINUTES_SECONDS,
      sendVerificationEmail: async ({ user, url }) => sendAuthEmail(user.email, url, "Verify your Chronica email", "Use this link to verify the email address on your Chronica account"),
    },
    ...(googleProviderConfiguration()),
    plugins: [
      username({ displayUsername: false, usernameValidator: (value) => /^[a-z0-9_]{3,30}$/.test(value) }),
      nextCookies(),
    ],
  });
}

function googleProviderConfiguration() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { socialProviders: { google: { clientId, clientSecret, prompt: "select_account" as const } } } : {};
}

async function sendAuthEmail(email: string, url: string, subject: string, intro: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.CHRONICA_EMAIL_FROM?.trim();
  if (apiKey && from) {
    const result = await new Resend(apiKey).emails.send({
      from,
      to: email,
      subject,
      text: `${intro}:\n\n${url}\n\nIf you did not request it, you can ignore this email.`,
    });
    if (result.error !== null) {
      console.error("Chronica auth email delivery failed", { provider: "resend", code: result.error.name ?? "unknown" });
      throw new Error("Email delivery failed.");
    }
    return;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("Production account email requires RESEND_API_KEY and CHRONICA_EMAIL_FROM.");
  }
  // Development explicitly uses a console transport. Never enable this branch in production.
  console.info(`[Chronica development account email] ${email}: ${url}`);
}

function requiredEnvironmentValue(name: "DATABASE_URL" | "BETTER_AUTH_SECRET"): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
