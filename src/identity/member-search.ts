import { getBalances, type Balance } from '../battery/battery';
import { ownerIds, type Role } from './roles';

export const MEMBER_STATUSES = ['active', 'suspended'] as const;

export interface MemberFilters {
  /** Matches member number, full name, any sign-in or contact email (part of it is enough), or the exact internal ID. */
  query?: string | undefined;
  status?: string | undefined;
  provider?: string | undefined;
  /** ISO country the member signed up from. */
  country?: string | undefined;
  /** Joined between these instants (ms, inclusive start, exclusive end). */
  from?: number | undefined;
  to?: number | undefined;
  staffOnly?: boolean | undefined;
  /** Only members who have used one of these Apps (App-scoped support); an empty list matches nobody. */
  appIds?: readonly string[] | undefined;
  /** Battery remaining this month, inclusive. */
  batteryMin?: number | undefined;
  batteryMax?: number | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

export interface MemberSummary {
  user_id: string;
  member_no: string | null;
  status: string;
  status_reason: string | null;
  created_at: number;
  display_name: string | null;
  contact_email: string | null;
  emails: (string | null)[];
  providers: string[];
  country: string | null;
  last_login_at: number | null;
  role: Role | null;
  battery: Balance | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOP = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const PAGE = 50;
/** With a Battery filter the members are scanned in pages; stop after this many pages and let the staff continue. */
const MAX_SCAN_PAGES = 12;

const like = (text: string) => `%${text.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

function whereOf(filters: MemberFilters, cursor: string): { sql: string; binds: (string | number)[] } {
  const conditions = ['u.user_id < ?'];
  const binds: (string | number)[] = [cursor];
  const query = filters.query?.trim().toLowerCase() ?? '';
  if (query.length > 0) {
    conditions.push(
      `(u.user_id = ? OR u.member_no LIKE ? ESCAPE '\\' OR p.display_name LIKE ? ESCAPE '\\' OR p.contact_email LIKE ? ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM auth_identities a WHERE a.user_id = u.user_id AND a.email LIKE ? ESCAPE '\\'))`,
    );
    binds.push(UUID.test(query) ? query : '-', like(query), like(query), like(query), like(query));
  }
  if (filters.status && (MEMBER_STATUSES as readonly string[]).includes(filters.status)) {
    conditions.push('u.status = ?');
    binds.push(filters.status);
  }
  if (filters.provider === 'apple' || filters.provider === 'google') {
    conditions.push('EXISTS (SELECT 1 FROM auth_identities a WHERE a.user_id = u.user_id AND a.provider = ?)');
    binds.push(filters.provider);
  }
  if (filters.country && /^[A-Za-z]{2}$/.test(filters.country)) {
    conditions.push('u.registration_country = ?');
    binds.push(filters.country.toUpperCase());
  }
  if (filters.from !== undefined) {
    conditions.push('u.created_at >= ?');
    binds.push(filters.from);
  }
  if (filters.to !== undefined) {
    conditions.push('u.created_at < ?');
    binds.push(filters.to);
  }
  if (filters.staffOnly) conditions.push('u.user_id IN (SELECT user_id FROM user_roles)');
  if (filters.appIds !== undefined) {
    if (filters.appIds.length === 0) conditions.push('0');
    else {
      conditions.push(`u.user_id IN (SELECT user_id FROM member_apps WHERE app_id IN (${filters.appIds.map(() => '?').join(',')}))`);
      binds.push(...filters.appIds);
    }
  }
  return { sql: conditions.join(' AND '), binds };
}

async function summaries(db: D1Database, ownerUserIds: string | undefined, ids: string[]): Promise<MemberSummary[]> {
  if (ids.length === 0) return [];
  const marks = ids.map(() => '?').join(',');
  const [users, identities, roles] = await db.batch([
    db
      .prepare(
        `SELECT u.user_id, u.member_no, u.status, u.status_reason, u.created_at, u.registration_country, p.display_name, p.contact_email
         FROM users u LEFT JOIN profiles p ON p.user_id = u.user_id WHERE u.user_id IN (${marks})`,
      )
      .bind(...ids),
    db.prepare(`SELECT user_id, provider, email, last_login_at FROM auth_identities WHERE user_id IN (${marks}) ORDER BY provider`).bind(...ids),
    db.prepare(`SELECT user_id, role FROM user_roles WHERE user_id IN (${marks})`).bind(...ids),
  ]);
  type UserRow = { user_id: string; member_no: string | null; status: string; status_reason: string | null; created_at: number; registration_country: string | null; display_name: string | null; contact_email: string | null };
  const owners = ownerIds(ownerUserIds);
  const byId = new Map((users?.results as UserRow[]).map((u) => [u.user_id, u]));
  const linked = (identities?.results ?? []) as { user_id: string; provider: string; email: string | null; last_login_at: number }[];
  const staffRoles = new Map(((roles?.results ?? []) as { user_id: string; role: Role }[]).map((r) => [r.user_id, r.role]));
  const result: MemberSummary[] = [];
  for (const id of ids) {
    const u = byId.get(id);
    if (!u) continue;
    const mine = linked.filter((i) => i.user_id === id);
    result.push({
      user_id: u.user_id,
      member_no: u.member_no,
      status: u.status,
      status_reason: u.status_reason,
      created_at: u.created_at,
      display_name: u.display_name,
      contact_email: u.contact_email,
      emails: mine.map((i) => i.email),
      providers: mine.map((i) => i.provider),
      country: u.registration_country,
      last_login_at: mine.length > 0 ? Math.max(...mine.map((i) => i.last_login_at)) : null,
      role: owners.has(id) ? 'owner' : (staffRoles.get(id) ?? null),
      battery: null,
    });
  }
  return result;
}

/**
 * Admin member search (spec S-ADM-01, owner decision 2026-11-07: full names and emails, no masking).
 * Newest first with a cursor. Battery lives in another database, so a Battery filter scans members page by page.
 */
export async function searchMembers(
  db: D1Database,
  batteryDb: D1Database | null,
  ownerUserIds: string | undefined,
  filters: MemberFilters,
  now: number,
): Promise<{ members: MemberSummary[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), PAGE);
  const wantsBattery = filters.batteryMin !== undefined || filters.batteryMax !== undefined;
  const found: MemberSummary[] = [];
  let cursor = filters.cursor && UUID.test(filters.cursor) ? filters.cursor : TOP;
  let more = false;
  for (let page = 0; page < (wantsBattery ? MAX_SCAN_PAGES : 1); page++) {
    const { sql, binds } = whereOf(filters, cursor);
    const take = wantsBattery ? PAGE : limit;
    const rows = await db
      .prepare(`SELECT u.user_id FROM users u LEFT JOIN profiles p ON p.user_id = u.user_id WHERE ${sql} ORDER BY u.user_id DESC LIMIT ?`)
      .bind(...binds, take + 1)
      .all<{ user_id: string }>();
    more = rows.results.length > take;
    const ids = rows.results.slice(0, take).map((r) => r.user_id);
    let batch = await summaries(db, ownerUserIds, ids);
    if (batteryDb) {
      const balances = await getBalances(batteryDb, ids, now);
      for (const member of batch) member.battery = balances.get(member.user_id) ?? null;
    }
    if (wantsBattery) {
      batch = batch.filter((m) => m.battery && (filters.batteryMin === undefined || m.battery.remaining >= filters.batteryMin) && (filters.batteryMax === undefined || m.battery.remaining <= filters.batteryMax));
    }
    for (const member of batch) {
      if (found.length >= limit) break;
      found.push(member);
    }
    const lastScanned = ids[ids.length - 1];
    if (found.length >= limit) {
      // Resume right after the last member shown.
      cursor = found[found.length - 1]?.user_id ?? cursor;
      more = more || cursor !== lastScanned;
      break;
    }
    if (!more || !lastScanned) break;
    cursor = lastScanned;
  }
  return { members: found, nextCursor: more ? cursor : null };
}

/** One member by internal ID, member number or exact email (detail page and ticket links). */
export async function findMemberSummary(db: D1Database, batteryDb: D1Database | null, ownerUserIds: string | undefined, id: string, now: number): Promise<MemberSummary | null> {
  const key = id.trim().toLowerCase();
  const row = UUID.test(key)
    ? await db.prepare('SELECT user_id FROM users WHERE user_id = ?').bind(key).first<{ user_id: string }>()
    : await db.prepare('SELECT user_id FROM users WHERE member_no = ?').bind(key).first<{ user_id: string }>();
  if (!row) return null;
  const [member] = await summaries(db, ownerUserIds, [row.user_id]);
  if (member && batteryDb) member.battery = (await getBalances(batteryDb, [member.user_id], now)).get(member.user_id) ?? null;
  return member ?? null;
}
