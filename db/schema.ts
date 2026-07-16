import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
}, (table) => [uniqueIndex("session_token_idx").on(table.token)]);

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
}, (table) => [uniqueIndex("account_provider_idx").on(table.providerId, table.accountId)]);

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export const userLedger = sqliteTable("user_ledger", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  statementJson: text("statement_json").notNull(),
  budgetsJson: text("budgets_json").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const reportPreference = sqliteTable("report_preference", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  weeklyEmailEnabled: integer("weekly_email_enabled", { mode: "boolean" }).notNull().default(false),
  frequency: text("frequency").notNull().default("weekly"),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  reportDay: integer("report_day").notNull().default(0),
  lastSentAt: timestamp("last_sent_at"),
  updatedAt: timestamp("updated_at").notNull(),
});

export const googleSheetConnection = sqliteTable("google_sheet_connection", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  spreadsheetId: text("spreadsheet_id").notNull(),
  spreadsheetUrl: text("spreadsheet_url").notNull(),
  name: text("name").notNull(),
  folderId: text("folder_id"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  lastSyncedAt: timestamp("last_synced_at").notNull(),
});

export const chatThread = sqliteTable("chat_thread", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  messagesJson: text("messages_json").notNull(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
}, (table) => [index("chat_thread_user_updated_idx").on(table.userId, table.updatedAt)]);

export const agentAuthRequest = sqliteTable("agent_auth_request", {
  id: text("id").primaryKey(),
  deviceCodeHash: text("device_code_hash").notNull(),
  userCode: text("user_code").notNull(),
  status: text("status").notNull().default("pending"),
  userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull(),
  approvedAt: timestamp("approved_at"),
  exchangedAt: timestamp("exchanged_at"),
}, (table) => [
  uniqueIndex("agent_auth_request_device_idx").on(table.deviceCodeHash),
  uniqueIndex("agent_auth_request_user_code_idx").on(table.userCode),
]);

export const agentAccessToken = sqliteTable("agent_access_token", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  name: text("name").notNull().default("Finora skill"),
  createdAt: timestamp("created_at").notNull(),
  lastUsedAt: timestamp("last_used_at"),
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"),
}, (table) => [
  uniqueIndex("agent_access_token_hash_idx").on(table.tokenHash),
  index("agent_access_token_user_idx").on(table.userId, table.createdAt),
]);
