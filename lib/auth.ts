import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { getDb } from "../db";
import * as schema from "../db/schema";

export const auth = betterAuth({
  appName: "Finora",
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(getDb(), { provider: "sqlite", schema }),
  account: {
    encryptOAuthTokens: true,
    updateAccountOnSignIn: true,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "google-client-id-not-configured",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "google-client-secret-not-configured",
      accessType: "offline",
      prompt: "select_account consent",
    },
  },
});
