import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import type { AppBindings } from '../env';
import { readWebSession } from '../identity/web-sessions';
import { randomToken } from '../lib/crypto';

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
button.secondary{background:transparent;color:var(--accent)}button.danger{background:var(--danger);border-color:var(--danger)}
table{width:100%;border-collapse:collapse;font-size:.92rem}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top;word-break:break-word}
.pager{margin-top:12px}.inline{display:inline}code{font-size:.85em}
`;

export function page(c: WebContext, title: string, body: Html, options: { scripts?: Html; admin?: boolean } = {}): Html {
  const signedIn = c.get('web') !== null;
  return html`<!doctype html>
<html lang="zh-Hant-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}｜Starry 帳號中心</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<header>
  <a href="${options.admin ? '/admin' : '/account'}">${options.admin ? 'Starry Admin Lite' : 'Starry 帳號中心'}</a>
  <nav>${options.admin ? html`<a href="/account">帳號中心</a>` : html`<a href="/support">客服</a>`}${signedIn ? html`<form class="inline" method="post" action="/account/logout"><button class="secondary" type="submit">登出</button></form>` : ''}</nav>
</header>
${body}
<p class="muted" style="margin-top:48px"><a href="/privacy">隱私權政策</a>&emsp;<a href="/terms">服務條款</a>&emsp;<a href="/support">客服與檢舉</a></p>
</main>
${options.scripts ?? ''}
</body>
</html>`;
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
