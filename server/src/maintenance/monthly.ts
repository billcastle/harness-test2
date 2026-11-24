// The monthly tidy-up, run by a Vercel cron (see vercel.ts). Every step is idempotent and conservative:
// it only touches what it is sure about and leaves the rest as it was.
import { purgeLockoutData } from '../auth/lockout.js';
import { purgeExpiredSessions } from '../auth/sessions.js';
import type { Db } from '../db.js';
import { guessCategoryId } from '../import/guess.js';
import { merchantKey } from '../lib/normalize.js';
import { addMonths, manilaToday } from '../lib/time.js';
import { getUncategorizedId, upsertMerchantRule } from '../repo/categories.js';
import { purgeDeleted } from '../repo/transactions.js';

export interface MaintenanceReport {
  /** Descriptions with stray spaces cleaned up. */
  tidied: number;
  /** Uncategorized transactions that were given a category. */
  categorized: number;
  /** New recurring expenses, and how many transactions they replaced in the list. */
  recurringCreated: { description: string; amountCentavos: number; frequency: 'monthly' | 'yearly' }[];
  /** Transactions taken out of the list because a recurring expense now covers them. */
  transactionsMoved: number;
  /** Merchants remembered so the next import pre-fills their category. */
  rulesLearned: number;
  /** Rows removed for good: deleted transactions past the undo window, expired sessions. */
  purged: { transactions: number; sessions: number };
}

interface Tx {
  id: number;
  date: string;
  amount: number;
  description: string;
  categoryId: number;
}

const toTx = (r: { id: string; date: string; amount: string; description: string; category_id: string }): Tx => ({
  id: Number(r.id), date: r.date, amount: Number(r.amount), description: r.description, categoryId: Number(r.category_id),
});

const dayMs = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / dayMs);

/**
 * "Same merchant, same amount, once a month for three or more months in a row, last seen in the past two months" is a
 * monthly bill; "same merchant and amount about a year apart, last seen within 13 months" is a yearly one.
 * Anything looser (a daily coffee, a price change, a gap) is left alone.
 */
