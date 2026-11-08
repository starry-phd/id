import { appLauncher } from './app-launcher';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import type { AppBindings } from '../env';
import { readWebSession } from '../identity/web-sessions';
import { randomToken } from '../lib/crypto';
import { memberNav } from './member-nav';

export type WebContext = Context<AppBindings>;
export type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

export const SESSION_COOKIE = 'starry_session';

/**
 * Loads the cookie session (if any) and a per-response CSP nonce, and sets a strict CSP
 * that only allows our inline scripts plus Google Identity Services, Sign in with Apple
 * and Turnstile.
 */
export const webContext: MiddlewareHandler<AppBindings> = async (c, next) => {
  const nonce = randomToken(16);
  c.set('cspNonce', nonce);
  c.set('web', await readWebSession(c.env.DB_IDENTITY, getCookie(c, SESSION_COOKIE, 'host'), Date.now()));
  await next();
  c.res.headers.set(
    'content-security-policy',
    [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}' https://accounts.google.com/gsi/client https://appleid.cdn-apple.com https://challenges.cloudflare.com`,
      "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
      'frame-src https://accounts.google.com https://appleid.apple.com https://challenges.cloudflare.com',
      "connect-src 'self' https://accounts.google.com",
      "img-src 'self' data:",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "object-src 'none'",
    ].join('; '),
  );
};

/**
 * CSRF defence for cookie-authenticated writes: the browser's Origin header must be
 * this site. Combined with SameSite=Lax cookies (spec: Starry ID login flow).
 */
export const sameOrigin: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const origin = c.req.header('origin');
    if (!origin || origin !== new URL(c.req.url).origin) {
      return c.html(page(c, '無法完成操作', html`<p>請從 Starry 帳號中心頁面重新操作。</p><p><a href="/account">回到帳號中心</a></p>`), 403);
    }
  }
  await next();
};

const STYLE = `
:root{--bg:#fbfaff;--fg:#1d1b2e;--muted:#5d5a72;--line:#dedbea;--accent:#5b3fd6;--danger:#b42318;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#121019;--fg:#ecebf5;--muted:#a9a6bd;--line:#2d2a3c;--accent:#a996ff;--danger:#ff8a80;--card:#1b1826}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"PingFang TC","Noto Sans TC",sans-serif}
main{max-width:720px;margin:0 auto;padding:24px 16px 64px}header{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:24px}
header a{color:var(--fg);text-decoration:none;font-weight:700}nav a{margin-left:12px;font-weight:400;color:var(--muted)}
h1{font-size:1.5rem;margin:0 0 16px}h2{font-size:1.15rem;margin:28px 0 8px}a{color:var(--accent)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:12px 0}
.muted{color:var(--muted);font-size:.92rem}.banner{border-left:4px solid var(--accent);padding:12px 16px;background:var(--card);border-radius:8px;margin:12px 0}
.danger{color:var(--danger)}.banner.danger{border-color:var(--danger)}
label{display:block;margin:12px 0 4px;font-weight:600}input,select,textarea{width:100%;font:inherit;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg)}
button,.button{display:inline-block;font:inherit;padding:10px 16px;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer;text-decoration:none;margin:8px 8px 0 0}
button.secondary,.button.secondary{background:transparent;color:var(--accent)}button.danger,.button.danger{background:var(--danger);border-color:var(--danger);color:#fff}
table{width:100%;border-collapse:collapse;font-size:.92rem}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top;word-break:break-word}
.pager{margin-top:12px}.inline{display:inline}code{font-size:.85em}
.launcher{position:relative;display:inline-block}
.launcher>summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:50%;color:var(--fg);user-select:none}
.launcher>summary::-webkit-details-marker{display:none}
.launcher>summary:hover,.launcher[open]>summary{background:rgba(127,127,160,.2)}
.lc-panel{position:absolute;right:0;top:calc(100% + 8px);z-index:60;width:min(340px,calc(100vw - 20px));max-height:70vh;overflow:auto;background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:16px;padding:12px;box-shadow:0 10px 32px rgba(0,0,0,.35)}
.lc-title{font-size:.8rem;color:var(--muted);margin:0 4px 8px}
.lc-list{display:flex;flex-direction:column;gap:2px}
.lc-row{display:flex;flex-direction:column;gap:4px;padding:8px 6px;border-radius:12px}
.lc-row:hover{background:rgba(127,127,160,.15)}
.lc-main{display:flex;align-items:center;gap:10px;color:var(--fg);text-decoration:none;min-width:0}
.lc-main.off{opacity:.5}
.lc-ico{width:44px;height:44px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:1.2rem;object-fit:cover}
.lc-text{display:flex;flex-direction:column;min-width:0}
.lc-name{font-weight:600;line-height:1.25}
.lc-sum{font-size:.78rem;color:var(--muted);line-height:1.3}
.lc-links{display:flex;flex-wrap:wrap;gap:6px;margin-left:54px}
.lc-chip{font-size:.75rem;padding:3px 10px;border:1px solid var(--line);border-radius:999px;color:var(--accent);text-decoration:none;white-space:nowrap}
.lc-note{font-size:.75rem;color:var(--muted)}
.starnav .launcher{margin-left:auto}
.topbar .launcher{order:0}
`;



