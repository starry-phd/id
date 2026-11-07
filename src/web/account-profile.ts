import { html, raw } from 'hono/html';
import { background } from '../auth/routes';
import { mailSettings } from '../notify/email';
import { initialsOf } from '../identity/initials';
import { avatarBubble } from './member-nav';
import { googlePhotoOf, importProviderAvatar, MAX_AVATAR_BYTES, r2Store, removeAvatar, setAvatar } from '../identity/avatars';
import { type ProfileRow } from '../identity/members';
import { confirmContactEmail, sendContactEmailVerification, type ConfirmResult } from '../identity/contact-email';
import { randomMotto } from '../identity/mottos';
import { ageOn, derivedOf, EDITABLE_FIELDS, effectiveVisibility, GRID_LAYOUT, hasChanges, loadProfile, saveProfile, validateProfileInput, type EditableField, type FieldUpdate, type Visibility, type VisibilityField } from '../identity/profile';
import { WEB_APP_ID } from '../identity/web-sessions';
import { formatTime, page, readForm, type Html, type WebContext } from './layout';
import { LOCALES, accountApp } from './account-lib';
import { changeMemberNo, countryOptions, isMemberNoFree, MEMBER_NO_CHANGES_PER_DAY, normalizeMemberNo, randomSevenDigits } from '../identity/member-number';

// ---- Personal profile (S-ID-08, original checklist 02.01-02.10) ----

const COUNTRIES: readonly (readonly [string, string])[] = [
  ['TW', '台灣'], ['HK', '香港'], ['MO', '澳門'], ['CN', '中國大陸'], ['JP', '日本'], ['KR', '韓國'], ['SG', '新加坡'], ['MY', '馬來西亞'],
  ['TH', '泰國'], ['VN', '越南'], ['PH', '菲律賓'], ['ID', '印尼'], ['US', '美國'], ['CA', '加拿大'], ['GB', '英國'], ['AU', '澳洲'],
  ['NZ', '紐西蘭'], ['DE', '德國'], ['FR', '法國'],
];
export const countryName = (code: string | null) => (code ? (COUNTRIES.find(([c]) => c === code)?.[1] ?? code) : null);

interface FieldSpec {
  field: EditableField;
  label: string;
  /** The visibility switch shown on this row (the location switch sits on the country row). */
  eye: VisibilityField | null;
  input: 'text' | 'email' | 'tel' | 'date' | 'country' | 'locale' | 'textarea' | 'url';
  max?: number;
  hint?: string;
  /** Shown instead of the visibility switch: the field is always public. */
  alwaysPublic?: boolean;
}

const PROFILE_FIELDS: readonly FieldSpec[] = [
  { field: 'nickname', label: '暱稱', eye: null, input: 'text', max: 30, alwaysPublic: true, hint: '一律公開（排行榜等功能會顯示暱稱與頭像），最多 30 字。' },
  { field: 'display_name', label: '姓名', eye: 'display_name', input: 'text', max: 50, hint: '你的姓名，1～50 字，可以選擇不公開。' },
  { field: 'contact_email', label: '主要聯絡 Email', eye: 'contact_email', input: 'email', hint: '變更後會寄確認信；確認前，系統通知仍寄到登入用的信箱。' },
  { field: 'phone', label: '手機（選填）', eye: 'phone', input: 'tel', hint: '可輸入 0912345678，會依國家自動加上國碼。預設不公開。' },
  { field: 'country', label: '國家／地區', eye: 'location', input: 'country', hint: '這裡的公開設定同時套用到省／州／縣市與城市。' },
  { field: 'region', label: '省／州／縣市', eye: null, input: 'text', max: 60 },
  { field: 'city', label: '城市／鄉鎮區', eye: null, input: 'text', max: 60 },
  { field: 'birthday', label: '生日', eye: 'birthday', input: 'date', hint: '公開時只顯示月日；未滿 18 歲不會公開。' },
  { field: 'motto', label: '座右銘', eye: 'motto', input: 'textarea', max: 200 },
  { field: 'bio', label: '自我介紹', eye: 'bio', input: 'textarea', max: 500, hint: '最多 500 字。' },
  { field: 'occupation', label: '職業', eye: 'occupation', input: 'text', max: 60, hint: '例如：軟體工程師、護理師、學生。這裡的公開設定同時套用到服務單位。' },
  { field: 'organization', label: '服務單位', eye: null, input: 'text', max: 80, hint: '公司、機構或學校名稱。' },
  { field: 'website', label: '個人網站', eye: 'website', input: 'url', max: 200, hint: '必須以 https:// 開頭。' },
  { field: 'languages', label: '使用語言', eye: 'languages', input: 'text', max: 100, hint: '例如：中文、English、日本語。' },
  { field: 'interests', label: '興趣', eye: 'interests', input: 'textarea', max: 200, hint: '用逗號或換行分隔，最多 200 字。' },
  { field: 'skills', label: '專長', eye: 'skills', input: 'textarea', max: 200, hint: '用逗號或換行分隔，最多 200 字。' },
  { field: 'university', label: '大學校名', eye: 'education', input: 'text', max: 80, hint: '這裡的公開設定同時套用到大學科系、研究所校名與科系。' },
  { field: 'university_dept', label: '大學科系', eye: null, input: 'text', max: 60 },
  { field: 'grad_school', label: '大學研究所校名', eye: null, input: 'text', max: 80 },
  { field: 'grad_dept', label: '大學研究所科系', eye: null, input: 'text', max: 60 },
  { field: 'locale', label: '語系', eye: null, input: 'locale' },
];

