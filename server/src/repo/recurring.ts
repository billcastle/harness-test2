import type { Db } from '../db.js';
import { AppError, pgCode } from '../errors.js';
import { FREQUENCIES, monthlyCost, nextDue, type Frequency } from '../lib/recurring.js';
import { MoneyError, parseAmount } from '../lib/money.js';
import { isValidDate } from '../lib/time.js';
import { getUncategorizedId } from './categories.js';

export interface Recurring {
  id: number;
  description: string;
  amountCentavos: number;
  frequency: Frequency;
  categoryId: number;
  categoryName: string;
  startDate: string;
  endDate: string | null;
  /** What one month counts as: the amount, or a twelfth of it for a yearly bill. */
  perMonthCentavos: number;
  /** Next charge date, or null once it has ended. */
  nextDue: string | null;
  /** True when the end date has passed. */
  ended: boolean;
}
interface Row {
  id: string;
  description: string;
  amount: string;
  frequency: Frequency;
  category_id: string;
  category: string;
  start_date: string;
  end_date: string | null;
}
const SELECT = `select r.id::text as id, r.description, r.amount_centavos::text as amount, r.frequency, r.category_id::text as category_id,
  c.name as category, r.start_date::text as start_date, r.end_date::text as end_date
  from recurring_expenses r join categories c on c.id = r.category_id`;

export function mapRecurring(r: Row, today: string): Recurring {
  const base = { amountCentavos: Number(r.amount), frequency: r.frequency, startDate: r.start_date, endDate: r.end_date };
  return {
    id: Number(r.id), description: r.description, amountCentavos: base.amountCentavos, frequency: r.frequency,
    categoryId: Number(r.category_id), categoryName: r.category, startDate: r.start_date, endDate: r.end_date,
    perMonthCentavos: Math.round(monthlyCost(base)),
    nextDue: nextDue(base, today),
    ended: r.end_date !== null && r.end_date < today,
  };
}

export async function listRecurring(db: Db, today: string): Promise<Recurring[]> {
  const r = await db.query<Row>(`${SELECT} order by (r.end_date is not null and r.end_date < $1), lower(r.description), r.id`, [today]);
  return r.rows.map((x) => mapRecurring(x, today));
}

async function getRecurring(db: Db, id: number, today: string): Promise<Recurring> {
  const r = await db.query<Row>(`${SELECT} where r.id = $1`, [id]);
  if (!r.rows[0]) throw new AppError(404, 'recurring expense not found');
  return mapRecurring(r.rows[0], today);
}

interface Input {
  description?: string;
  amountCentavos?: number;
  frequency?: Frequency;
  categoryId?: number;
  startDate?: string;
  endDate?: string | null;
}

export function parseRecurringBody(body: unknown, forCreate: boolean, today: string): Input {
  if (typeof body !== 'object' || body === null) throw new AppError(400, 'JSON body required');
  const b = body as Record<string, unknown>;
  const out: Input = {};
  if (b.description !== undefined || forCreate) {
    if (typeof b.description !== 'string' || b.description.trim().length < 1 || b.description.trim().length > 200) throw new AppError(400, 'description must be 1 to 200 characters');
    out.description = b.description.trim();
  }
  if (b.amount !== undefined || forCreate) {
    try {
      out.amountCentavos = parseAmount(b.amount);
    } catch (e) {
      if (e instanceof MoneyError) throw new AppError(400, e.message);
      throw e;
    }
  }
  if (b.frequency !== undefined || forCreate) {
    if (typeof b.frequency !== 'string' || !(FREQUENCIES as readonly string[]).includes(b.frequency)) throw new AppError(400, `frequency must be one of ${FREQUENCIES.join(', ')}`);
    out.frequency = b.frequency as Frequency;
  }
  if (b.categoryId !== undefined) {
    if (typeof b.categoryId !== 'number' || !Number.isInteger(b.categoryId) || b.categoryId < 1) throw new AppError(400, 'categoryId must be a positive integer');
    out.categoryId = b.categoryId;
  }
  if (b.startDate !== undefined || forCreate) {
    const d = b.startDate ?? today;
    if (!isValidDate(d)) throw new AppError(400, 'startDate must be a real date like 2026-11-30');
    out.startDate = d;
  }
  if (b.endDate !== undefined) {
    if (b.endDate !== null && b.endDate !== '' && !isValidDate(b.endDate)) throw new AppError(400, 'endDate must be a real date or empty');
    out.endDate = b.endDate === null || b.endDate === '' ? null : (b.endDate as string);
  }
  return out;
}

function mapDbError(err: unknown): never {
  const code = pgCode(err);
  if (code === '23503') throw new AppError(400, 'category does not exist');
  if (code === '23514') throw new AppError(400, 'the end date cannot be before the start date');
  throw err;
}

export async function createRecurring(db: Db, input: Input, today: string): Promise<Recurring> {
  const categoryId = input.categoryId ?? (await getUncategorizedId(db));
  try {
    const r = await db.query<{ id: string }>(
      `insert into recurring_expenses (description, amount_centavos, frequency, category_id, start_date, end_date)
       values ($1, $2, $3, $4, $5, $6) returning id::text as id`,
      [input.description, input.amountCentavos, input.frequency, categoryId, input.startDate, input.endDate ?? null],
    );
    return getRecurring(db, Number(r.rows[0]!.id), today);
  } catch (err) {
    return mapDbError(err);
  }
}

export async function updateRecurring(db: Db, id: number, input: Input, today: string): Promise<Recurring> {
  const cur = await getRecurring(db, id, today);
  const next = {
    description: input.description ?? cur.description,
    amountCentavos: input.amountCentavos ?? cur.amountCentavos,
    frequency: input.frequency ?? cur.frequency,
    categoryId: input.categoryId ?? cur.categoryId,
    startDate: input.startDate ?? cur.startDate,
    endDate: input.endDate === undefined ? cur.endDate : input.endDate,
  };
  try {
    await db.query(
      `update recurring_expenses set description = $2, amount_centavos = $3, frequency = $4, category_id = $5, start_date = $6, end_date = $7, updated_at = now() where id = $1`,
      [id, next.description, next.amountCentavos, next.frequency, next.categoryId, next.startDate, next.endDate],
    );
    return getRecurring(db, id, today);
  } catch (err) {
    return mapDbError(err);
  }
}

export async function deleteRecurring(db: Db, id: number): Promise<void> {
  const r = await db.query('delete from recurring_expenses where id = $1', [id]);
  if (r.rowCount === 0) throw new AppError(404, 'recurring expense not found');
}

/** Items whose months overlap [from, to], for the summary. */
export async function recurringForSummary(db: Db): Promise<{ id: number; description: string; categoryId: number; categoryName: string; color: string; amountCentavos: number; frequency: Frequency; startDate: string; endDate: string | null }[]> {
  const r = await db.query<Row & { color: string }>(`select r.id::text as id, r.description, r.amount_centavos::text as amount, r.frequency, r.category_id::text as category_id,
    c.name as category, c.color, r.start_date::text as start_date, r.end_date::text as end_date
    from recurring_expenses r join categories c on c.id = r.category_id order by r.id`);
  return r.rows.map((x) => ({
    id: Number(x.id), description: x.description, categoryId: Number(x.category_id), categoryName: x.category, color: x.color,
    amountCentavos: Number(x.amount), frequency: x.frequency, startDate: x.start_date, endDate: x.end_date,
  }));
}
