import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AppBindings } from '../env';
import { hasRole, isAppStaff, listAppStaffApps, roleOf, type Role, type StaffActor, type StatusChangeResult } from '../identity/roles';
import { passkeyScript } from './account-lib';
import { page, sameOrigin, webContext, type AdminMenu, type Html, type WebContext } from './layout';

/**
 * Spec S-ADM-01 Admin Lite: server-rendered, phone-friendly, Starry ID sign-in plus a
 * role check on every request. Support can read; Admin can suspend, restore, adjust a
 * member's Battery and switch App status; only the Owner manages staff roles and the
 * Battery policy.
 */
export const adminApp = new Hono<AppBindings>();
adminApp.use('*', webContext, sameOrigin);

export const STATUS_LABELS: Record<string, string> = { active: '正常', suspended: '停權' };
export const ROLE_LABELS: Record<Role, string> = { owner: 'Owner', admin: 'Admin', support: 'Support' };
export const RESULT_TEXT: Record<StatusChangeResult, string> = {
  ok: '已完成。',
  not_found: '找不到此會員。',
  not_allowed: '你的角色不能對此會員執行這個操作。',
  wrong_status: '會員目前的狀態不允許這個操作。',
};

export async function staff(c: WebContext, minimum: Role): Promise<StaffActor | Response> {
  const web = c.get('web');
  if (!web) return c.redirect(`/account?next=${encodeURIComponent(new URL(c.req.url).pathname)}`, 303);
  const role = web.status === 'active' ? await roleOf(c.env.DB_IDENTITY, c.env.OWNER_USER_IDS, web.userId) : null;
  if (!role || !hasRole(role, minimum)) {
    return c.html(page(c, '沒有權限', html`<h1>沒有權限</h1><p>此頁面需要 ${ROLE_LABELS[minimum]} 以上的角色。</p>`, { admin: true }), 403);
  }
  return { userId: web.userId, role, requestId: c.get('requestId') };
}

/**
 * Access to one App's pages: Admin and Owner always; an App manager only for the Apps the Owner assigned.
 * The App manager is treated as an Admin on those pages only.
 */
export async function appAccess(c: WebContext, appId: string): Promise<StaffActor | Response> {
  const web = c.get('web');
  if (!web) return c.redirect(`/account?next=${encodeURIComponent(new URL(c.req.url).pathname)}`, 303);
  if (web.status === 'active') {
    const role = await roleOf(c.env.DB_IDENTITY, c.env.OWNER_USER_IDS, web.userId);
    if (role && hasRole(role, 'admin')) return { userId: web.userId, role, requestId: c.get('requestId') };
    if (await isAppStaff(c.env.DB_IDENTITY, web.userId, appId)) return { userId: web.userId, role: 'admin', requestId: c.get('requestId') };
  }
  return c.html(page(c, '沒有權限', html`<h1>沒有權限</h1><p>此頁面需要 Admin 以上的角色，或被指派為這款 App 的管理員。</p>`, { admin: true }), 403);
}

/**
 * Tickets and members only: global Support and above see everything; an App support person (Owner-assigned, kind
 * 'support') gets the same pages limited to their Apps (actor.appScope). Every other admin route keeps using
 * staff(), which never accepts a scoped person, so a new route is closed to them by default.
 */
export async function supportAccess(c: WebContext): Promise<StaffActor | Response> {
  const web = c.get('web');
  if (!web) return c.redirect(`/account?next=${encodeURIComponent(new URL(c.req.url).pathname)}`, 303);
  if (web.status === 'active') {
    const role = await roleOf(c.env.DB_IDENTITY, c.env.OWNER_USER_IDS, web.userId);
    if (role && hasRole(role, 'support')) return { userId: web.userId, role, requestId: c.get('requestId') };
    const apps = await listAppStaffApps(c.env.DB_IDENTITY, web.userId, 'support');
    if (apps.length > 0) return { userId: web.userId, role: 'support', requestId: c.get('requestId'), appScope: apps };
  }
  return c.html(page(c, '沒有權限', html`<h1>沒有權限</h1><p>此頁面需要 Support 以上的角色，或被指派為某款 App 的客服。</p>`, { admin: true }), 403);
}

/** Global staff may touch any ticket; a scoped person only tickets that name one of their Apps. */
export function scopeAllows(actor: StaffActor, appId: string | null): boolean {
  return actor.appScope === undefined || (appId !== null && actor.appScope.includes(appId));
}

/** Everyday pages sit in the top bar; the rest are folded into "更多" (and every item folds into the burger on a phone). */
const FULL_MENU: AdminMenu = {
  primary: [['/admin', '首頁'], ['/admin/members', '會員'], ['/admin/tickets', '客服單'], ['/admin/apps', 'App'], ['/admin/battery', '電池艙']],
  more: [['/admin/notices', '公告與維護'], ['/admin/broadcast', '全 App 推播'], ['/admin/apps/status', '整合狀態'], ['/admin/revenue', '營收'], ['/admin/audit', '稽核紀錄'], ['/admin/apps/new', '新增 App']],
};

const SCOPED_MENU: AdminMenu = {
  primary: [['/admin/tickets', '客服單'], ['/admin/members', '會員']],
  more: [],
};

export function adminPage(c: WebContext, title: string, body: Html, scripts?: Html, actor?: StaffActor): Html {
  return page(c, title, body, { admin: true, menu: actor?.appScope ? SCOPED_MENU : FULL_MENU, ...(scripts ? { scripts } : {}) });
}

/**
 * High-risk actions (delete a member, adjust Battery, regenerate a key, change a role): a staff member who has a
 * passkey must confirm with it first; the confirmation lasts 5 minutes per web session. Staff without a passkey
 * are not blocked (they could not confirm). Returns the confirmation page, or null when the action may proceed.
 * The page re-sends the original form once confirmed.
 */
export async function requireStepUp(c: WebContext, actor: StaffActor): Promise<Response | null> {
  const web = c.get('web');
  if (!web) return null;
  const db = c.env.DB_IDENTITY;
  const now = Date.now();
  const has = await db.prepare('SELECT 1 AS ok FROM passkeys WHERE user_id = ? LIMIT 1').bind(actor.userId).first();
  if (!has) return null;
  const fresh = await db.prepare('SELECT 1 AS ok FROM staff_stepups WHERE session_id = ? AND expires_at > ?').bind(web.sessionId, now).first();
  if (fresh) return null;
  let fields: [string, string][];
  try {
    const body = await c.req.parseBody({ all: true });
    fields = Object.entries(body).flatMap(([key, value]) => (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === 'string').map((v): [string, string] => [key, v]));
  } catch {
    fields = [];
  }
  return c.html(
    adminPage(
      c,
      '需要二次確認',
      html`<h1>需要二次確認</h1>
<div class="card"><p>這是高風險操作。請用你的 Passkey 確認是你本人，確認後 5 分鐘內的高風險操作不用再確認。</p>
<form id="resubmit" method="post" action="${new URL(c.req.url).pathname}">${fields.map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}</form>
<button id="stepup-passkey" type="button">用 Passkey 確認並繼續</button>
<p id="passkey-error" class="muted"></p></div>`,
      passkeyScript(c, 'stepup'),
    ),
  );
}