const SOURCE_LABELS: Record<string, string> = { member: '本人', staff: '客服人員' };
const NUMBER_COLORS = ['', '#e5484d', '#f76b15', '#e2a336', '#30a46c', '#0090ff', '#3e63dd', '#8e4ec6', '#d6409f', '#ad7f58'];

function displayValue(p: ProfileRow, field: EditableField): string {
  switch (field) {
    case 'country':
      return countryName(p.country) ?? '';
    case 'locale':
      return LOCALES[p.locale] ?? p.locale;
    case 'contact_email':
      return p.contact_email ? `${p.contact_email}（${p.contact_email_verified_at ? '已確認' : '待確認'}）` : '';
    default:
      return p[field] ?? '';
  }
}

function fieldInput(spec: FieldSpec, p: ProfileRow): Html {
  const value = spec.field === 'locale' ? p.locale : (p[spec.field] ?? '');
  const id = `f-${spec.field}`;
  switch (spec.input) {
    case 'country':
      return html`<select id="${id}" name="value"><option value="">（未設定）</option>${COUNTRIES.map(([code, name]) => html`<option value="${code}"${code === p.country ? raw(' selected') : ''}>${name}</option>`)}</select>`;
    case 'locale':
      return html`<select id="${id}" name="value">${Object.entries(LOCALES).map(([v, label]) => html`<option value="${v}"${v === p.locale ? raw(' selected') : ''}>${label}</option>`)}</select>`;
    case 'textarea':
      return html`<textarea id="${id}" name="value" rows="3" maxlength="${spec.max ?? 200}">${value}</textarea>`;
    default:
      return html`<input id="${id}" name="value" type="${spec.input}" value="${value}"${spec.max ? raw(` maxlength="${spec.max}"`) : ''}${spec.input === 'tel' ? raw(' inputmode="tel" autocomplete="tel"') : ''}>`;
  }
}

function eyeForm(group: VisibilityField, visibility: Record<VisibilityField, Visibility>, version: number, locked: boolean): Html {
  const isPublic = visibility[group] === 'public';
  if (locked) return html`<span class="muted">🔒 不公開</span>`;
  return html`<form class="inline eye" method="post" action="/account/profile"><input type="hidden" name="version" value="${version}"><input type="hidden" name="field" value="visibility.${group}"><input type="hidden" name="value" value="${isPublic ? 'private' : 'public'}"><button class="secondary" type="submit" title="${isPublic ? '目前公開，按一下改為不公開' : '目前不公開，按一下改為公開'}">${isPublic ? '👁 公開' : '🙈 不公開'}</button></form>`;
}

function updatedLine(updates: Record<string, FieldUpdate>, field: string): Html {
  const u = updates[field];
  return u ? html`<p class="muted updated"></p>` : html`<p class="muted updated"></p>`;
}

function derivedCard(p: ProfileRow, visibility: Record<VisibilityField, Visibility>, version: number, minor: boolean): Html {
  const d = derivedOf(p.birthday);
  if (!d) return html`<div class="card"></div>`;
  const counts = new Map(d.grid.map((g) => [g.number, g.count]));
  return html`<div class="card">
<p style="display:flex;justify-content:space-between;gap:8px;align-items:center"><strong>由生日推算</strong>${eyeForm('derived', visibility, version, minor)}</p>
<p>星座：<strong>${d.zodiac_name}</strong><br>天賦數：<strong>${d.talent_numbers.length > 0 ? d.talent_numbers.join('、') : '—'}</strong><br>生命靈數：<strong>${d.life_path_number}</strong></p>
<table class="grid9" aria-label="彩色九宮格">${GRID_LAYOUT.map(
    (row) => html`<tr>${row.map((n) => {
      const count = counts.get(n) ?? 0;
      return html`<td style="${count > 0 ? `background:${NUMBER_COLORS[n]};color:#fff` : ''}"><strong>${n}</strong>${count > 1 ? html`<sup>×${count}</sup>` : ''}</td>`;
    })}</tr>`,
  )}</table>

</div>`;
}

