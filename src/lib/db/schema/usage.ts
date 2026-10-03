import { pgTable, uuid, text, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { appUsers } from "./auth";

/**
 * Per-user search usage history.
 *
 * SCOPE
 *   One row per authenticated search, so a person can see their own activity on
 *   the account dashboard. Nothing in the application reads another user's rows,
 *   and this table is not reachable from the admin panel.
 *
 * WHAT IS DELIBERATELY ABSENT
 *   No credential of any kind (passwords, OAuth tokens, session cookies live
 *   only inside the auth provider), no `auth_user_id` / `provider_user_id`, no
 *   email or name, and no IP address or user agent — there is no documented
 *   security requirement for them on this endpoint, which is already behind
 *   authentication. The row holds only who-searched (our own surrogate key),
 *   what they searched for, and when.
 *
 * RETENTION — INTENTIONALLY PENDING
 *   There is deliberately no automatic deletion yet. A search query is free
 *   text and can contain personal data, so a retention policy (how long a raw
 *   query is kept, whether rows are deleted or anonymised, what happens on
 *   account deletion) must be decided before real user data lands here.
 *
 *   The `ON DELETE CASCADE` below already satisfies part of that policy at the
 *   schema level: an account's history is removed in the same transaction that
 *   removes the account, with no cleanup job to forget to run.
 */
export const searchUsage = pgTable(
  "search_usage",
  {
    /** Internal surrogate key. Never accepted from a request. */
    id: uuid("id").primaryKey().defaultRandom(),

    /**
     * The account that ran the search — `app_users.id`, resolved server-side
     * from the verified session. A caller can never supply this value.
     */
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),

    /** The submitted query, trimmed and capped at 2000 characters. */
    query: text("query").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // Every read is "this person's rows, newest first / within a window", so
    // (user_id, created_at DESC) serves both the lifetime total and the
    // trailing-30-day count.
    index("idx_search_usage_user_created_at").on(table.userId, table.createdAt.desc()),
    check(
      "search_usage_query_length_check",
      sql`char_length(${table.query}) between 1 and 2000`
    ),
  ]
);

export type SearchUsage = typeof searchUsage.$inferSelect;
export type NewSearchUsage = typeof searchUsage.$inferInsert;