const MEMBER_STYLE = `
:root{--bg:#07061a;--fg:#ecebff;--muted:#a8a5d0;--line:rgba(167,139,250,.28);--accent:#a78bfa;--danger:#ff8a80;--card:rgba(24,20,56,.72)}
html{background:#07061a}
body{background-color:#07061a;background-image:radial-gradient(1.2px 1.2px at 12% 18%,#fff,transparent),radial-gradient(1px 1px at 38% 62%,#cfc6ff,transparent),radial-gradient(1.4px 1.4px at 71% 24%,#fff,transparent),radial-gradient(1px 1px at 86% 78%,#fff,transparent),radial-gradient(1px 1px at 55% 90%,#b9a9ff,transparent),radial-gradient(900px 500px at 85% -10%,rgba(124,92,255,.28),transparent),radial-gradient(700px 500px at -10% 40%,rgba(56,189,248,.14),transparent);background-size:260px 260px,310px 310px,420px 420px,380px 380px,340px 340px,auto,auto;background-attachment:fixed;min-height:100vh}
.card{backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);box-shadow:0 6px 30px rgba(10,6,40,.45)}
button,.button{background:linear-gradient(135deg,#7c5cff,#a78bfa);border-color:transparent;color:#0b0720;font-weight:600}
button.secondary,.button.secondary{background:transparent;border-color:var(--line);color:var(--fg)}
input,select,textarea{background:rgba(9,7,30,.7)}
main{max-width:760px}
.starnav{position:sticky;top:0;z-index:30;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:4px 6px;padding:8px 10px;background:rgba(9,7,30,.92);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.starnav a{color:var(--fg);text-decoration:none;padding:6px 12px;border-radius:999px;display:inline-flex;align-items:center;gap:8px;flex:0 0 auto}
.starnav a:hover,.starnav a.on{background:rgba(167,139,250,.2)}
.starnav .stat{border:1px solid var(--line)}.starnav .me{font-weight:600}
@media (min-width:700px){.starnav{padding:10px 24px}}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:.82rem;border:1px solid var(--line);background:rgba(9,7,30,.5)}
.chips{display:flex;flex-wrap:wrap;gap:6px 8px;margin:8px 0}.actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:10px 0}.actions>*{margin:0}
.avatar{display:inline-flex;align-items:center;justify-content:center;border-radius:50%;object-fit:cover;background:linear-gradient(135deg,#5b3fd6,#38bdf8);color:#fff;font-weight:700;flex:0 0 auto}
.guest-brand{display:block;text-align:center;padding:14px;font-weight:700;color:var(--fg);text-decoration:none}
details.fold>summary{cursor:pointer;list-style:none;font-weight:700;padding:4px 0}
details.fold>summary::-webkit-details-marker{display:none}
details.fold>summary::after{content:"＋";float:right;color:var(--accent)}
details.fold[open]>summary::after{content:"－"}
.hero{display:flex;align-items:center;gap:16px;margin:8px 0 16px}.hero h1{margin:0}
.statrow{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin:12px 0}
.statbox{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px;text-align:center}
.statbox b{display:block;font-size:1.6rem}.statbox span{color:var(--muted);font-size:.9rem}
.tree,.tree ul{list-style:none;margin:0;padding-left:18px;border-left:1px dashed var(--line)}.tree{padding-left:0;border:0}
.tree li{margin:6px 0}.tree .node{display:inline-flex;align-items:center;gap:8px;padding:4px 10px 4px 4px;border:1px solid var(--line);border-radius:999px;background:var(--card)}
.tree .lv{color:var(--muted);font-size:.8rem}
`;