function profilePage(c: WebContext, loaded: { row: ProfileRow; fieldUpdates: Record<string, FieldUpdate> }, memberNo: string | null, message?: { text: string; danger: boolean }): Html {
  const p = loaded.row;
  const countries = countryOptions().map((x) => `${x.iso}:${x.callingCode}`).join(',');
  const now = Date.now();
  const visibility = effectiveVisibility(p, now);
  const minor = p.birthday !== null && ageOn(p.birthday, now) < 18;
  const nonce = c.get('cspNonce');
  const rows = PROFILE_FIELDS.map((spec) => {
    const locked = minor && spec.eye === 'birthday';
    return html`<div class="card field" data-field="${spec.field}">
<div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><strong>${spec.label}</strong><span>${spec.alwaysPublic ? html`<span class="muted">🌐 一律公開</span>` : spec.eye ? eyeForm(spec.eye, visibility, p.version, locked) : ''}<button class="secondary pencil" type="button" aria-label="編輯${spec.label}" hidden>✏️ 編輯</button></span></div>
<p class="value">${displayValue(p, spec.field) || html`<span class="muted">（未設定）</span>`}</p>
<form class="field-form" method="post" action="/account/profile">
<input type="hidden" name="version" value="${p.version}"><input type="hidden" name="field" value="${spec.field}">
<label for="f-${spec.field}" class="muted" style="font-weight:400">${spec.hint ?? `修改${spec.label}`}</label>
${fieldInput(spec, p)}
${spec.field === 'motto' ? html`<button class="secondary suggest" type="button" hidden>🎲 隨機提案</button>` : ''}
<button type="submit">儲存</button><span class="status muted" role="status" aria-live="polite"></span>
</form>
${spec.field === 'contact_email' && p.contact_email && !p.contact_email_verified_at
  ? html`<form method="post" action="/account/contact-email/verify"><button class="secondary" type="submit">重寄確認信</button></form>`
  : ''}
${updatedLine(loaded.fieldUpdates, spec.field)}
</div>`;
  });
  return page(
    c,
    '個人資料',
    html`<h1>個人資料</h1>
${message ? html`<div class="banner ${message.danger ? 'danger' : ''}">${message.text}</div>` : ''}

<style>.js .field-form{display:none}.js .field.editing .field-form{display:block}.js .field.editing .value{display:none}.grid9{width:auto;margin:8px 0}.grid9 td{width:56px;height:56px;text-align:center;border:1px solid var(--line);font-size:1.2rem}.eye button,.pencil{margin:0 0 0 8px;padding:4px 10px}</style>
<div class="card" id="avatar-card"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><strong>頭像</strong></div>
<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-top:8px">
${p.avatar_key ? html`<img id="avatar-now" src="/account/avatar-image?v=${p.version}" alt="目前的頭像" width="96" height="96" style="border-radius:50%;object-fit:cover">` : avatarBubble({ initials: initialsOf(p.display_name ?? p.nickname), photo: null, size: 96, label: p.display_name ?? '' })}
<div><label for="avatar-file" class="button secondary" style="background:transparent;color:var(--accent);margin:0">上傳並裁切頭像</label><input id="avatar-file" type="file" accept="image/png,image/jpeg,image/webp" hidden>
<button type="button" class="secondary" id="avatar-google">使用我的 Google 頭像</button>${p.avatar_key ? html`<button type="button" class="secondary" id="avatar-remove">移除頭像</button>` : ''}
<p id="avatar-status" role="status" aria-live="polite"></p></div></div>
<div id="avatar-crop" hidden style="margin-top:12px"><canvas id="avatar-canvas" width="256" height="256" style="width:256px;height:256px;max-width:100%;border-radius:12px;border:1px solid var(--line);touch-action:none;cursor:grab"></canvas>
<label for="avatar-zoom" style="font-weight:400">縮放</label><input id="avatar-zoom" type="range" min="1" max="4" step="0.01" value="1" style="width:256px;max-width:100%">
<div><button type="button" id="avatar-save">儲存頭像</button><button type="button" class="secondary" id="avatar-cancel">取消</button></div></div>
</div>
${memberNo ? html`<div class="card" id="mn-card" data-countries="${countries}" data-no="${memberNo}"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><strong>會員編號</strong><button type="button" class="secondary pencil" id="mn-edit">修改</button></div>
<p class="value" id="mn-now" style="font-size:1.4em;letter-spacing:.06em">${memberNo}</p>
<form id="mn-form" hidden>
<label for="mn-filter" style="font-weight:400">國家／地區（輸入國碼或國名可快速篩選，例如 886）</label>
<input id="mn-filter" type="search" autocomplete="off" placeholder="輸入國碼，例如 886">
<select id="mn-iso" size="6" aria-label="國家／地區"></select>
<label for="mn-digits" style="font-weight:400">7 位數字</label>
<input id="mn-digits" inputmode="numeric" autocomplete="off" maxlength="7" pattern="[0-9]{7}" value="${memberNo.slice(2)}">
<p style="margin:8px 0"><strong id="mn-preview">${memberNo}</strong> <span id="mn-state" class="muted" role="status" aria-live="polite"></span></p>
<button type="submit" id="mn-save">儲存</button><button type="button" class="secondary" id="mn-random">🎲 隨機數字</button><button type="button" class="secondary" id="mn-cancel">取消</button>
</form></div>` : ''}
${rows}
<h2>生日資訊</h2>
${derivedCard(p, visibility, p.version, minor)}
<p><a href="/account">回到帳號中心</a></p>`,
    {
      scripts: html`<script nonce="${nonce}">
document.documentElement.classList.add('js');

(function () {
  var card = document.getElementById('mn-card');
  if (!card) return;
  var form = document.getElementById('mn-form'), edit = document.getElementById('mn-edit'), filter = document.getElementById('mn-filter');
  var sel = document.getElementById('mn-iso'), digits = document.getElementById('mn-digits'), preview = document.getElementById('mn-preview');
  var state = document.getElementById('mn-state'), save = document.getElementById('mn-save');
  var current = card.getAttribute('data-no') || '';
  var list = (card.getAttribute('data-countries') || '').split(',').map(function (x) { var p = x.split(':'); return { iso: p[0], code: p[1] }; });
  var names = null;
  try { names = new Intl.DisplayNames(['zh-TW'], { type: 'region' }); } catch (e) { names = null; }
  list.forEach(function (x) { x.name = names ? (names.of(x.iso) || x.iso) : x.iso; });
  var timer = 0, seq = 0;
  function number() { return (sel.value || '') + digits.value.replace(/[^0-9]/g, ''); }
  function fill(keep) {
    var q = filter.value.trim().toLowerCase().replace(/^\\+/, '');
    var shown = list.filter(function (x) { return !q || x.code.indexOf(q) === 0 || x.iso.toLowerCase().indexOf(q) === 0 || x.name.toLowerCase().indexOf(q) >= 0; });
    sel.innerHTML = '';
    shown.forEach(function (x) {
      var o = document.createElement('option');
      o.value = x.iso; o.textContent = x.iso + ' · ' + x.name + ' · +' + x.code;
      if (x.iso === keep) o.selected = true;
      sel.appendChild(o);
    });
    if (!sel.value && sel.options.length) sel.selectedIndex = 0;
    refresh();
  }
  function refresh() {
    preview.textContent = number();
    window.clearTimeout(timer);
    var no = number();
    if (!/^[A-Z]{2}[0-9]{7}$/.test(no)) { state.textContent = '請輸入 7 位數字'; save.disabled = true; return; }
    if (no === current) { state.textContent = '目前使用中'; save.disabled = true; return; }
    state.textContent = '檢查中…'; save.disabled = true;
    var mine = ++seq;
    timer = window.setTimeout(function () {
      fetch('/account/member-no/check?no=' + encodeURIComponent(no), { headers: { accept: 'application/json' } }).then(function (r) { return r.json(); }).then(function (b) {
        if (mine !== seq) return;
        state.textContent = b.message || '';
        save.disabled = !b.available;
      }).catch(function () { if (mine === seq) state.textContent = '暫時無法檢查'; });
    }, 300);
  }
  edit.addEventListener('click', function () {
    form.hidden = !form.hidden;
    if (!form.hidden) { filter.value = ''; digits.value = current.slice(2); fill(current.slice(0, 2)); }
  });
  document.getElementById('mn-cancel').addEventListener('click', function () { form.hidden = true; });
  filter.addEventListener('input', function () { fill(sel.value); });
  sel.addEventListener('change', refresh);
  digits.addEventListener('input', function () { digits.value = digits.value.replace(/[^0-9]/g, '').slice(0, 7); refresh(); });
  document.getElementById('mn-random').addEventListener('click', function () {
    fetch('/account/member-no/random?iso=' + encodeURIComponent(sel.value || ''), { headers: { accept: 'application/json' } }).then(function (r) { return r.json(); }).then(function (b) {
      if (b.digits) { digits.value = b.digits; refresh(); }
    });
  });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    save.disabled = true; state.textContent = '儲存中…';
    fetch('/account/member-no', { method: 'POST', headers: { accept: 'application/json' }, body: new URLSearchParams({ no: number() }) }).then(function (r) { return r.json(); }).then(function (b) {
      if (b.ok) { location.reload(); return; }
      state.textContent = b.message || '儲存失敗';
    }).catch(function () { state.textContent = '儲存失敗，請再試一次'; });
  });
})();

(function () {
  var fileInput = document.getElementById('avatar-file');
  var crop = document.getElementById('avatar-crop');
  var canvas = document.getElementById('avatar-canvas');
  var zoom = document.getElementById('avatar-zoom');
  var status = document.getElementById('avatar-status');
  var ctx = canvas.getContext('2d');
  var img = null, scale = 1, minScale = 1, ox = 0, oy = 0, dragging = null;
  function say(text) { status.textContent = text; }
  function clamp() {
    var w = img.width * scale, h = img.height * scale;
    ox = Math.min(0, Math.max(256 - w, ox)); oy = Math.min(0, Math.max(256 - h, oy));
  }
  function draw() { ctx.clearRect(0, 0, 256, 256); ctx.drawImage(img, ox, oy, img.width * scale, img.height * scale); }
  fileInput.addEventListener('change', function () {
    var file = fileInput.files && fileInput.files[0];
    if (!file) return;
    if (!/^image\\/(png|jpeg|webp)$/.test(file.type)) { say('請選擇 PNG、JPEG 或 WebP 圖片。'); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var image = new Image();
      image.onload = function () {
        img = image;
        minScale = 256 / Math.min(image.width, image.height);
        scale = minScale; zoom.value = '1';
        ox = (256 - image.width * scale) / 2; oy = (256 - image.height * scale) / 2;
        crop.hidden = false; draw(); say('拖曳與縮放調整範圍，然後按「儲存頭像」。');
      };
      image.onerror = function () { say('無法讀取這張圖片。'); };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
  zoom.addEventListener('input', function () {
    if (!img) return;
    var cx = (128 - ox) / scale, cy = (128 - oy) / scale;
    scale = minScale * Number(zoom.value);
    ox = 128 - cx * scale; oy = 128 - cy * scale; clamp(); draw();
  });
  function pos(e) { var r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * 256 / r.width, y: (e.clientY - r.top) * 256 / r.height }; }
  canvas.addEventListener('pointerdown', function (e) { if (!img) return; dragging = pos(e); canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; });
  canvas.addEventListener('pointermove', function (e) { if (!dragging) return; var p = pos(e); ox += p.x - dragging.x; oy += p.y - dragging.y; dragging = p; clamp(); draw(); });
  function stop() { dragging = null; canvas.style.cursor = 'grab'; }
  canvas.addEventListener('pointerup', stop); canvas.addEventListener('pointercancel', stop);
  document.getElementById('avatar-cancel').addEventListener('click', function () { crop.hidden = true; img = null; fileInput.value = ''; say('已取消。'); });
  async function send(url, init, okText) {
    say('處理中…');
    var res = await fetch(url, init).catch(function () { return null; });
    var body = res ? await res.json().catch(function () { return {}; }) : {};
    if (res && res.ok && body.ok) { say(okText); location.reload(); return; }
    say(body.message || '操作失敗，請再試一次。');
  }
  document.getElementById('avatar-save').addEventListener('click', function () {
    if (!img) return;
    var quality = 0.9;
    var attempt = function () {
      canvas.toBlob(function (blob) {
        if (!blob) { say('無法產生圖片。'); return; }
        if (blob.size > 250 * 1024 && quality > 0.4) { quality -= 0.15; attempt(); return; }
        send('/account/avatar', { method: 'POST', headers: { 'content-type': 'image/jpeg', accept: 'application/json' }, body: blob }, '頭像已更新。');
      }, 'image/jpeg', quality);
    };
    attempt();
  });
  document.getElementById('avatar-google').addEventListener('click', function () { send('/account/avatar/google', { method: 'POST', headers: { accept: 'application/json' } }, '已改用 Google 頭像。'); });
  var removeButton = document.getElementById('avatar-remove');
  if (removeButton) removeButton.addEventListener('click', function () { if (confirm('確定要移除頭像嗎？')) send('/account/avatar/remove', { method: 'POST', headers: { accept: 'application/json' } }, '頭像已移除。'); });
})();
const STATUS = { saving: '儲存中…', saved: '已儲存', conflict: '資料已在其他地方更新，請重新整理頁面。', failed: '儲存失敗，請再試一次。' };
let version = ${p.version};
function setVersion(v) { version = v; document.querySelectorAll('input[name=version]').forEach((i) => { i.value = String(v); }); }
async function save(form) {
  const status = form.querySelector('.status');
  const field = form.closest('.field');
  status.textContent = STATUS.saving;
  form.querySelector('input[name=version]').value = String(version);
  const res = await fetch('/account/profile', { method: 'POST', headers: { accept: 'application/json' }, body: new URLSearchParams(new FormData(form)) }).catch(() => null);
  const body = res ? await res.json().catch(() => ({})) : {};
  if (res && res.ok && body.ok) {
    setVersion(body.version);
    field.querySelector('.value').textContent = body.display || '（未設定）';
    if (body.updated) field.querySelector('.updated').textContent = body.updated;
    status.textContent = STATUS.saved;
    field.classList.remove('editing');
    if (body.reload) location.reload();
    return;
  }
  status.textContent = res && res.status === 409 ? STATUS.conflict : (body.message || STATUS.failed);
}
document.querySelectorAll('.field[data-field]').forEach((field) => {
  const form = field.querySelector('.field-form');
  const pencil = field.querySelector('.pencil');
  const input = form.querySelector('[name=value]');
  let initial = input.value;
  pencil.hidden = false;
  pencil.addEventListener('click', () => { field.classList.add('editing'); input.focus(); });
  form.addEventListener('submit', (e) => { e.preventDefault(); initial = input.value; save(form); });
  const autosave = () => { if (input.value !== initial) { initial = input.value; save(form); } };
  input.addEventListener(input.tagName === 'SELECT' || input.type === 'date' ? 'change' : 'blur', autosave);
  const suggest = form.querySelector('.suggest');
  if (suggest) {
    suggest.hidden = false;
    suggest.addEventListener('click', async () => {
      const res = await fetch('/account/motto-suggestion?current=' + encodeURIComponent(input.value)).catch(() => null);
      const body = res && res.ok ? await res.json() : null;
      if (body && body.motto) { input.value = body.motto; form.querySelector('.status').textContent = '這是提案，按「儲存」才會更新。'; }
    });
  }
});
</script>`,
    },
  );
}

