import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * SaaS user accounts, linked to the external authentication provider
 * (Supabase Auth with Google OAuth).
 *
 * IDENTITY BOUNDARY
 *   Credentials, OAuth access/refresh/id tokens and every other provider
 *   secret live ONLY inside the auth provider and are never written here.
 *   This table is a non-sensitive profile projection: the provider subject id,
 *   the public profile fields Google returns, and app-owned role/lifecycle
 *   state that the application needs in order to authorize requests.
 */
export const appUserRoleEnumValues = ["user", "admin"] as const;
export type AppUserRole = (typeof appUserRoleEnumValues)[number];

export const appUserStatusEnumValues = ["active", "suspended"] as const;
export type AppUserStatus = (typeof appUserStatusEnumValues)[number];

export const appUsers = pgTable(
  "app_users",
  {
    /** Internal surrogate key used by the app. */
    id: uuid("id").primaryKey().defaultRandom(),

    /** Immutable id issued by the auth provider (Supabase auth.users.id). */
    authUserId: uuid("auth_user_id").notNull(),

    /** Provider discriminator — 'google' today. */
    provider: varchar("provider", { length: 50 }).notNull().default("google"),

    /** The provider's own opaque subject id for this identity. */
    providerUserId: varchar("provider_user_id", { length: 255 }).notNull(),

    email: varchar("email", { length: 320 }).notNull(),
    fullName: varchar("full_name", { length: 255 }),
    avatarUrl: text("avatar_url"),

    role: varchar("role", { length: 20 })
      .$type<AppUserRole>()
      .notNull()
      .default("user"),
    status: varchar("status", { length: 20 })
      .$type<AppUserStatus>()
      .notNull()
      .default("active"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("idx_app_users_auth_user_id").on(table.authUserId),
    uniqueIndex("idx_app_users_provider_identity").on(
      table.provider,
      table.providerUserId
    ),
    index("idx_app_users_email_lower").on(sql`lower(${table.email})`),
    index("idx_app_users_created_at").on(table.createdAt),
    index("idx_app_users_last_login_at").on(table.lastLoginAt),
    index("idx_app_users_role").on(table.role),
    index("idx_app_users_status").on(table.status),
    check(
      "app_users_role_check",
      sql`${table.role} in ('user', 'admin')`
    ),
    check(
      "app_users_status_check",
      sql`${table.status} in ('active', 'suspended')`
    ),
  ]
);

export type AppUser = typeof appUsers.$inferSelect;
export type NewAppUser = typeof appUsers.$inferInsert;