const ADMIN_STYLE = `
body.admin main{max-width:none;margin:0;padding:20px clamp(12px,3vw,40px) 64px}
.topbar{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:8px 16px;flex-wrap:wrap;padding:10px clamp(12px,3vw,40px);background:var(--card);border-bottom:1px solid var(--line)}
.topbar .brand{font-weight:700;color:var(--fg);text-decoration:none;margin-right:auto;font-size:1.05rem}
.topbar .menu-toggle{position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none}
.topbar .burger{display:none;cursor:pointer;font-size:1.6rem;line-height:1;padding:4px 10px;border:1px solid var(--line);border-radius:8px;user-select:none}
.topbar .menu{display:flex;align-items:center;gap:4px 8px;flex-wrap:wrap}
.topbar .menu a,.topbar .menu summary{color:var(--fg);text-decoration:none;padding:8px 12px;border-radius:8px;cursor:pointer;list-style:none;white-space:nowrap}
.topbar .menu summary::-webkit-details-marker{display:none}
.topbar .menu a:hover,.topbar .menu summary:hover{background:var(--bg)}
.topbar .menu a.on{background:var(--accent);color:#fff}
.topbar .menu form{margin:0}.topbar .menu button{margin:0;padding:8px 12px}
.topbar details.more{position:relative}
.topbar details.more .drop{position:absolute;right:0;top:calc(100% + 6px);min-width:200px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:6px;box-shadow:0 8px 24px rgba(0,0,0,.18);display:flex;flex-direction:column}
.topbar details.more .drop a{display:block}
.topbar details.more .drop hr{border:0;border-top:1px solid var(--line);margin:6px 0;width:100%}
@media (max-width:900px){
.topbar .burger{display:block}
.topbar .menu{display:none;width:100%;flex-direction:column;align-items:stretch;gap:2px}
.topbar .menu-toggle:checked ~ .menu{display:flex}
.topbar details.more .drop{position:static;box-shadow:none;border:0;padding:0 0 0 12px;min-width:0}
.topbar .menu a,.topbar .menu summary{padding:12px}
.topbar .menu button{width:100%;text-align:left}
}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr));gap:16px;align-items:start}
.grid>.card,.grid>form.card{margin:0}.grid>form:empty,.grid>form:not(.card){display:none}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:12px 0}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 16px}
.stat b{display:block;font-size:1.7rem;line-height:1.2}.stat span{color:var(--muted);font-size:.9rem}
.stat.warn{border-color:var(--danger)}
.chips{display:flex;flex-wrap:wrap;gap:6px 14px;margin:8px 0}.chips span{white-space:nowrap}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:.82rem;border:1px solid var(--line);background:var(--bg)}
.badge.ok{border-color:#2e9e4f;color:#2e9e4f}.badge.warn{border-color:#e0a800;color:#a87b00}.badge.bad{border-color:var(--danger);color:var(--danger)}
.actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:10px 0}.actions>*{margin:0}
.admin .card details{margin-top:10px;border-top:1px solid var(--line);padding-top:8px}
.admin .card details>summary{cursor:pointer;color:var(--accent);font-weight:600}
.admin .card details .links{display:flex;flex-wrap:wrap;gap:6px 16px;margin:10px 0}
.admin input,.admin select,.admin textarea{max-width:680px}
.admin .tablewrap{overflow-x:auto}
@media (max-width:720px){.admin table{display:block;overflow-x:auto}}
`;

export interface AdminMenu {
  primary: [string, string][];
  more: [string, string][];
}

export function page(c: WebContext, title: string, body: Html, options: { scripts?: Html; admin?: boolean; menu?: AdminMenu } = {}): Html {
  const signedIn = c.get('web') !== null;
  return html`<!doctype html>
<html lang="zh-Hant-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}｜Starry 帳號中心</title>
<style>${raw(STYLE + (options.admin ? ADMIN_STYLE : MEMBER_STYLE))}</style>
</head>
<body class="${options.admin ? 'admin' : ''}">
${options.admin ? adminHeader(c, signedIn, options.menu) : memberHeader(c)}
<main>
${body}
<p class="muted" style="margin-top:48px"><a href="/privacy">隱私權政策</a>&emsp;<a href="/terms">服務條款</a>&emsp;<a href="/support">客服與檢舉</a></p>
</main>
${options.scripts ?? ''}
</body>
</html>`;
}

const logoutForm = html`<form class="inline" method="post" action="/account/logout"><button class="secondary" type="submit">登出</button></form>`;

async function memberHeader(c: WebContext): Promise<Html> {
  const nav = await memberNav(c);
  return c.get('web') ? nav : html`<a class="guest-brand" href="/account">✦ Starry</a>`;
}

async function adminHeader(c: WebContext, signedIn: boolean, menu: AdminMenu | undefined): Promise<Html> {
  const path = new URL(c.req.url).pathname;
  const link = ([href, label]: [string, string]) => {
    const on = href === '/admin' ? path === '/admin' : path === href || path.startsWith(`${href}/`);
    return html`<a href="${href}"${on ? ' class="on" aria-current="page"' : ''}>${label}</a>`;
  };
  const m = menu ?? { primary: [], more: [] };
  return html`<header class="topbar">
  <a class="brand" href="/admin">Starry Admin</a>
  ${await appLauncher(c)}
  <input type="checkbox" id="menu-toggle" class="menu-toggle" aria-label="開關選單">
  <label for="menu-toggle" class="burger" aria-hidden="true">☰</label>
  <div class="menu">
    ${m.primary.map(link)}
    ${m.more.length > 0 ? html`<details class="more"><summary>更多 ▾</summary><div class="drop">${m.more.map(link)}</div></details>` : ''}
    ${signedIn ? html`<a href="/account">帳號中心</a>${logoutForm}` : ''}
  </div>
</header>`;
}

export function formatTime(ms: number | null): string {
  if (ms === null) return '—';
  return new Date(ms).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
}

/** Reads a urlencoded form; never throws. */
export async function readForm(c: WebContext): Promise<Record<string, string>> {
  try {
    const body = await c.req.parseBody();
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(body)) if (typeof value === 'string') out[key] = value;
    return out;
  } catch {
    return {};
  }
}