function updatedText(updates: Record<string, FieldUpdate>, field: string): string {
  const u = updates[field];
  return u ? `最後修改：${formatTime(u.updated_at)}（${SOURCE_LABELS[u.source] ?? u.source}）` : '';
}

accountApp.get('/profile', async (c) => {
  const web = c.get('web');
  if (!web) return c.redirect('/account?next=/account/profile', 303);
  if (web.status !== 'active') return c.redirect('/account', 303);
  const loaded = await loadProfile(c.env.DB_IDENTITY, web.userId);
  if (!loaded) return c.redirect('/account', 303);
  const notice = PROFILE_NOTICES[c.req.query('notice') ?? ''];
  return c.html(profilePage(c, loaded, await memberNoOf(c.env.DB_IDENTITY, web.userId), notice));
});

const PROFILE_NOTICES: Record<string, { text: string; danger: boolean }> = {
  verification_sent: { text: '已寄出確認信，請到信箱點連結完成確認（24 小時內有效）。', danger: false },
  verification_unavailable: { text: '目前無法寄出確認信，請稍後再試。', danger: true },
  verified: { text: '聯絡信箱已確認，之後的系統通知會寄到這裡。', danger: false },
};

/**
 * POST /account/profile — one field per request from the profile page (field + value, or
 * visibility.<group>), or several fields from a plain form. JSON when the page's script asks.
 */