export function detectRecurring(rows: Tx[], today: string): { rows: Tx[]; frequency: 'monthly' | 'yearly' }[] {
  const groups = new Map<string, Tx[]>();
  for (const r of rows) {
    const key = merchantKey(r.description);
    if (!key) continue;
    const k = `${key}|${r.amount}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const found: { rows: Tx[]; frequency: 'monthly' | 'yearly' }[] = [];
  const recent = addMonths(today, -2);
  for (const g of groups.values()) {
    g.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));
    const months = g.map((r) => `${r.date.slice(0, 7)}-01`);
    const monthly =
      g.length >= 3 &&
      new Set(months).size === g.length && // once a month, never twice
      months.every((m, i) => i === 0 || m === addMonths(months[i - 1]!, 1)) && // no gaps
      months[months.length - 1]! >= recent;
    if (monthly) { found.push({ rows: g, frequency: 'monthly' }); continue; }
    const yearly =
      g.length >= 2 &&
      g.every((r, i) => i === 0 || Math.abs(daysBetween(g[i - 1]!.date, r.date) - 365) <= 10) &&
      daysBetween(g[g.length - 1]!.date, today) <= 395;
    if (yearly) found.push({ rows: g, frequency: 'yearly' });
  }
  return found;
}

export async function runMonthlyMaintenance(db: Db, now: Date): Promise<MaintenanceReport> {
  const today = manilaToday(now);
  const uncategorized = await getUncategorizedId(db);

  // 1. stray whitespace in descriptions
  const tidy = `btrim(regexp_replace(description, '\\s+', ' ', 'g'))`;
  const tidied = (await db.query(`update transactions set description = ${tidy}, updated_at = now() where description <> ${tidy}`)).rowCount
    + (await db.query(`update recurring_expenses set description = ${tidy}, updated_at = now() where description <> ${tidy}`)).rowCount;

  // 2. categorize what is still Uncategorized: your remembered merchants first, then a keyword guess; unsure rows stay as they are
  const ruleRows = (await db.query<{ m: string; c: string }>('select merchant_normalized as m, category_id::text as c from merchant_rules')).rows;
  const rules = new Map(ruleRows.map((r) => [r.m, Number(r.c)]));
  const cats = (await db.query<{ id: string; name: string }>('select id::text as id, name from categories where not is_system')).rows.map((c) => ({ id: Number(c.id), name: c.name }));
  const pending = (await db.query<{ id: string; description: string }>(
    'select id::text as id, description from transactions where deleted_at is null and category_id = $1', [uncategorized],
  )).rows;
  const byCategory = new Map<number, number[]>();
  for (const r of pending) {
    const target = rules.get(merchantKey(r.description)) ?? guessCategoryId(r.description, cats);
    if (target !== null && target !== undefined && target !== uncategorized) byCategory.set(target, [...(byCategory.get(target) ?? []), Number(r.id)]);
  }
  let categorized = 0;
  for (const [categoryId, ids] of byCategory) {
    categorized += (await db.query('update transactions set category_id = $1, updated_at = now() where id = any($2::bigint[])', [categoryId, ids])).rowCount;
  }

  // 3. repeating charges become recurring expenses and leave the transaction list
  const expenses = (await db.query<{ id: string; date: string; amount: string; description: string; category_id: string }>(
    `select id::text as id, date::text as date, amount_centavos::text as amount, description, category_id::text as category_id
       from transactions where deleted_at is null and kind = 'expense'`,
  )).rows.map(toTx);
  const existing = (await db.query<{ description: string; amount: string }>('select description, amount_centavos::text as amount from recurring_expenses')).rows;
  const known = new Map<string, Set<number>>(); // merchant -> amounts already listed as recurring
  for (const e of existing) {
    const k = merchantKey(e.description);
    known.set(k, (known.get(k) ?? new Set()).add(Number(e.amount)));
  }
  const recurringCreated: MaintenanceReport['recurringCreated'] = [];
  let transactionsMoved = 0;
  for (const g of detectRecurring(expenses, today)) {
    const last = g.rows[g.rows.length - 1]!;
    const key = merchantKey(last.description);
    const listed = known.get(key)?.has(last.amount) ?? false;
    // a merchant already listed at another amount is a price change someone may have handled by hand: leave it alone
    if (!listed && known.has(key)) continue;
    await db.transaction(async (tx) => {
      if (!listed) {
        const counts = new Map<number, number>();
        for (const r of g.rows) counts.set(r.categoryId, (counts.get(r.categoryId) ?? 0) + 1);
        const category = [...counts].sort((a, b) => b[1] - a[1])[0]![0];
        await tx.query(
          `insert into recurring_expenses (description, amount_centavos, frequency, category_id, start_date) values ($1, $2, $3, $4, $5)`,
          [last.description.slice(0, 200), last.amount, g.frequency, category, g.rows[0]!.date],
        );
        recurringCreated.push({ description: last.description.slice(0, 200), amountCentavos: last.amount, frequency: g.frequency });
        known.set(key, (known.get(key) ?? new Set()).add(last.amount));
      }
      // soft delete: still counted once by the recurring expense, and restorable for the undo window
      transactionsMoved += (await tx.query(
        'update transactions set deleted_at = now(), updated_at = now() where id = any($1::bigint[]) and deleted_at is null', [g.rows.map((r) => r.id)],
      )).rowCount;
    });
  }

  // 4. remember merchants that have always gone to the same category, so the next import pre-fills them
  const settled = (await db.query<{ description: string; category_id: string }>(
    `select description, category_id::text as category_id from transactions where deleted_at is null and kind = 'expense' and category_id <> $1`, [uncategorized],
  )).rows;
  const seen = new Map<string, { categories: Set<number>; n: number; description: string }>();
  for (const r of settled) {
    const k = merchantKey(r.description);
    if (!k) continue;
    const s = seen.get(k) ?? { categories: new Set<number>(), n: 0, description: r.description };
    s.categories.add(Number(r.category_id));
    s.n += 1;
    seen.set(k, s);
  }
  const everything = new Set((await db.query<{ m: string }>('select merchant_normalized as m from merchant_rules')).rows.map((r) => r.m));
  let rulesLearned = 0;
  for (const [k, s] of seen) {
    // merchants that are also recurring are covered already; an unsure merchant (two categories) learns nothing
    if (s.n >= 3 && s.categories.size === 1 && !everything.has(k)) {
      await upsertMerchantRule(db, s.description, [...s.categories][0]!);
      rulesLearned += 1;
    }
  }

  // 5. housekeeping that otherwise waits for a lucky request
  const transactions = await purgeDeleted(db, new Date(now.getTime() - 24 * 3_600_000));
  const sessions = await purgeExpiredSessions(db, now);
  await purgeLockoutData(db, now);

  return { tidied, categorized, recurringCreated, transactionsMoved, rulesLearned, purged: { transactions, sessions } };
}
