import { html, raw } from 'hono/html';
import { launcherItems, listLauncherRows, type LauncherItem } from '../apps/launcher';
import { iconUrl } from './launcher-icons';
import type { Html, WebContext } from './layout';

/** Soft background colours for the letter icons; picked by a stable hash of the App id. */
const TILE_COLORS = ['#7c5cff', '#2f9e8f', '#e0773c', '#d6457a', '#3b82c4', '#8a9a2b', '#a35bd1', '#c4912f'] as const;

function colorOf(appId: string): string {
  if (appId === 'account') return '#5b3fd6';
  let h = 0;
  for (const ch of appId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TILE_COLORS[h % TILE_COLORS.length] ?? TILE_COLORS[0];
}

const DOTS = html`<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">${raw(
  [4, 12, 20].flatMap((y) => [4, 12, 20].map((x) => `<circle cx="${x}" cy="${y}" r="2" fill="currentColor"/>`)).join(''),
)}</svg>`;

function row(i: LauncherItem): Html {
  const letter = [...i.name.trim()][0]?.toUpperCase() ?? '?';
  const icon = i.iconKey
    ? html`<img class="lc-ico" src="${iconUrl(i.appId, i.iconKey)}" alt="" width="44" height="44">`
    : html`<span class="lc-ico" style="background:${colorOf(i.appId)}">${letter}</span>`;
  const text = html`<span class="lc-text"><span class="lc-name">${i.name}</span>${i.summary ? html`<span class="lc-sum">${i.summary}</span>` : ''}</span>`;
  const main = !i.paused && i.web ? html`<a class="lc-main" href="${i.web}" rel="noopener">${icon}${text}</a>` : html`<span class="lc-main off">${icon}${text}</span>`;
  const links = i.paused
    ? html`<span class="lc-note">暫停中</span>`
    : html`${i.web ? html`<a class="lc-chip" href="${i.web}" rel="noopener">網頁</a>` : ''}${i.play ? html`<a class="lc-chip" href="${i.play}" rel="noopener">Google Play</a>` : ''}${i.appstore ? html`<a class="lc-chip" href="${i.appstore}" rel="noopener">App Store</a>` : ''}`;
  return html`<div class="lc-row">${main}<div class="lc-links">${links}</div></div>`;
}

/**
 * The Google-style 9-dot launcher: a button that opens a panel listing every Starry App, in the order, with the icons,
 * names, links and descriptions the Owner set in Admin Lite (/admin/launcher). Killed Apps are left out.
 */
export async function appLauncher(c: WebContext): Promise<Html> {
  const nonce = c.get('cspNonce');
  const rows = await listLauncherRows(c.env.DB_IDENTITY).catch(() => new Map());
  return html`<details class="launcher" id="app-launcher">
  <summary class="lc-btn" aria-label="繁星 Apps" title="繁星 Apps">${DOTS}</summary>
  <div class="lc-panel" role="menu" aria-label="繁星生態系 Apps">
    <div class="lc-title">繁星生態系</div>
    <div class="lc-list">${launcherItems(rows).map(row)}</div>
  </div>
</details>
<script nonce="${nonce}">
(function(){var d=document.getElementById('app-launcher');if(!d)return;
document.addEventListener('click',function(e){if(d.open&&!d.contains(e.target))d.open=false;});
document.addEventListener('keydown',function(e){if(e.key==='Escape')d.open=false;});})();
</script>`;
}