accountApp.post('/profile', async (c) => {
  const web = c.get('web');
  const wantsJson = (c.req.header('accept') ?? '').includes('application/json');
  if (!web || web.status !== 'active') return wantsJson ? c.json({ ok: false, message: '請重新登入。' }, 401) : c.redirect('/account', 303);
  const form = await readForm(c);
  const db = c.env.DB_IDENTITY;
  const before = await loadProfile(db, web.userId);
  if (!before) return c.redirect('/account', 303);
  const now = Date.now();
  const version = Number(form.version);
  let input: Record<string, unknown> = {};
  if (form.field?.startsWith('visibility.')) input = { visibility: { [form.field.slice('visibility.'.length)]: form.value } };
  else if (form.field) input = (EDITABLE_FIELDS as readonly string[]).includes(form.field) ? { [form.field]: form.value ?? '' } : { visibility: null };
  else for (const field of EDITABLE_FIELDS) if (field in form) input[field] = field === 'display_name' && form[field] === '' ? null : form[field];
  const validated = validateProfileInput(input, now, before.row.country);
  const respond = async (status: 200 | 400 | 409, message: { text: string; danger: boolean }) => {
    const current = (await loadProfile(db, web.userId)) ?? before;
    if (wantsJson) {
      const field = (form.field ?? '') as EditableField;
      const ok = status === 200;
      return c.json(
        {
          ok,
          message: ok ? undefined : message.text,
          version: current.row.version,
          display: (EDITABLE_FIELDS as readonly string[]).includes(field) ? displayValue(current.row, field) : undefined,
          updated: updatedText(current.fieldUpdates, field),
          reload: field === 'birthday' || field === 'contact_email' || (form.field ?? '').startsWith('visibility.'),
        },
        status,
      );
    }
    return c.html(profilePage(c, current, await memberNoOf(db, web.userId), message), status);
  };
  if (!validated.ok) return respond(400, { text: `資料格式不正確：${validated.message}。`, danger: true });
  if (!Number.isInteger(version) || !hasChanges(validated.changes)) return respond(400, { text: '沒有要儲存的變更。', danger: true });
  const saved = await saveProfile(db, { userId: web.userId, expectedVersion: version, changes: validated.changes, source: 'member', actorUserId: web.userId, appId: WEB_APP_ID, requestId: c.get('requestId') }, now);
  if (!saved.written) return respond(409, { text: '個人資料已在其他地方更新，以下是最新內容，請確認後再儲存。', danger: true });
  if (saved.newContactEmail) {
    const pending = background(c, sendContactEmailVerification(c.env.DATA_ENCRYPTION_KEY, mailSettings(c.env, new URL(c.req.url).origin), web.userId, saved.newContactEmail, now));
    if (pending) await pending;
  }
  return respond(200, { text: saved.newContactEmail ? '已儲存，並寄出聯絡信箱的確認信。' : '已儲存。', danger: false });
});

