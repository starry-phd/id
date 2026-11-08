import { html, raw } from 'hono/html';
import { appRegistry } from '../apps/registry';
import type { Html, WebContext } from './layout';

/** Soft background colours for the letter icons; picked by a stable hash of the App id. */
const TILE_COLORS = ['#7c5cff', '#2f9e8f', '#e0773c', '#d6457a', '#3b82c4', '#8a9a2b', '#a35bd1', '#c4912f'] as const;

function colorOf(appId: string): string {
  let h = 0;
  for (const ch of appId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TILE_COLORS[h % TILE_COLORS.length] ?? TILE_COLORS[0];
}

const DOTS = html`<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">${raw(
  [4, 12, 20].flatMap((y) => [4, 12, 20].map((x) => `<circle cx="${x}" cy="${y}" r="2" fill="currentColor"/>`)).join(''),
)}</svg>`;

/**
 * The Google-style 9-dot launcher: a button that opens a panel with every Starry App.
 * The account centre comes first; Apps without a web version are shown dimmed, killed Apps are left out.
 */
export function appLauncher(c: WebContext): Html {
  const nonce = c.get('cspNonce');
  const apps = appRegistry.values().filter((a) => a.app_id !== 'account' && a.status !== 'killed');
  const tile = (name: string, href: string | null, color: string, note = '') => {
    const letter = [...name.trim()][0]?.toUpperCase() ?? '?';
    const inner = html`<span class="lc-ico" style="background:${color}">${letter}</span><span class="lc-name">${name}</span>${note ? html`<span class="lc-note">${note}</span>` : ''}`;
    return href ? html`<a class="lc-tile" href="${href}" rel="noopener">${inner}</a>` : html`<span class="lc-tile off" aria-disabled="true">${inner}</span>`;
  };
  const tiles = [
    tile('帳號中心', '/account', '#5b3fd6'),
    ...apps.map((a) => tile(a.name, a.status === 'paused' ? null : (a.web_origins[0] ?? null), colorOf(a.app_id), a.status === 'paused' ? '暫停' : a.web_origins[0] ? '' : '僅手機')),
  ];
  return html`<details class="launcher" id="app-launcher">
  <summary class="lc-btn" aria-label="繁星 Apps" title="繁星 Apps">${DOTS}</summary>
  <div class="lc-panel" role="menu" aria-label="繁星生態系 Apps">
    <div class="lc-title">繁星生態系</div>
    <div class="lc-grid">${tiles}</div>
  </div>
</details>
<script nonce="${nonce}">
(function(){var d=document.getElementById('app-launcher');if(!d)return;
document.addEventListener('click',function(e){if(d.open&&!d.contains(e.target))d.open=false;});
document.addEventListener('keydown',function(e){if(e.key==='Escape')d.open=false;});})();
</script>`;
}