/** GET /account/avatar-image — the signed-in member's own avatar for the account page. */
accountApp.get('/avatar-image', async (c) => {
  const web = c.get('web');
  if (!web || web.status !== 'active' || !c.env.AVATARS) return c.body(null, 404);
  const row = await c.env.DB_IDENTITY.prepare('SELECT avatar_key FROM profiles WHERE user_id = ?').bind(web.userId).first<{ avatar_key: string | null }>();
  const object = row?.avatar_key ? await c.env.AVATARS.get(row.avatar_key) : null;
  if (!object) return c.body(null, 404);
  return new Response(object.body, { headers: { 'content-type': object.httpMetadata?.contentType ?? 'image/jpeg', 'cache-control': 'private, max-age=300' } });
});

async function memberNoOf(db: D1Database, userId: string): Promise<string | null> {
  return (await db.prepare('SELECT member_no FROM users WHERE user_id = ?').bind(userId).first<{ member_no: string | null }>())?.member_no ?? null;
}

const MEMBER_NO_MESSAGES: Record<string, string> = {
  invalid: '編號格式不正確：需要 2 個英文字母的國家代碼加 7 位數字。',
  taken: '這個編號已經有人使用，請換一個。',
  rate_limited: `24 小時內最多修改 ${MEMBER_NO_CHANGES_PER_DAY} 次，請稍後再試。`,
  not_found: '找不到會員，請重新登入。',
};

/** GET /account/member-no/check?no= — is this number free for me? (live hint while typing) */
accountApp.get('/member-no/check', async (c) => {
  const web = c.get('web');
  if (!web || web.status !== 'active') return c.json({ available: false, message: '請重新登入。' }, 401);
  const no = normalizeMemberNo(c.req.query('no') ?? '');
  if (!no) return c.json({ available: false, message: MEMBER_NO_MESSAGES.invalid });
  const free = await isMemberNoFree(c.env.DB_IDENTITY, no, web.userId);
  return c.json({ available: free, message: free ? '✅ 可以使用' : MEMBER_NO_MESSAGES.taken });
});

/** GET /account/member-no/random?iso= — seven random digits that are free under that country. */
accountApp.get('/member-no/random', async (c) => {
  const web = c.get('web');
  if (!web || web.status !== 'active') return c.json({ ok: false }, 401);
  const iso = (c.req.query('iso') ?? '').toUpperCase();
  for (let attempt = 0; attempt < 6; attempt++) {
    const digits = randomSevenDigits();
    const no = normalizeMemberNo(`${iso}${digits}`);
    if (no && (await isMemberNoFree(c.env.DB_IDENTITY, no, web.userId))) return c.json({ ok: true, digits });
  }
  return c.json({ ok: false }, 404);
});

/** POST /account/member-no — the member picks country and digits. The share link follows the number. */
accountApp.post('/member-no', async (c) => {
  const web = c.get('web');
  if (!web || web.status !== 'active') return c.json({ ok: false, message: '請重新登入。' }, 401);
  const form = await readForm(c);
  const result = await changeMemberNo(c.env.DB_IDENTITY, { userId: web.userId, requested: form.no ?? '', requestId: c.get('requestId'), appId: WEB_APP_ID }, Date.now());
  if (!result.ok) return c.json({ ok: false, message: MEMBER_NO_MESSAGES[result.reason] ?? '儲存失敗。' }, result.reason === 'rate_limited' ? 429 : result.reason === 'taken' ? 409 : 400);
  return c.json({ ok: true, member_no: result.memberNo });
});

/** POST /account/avatar — the page crops to a square and sends the image bytes. */
accountApp.post('/avatar', async (c) => {
  const web = c.get('web');
  if (!web || web.status !== 'active') return c.json({ ok: false, message: '請重新登入。' }, 401);
  if (!c.env.AVATARS) return c.json({ ok: false, message: '頭像儲存尚未設定。' }, 503);
  if (Number(c.req.header('content-length') ?? '0') > MAX_AVATAR_BYTES) return c.json({ ok: false, message: '圖片太大，請換一張或縮小範圍。' }, 413);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const result = await setAvatar(c.env.DB_IDENTITY, r2Store(c.env.AVATARS), { userId: web.userId, bytes, appId: WEB_APP_ID, requestId: c.get('requestId') }, Date.now());
  if (!result.ok) return c.json({ ok: false, message: result.reason === 'too_large' ? '圖片太大，請換一張或縮小範圍。' : '只接受 PNG、JPEG 或 WebP 圖片。' }, result.reason === 'too_large' ? 413 : 415);
  return c.json({ ok: true });
});

/** POST /account/avatar/google — replaces the avatar with the member's Google photo. */
accountApp.post('/avatar/google', async (c) => {
  const web = c.get('web');
  if (!web || web.status !== 'active') return c.json({ ok: false, message: '請重新登入。' }, 401);
  if (!c.env.AVATARS) return c.json({ ok: false, message: '頭像儲存尚未設定。' }, 503);
  const url = await googlePhotoOf(c.env.DB_IDENTITY, web.userId);
  if (!url) return c.json({ ok: false, message: '找不到 Google 頭像。請先綁定 Google 帳號，並重新用 Google 登入一次。' }, 404);
  const done = await importProviderAvatar(c.env.DB_IDENTITY, r2Store(c.env.AVATARS), (u, init) => fetch(u, init), { userId: web.userId, url, appId: WEB_APP_ID, requestId: c.get('requestId'), replace: true }, Date.now());
  return done ? c.json({ ok: true }) : c.json({ ok: false, message: '無法取得 Google 頭像，請稍後再試。' }, 502);
});

/** POST /account/avatar/remove */
accountApp.post('/avatar/remove', async (c) => {
  const web = c.get('web');
  if (!web || web.status !== 'active') return c.json({ ok: false, message: '請重新登入。' }, 401);
  if (c.env.AVATARS) await removeAvatar(c.env.DB_IDENTITY, r2Store(c.env.AVATARS), { userId: web.userId, appId: WEB_APP_ID, requestId: c.get('requestId') }, Date.now());
  return c.json({ ok: true });
});

/** POST /account/contact-email/verify — sends the confirmation link again. */
accountApp.post('/contact-email/verify', async (c) => {
  const web = c.get('web');
  if (!web || web.status !== 'active') return c.redirect('/account', 303);
  const loaded = await loadProfile(c.env.DB_IDENTITY, web.userId);
  const email = loaded?.row.contact_email;
  if (!email || loaded.row.contact_email_verified_at !== null) return c.redirect('/account/profile', 303);
  const result = await sendContactEmailVerification(c.env.DATA_ENCRYPTION_KEY, mailSettings(c.env, new URL(c.req.url).origin), web.userId, email, Date.now());
  return c.redirect(`/account/profile?notice=${result === 'sent' ? 'verification_sent' : 'verification_unavailable'}`, 303);
});

/** GET /account/verify-email?t= — the link from the confirmation email; works without signing in. */
accountApp.get('/verify-email', async (c) => {
  const result = await confirmContactEmail(c.env.DB_IDENTITY, c.env.DATA_ENCRYPTION_KEY, c.req.query('t') ?? '', Date.now());
  const text: Record<ConfirmResult, string> = {
    verified: '聯絡信箱已確認，之後的系統通知會寄到這裡。',
    expired: '確認連結已過期，請到帳號中心的個人資料頁重寄確認信。',
    changed: '這個信箱已不是您目前的聯絡信箱，或連結已失效。',
    invalid: '確認連結無效。',
  };
  return c.html(page(c, '確認聯絡信箱', html`<h1>確認聯絡信箱</h1><div class="banner${result === 'verified' ? '' : ' danger'}">${text[result]}</div><p><a href="/account/profile">前往個人資料</a></p>`), result === 'verified' ? 200 : 400);
});

/** GET /account/motto-suggestion — random motto for the profile page (02.05); nothing is saved. */
accountApp.get('/motto-suggestion', (c) => {
  const web = c.get('web');
  if (!web) return c.json({ error: 'sign in' }, 401);
  return c.json({ motto: randomMotto(c.req.query('current') ?? null) });
});
