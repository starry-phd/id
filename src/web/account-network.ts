import { html, raw } from 'hono/html';
import { MEMBER_NO, normalizeMemberNo } from '../identity/member-number';
import { bindReferrer, directCount, isAbove, memberByNo, orgNetwork, referrerOf, selfNode, wouldLoop, type OrgNode, type Referrer } from '../identity/referrals';
import { referrerChangeCostText } from '../lib/battery-icons';
import { avatarBubble, avatarPath } from './member-nav';
import { page, readForm, type Html, type WebContext } from './layout';
import { accountApp, publicPages } from './account-lib';
import { webContext } from './layout';
import { loadProfile, publicProfile } from '../identity/profile';

/** Invite link: /Invite/<member number>, e.g. https://id.starry.phd/Invite/TW9475831. The invite code is the member number. */
export const invitePath = (memberNo: string): string => `/Invite/${memberNo}`;

/** Pulls a member number out of whatever was typed or pasted: a full link, "Invite/TW9475831", "InviteTW9475831" or "TW9475831". */
export function parseInviteInput(text: string): string | null {
  const found = /([A-Za-z]{2})\s*(\d{7,10})(?!\d)/.exec(text);
  return found ? normalizeMemberNo(`${found[1]}${found[2]}`) : null;
}

function referrerCard(r: Pick<Referrer, 'name' | 'member_no' | 'initials' | 'has_avatar'>): Html {
  return html`<div class="hero">${avatarBubble({ initials: r.initials, photo: r.has_avatar ? avatarPath(r.member_no) : null, size: 72, label: r.name })}<div><strong style="font-size:1.2em">${r.name}</strong><br><span class="badge">${r.member_no}</span></div></div>`;
}

const COST_NOTE = (): Html => html`<p>綁定後如果要變更推薦人，需要消耗 ${referrerChangeCostText()}。</p>`;

async function ownMemberNo(c: WebContext, userId: string): Promise<string | null> {
  const row = await c.env.DB_IDENTITY.prepare('SELECT member_no FROM users WHERE user_id = ?').bind(userId).first<{ member_no: string | null }>();
  return row?.member_no ?? null;
}

/** GET /account/referral — 推薦達人: own invite code and link, share, who invited me. */
accountApp.get('/referral', async (c) => {
  const web = c.get('web');
  if (!web) return c.redirect('/account?next=/account/referral', 303);
  if (web.status !== 'active') return c.redirect('/account', 303);
  const db = c.env.DB_IDENTITY;
  const [memberNo, mine, direct] = await Promise.all([ownMemberNo(c, web.userId), referrerOf(db, web.userId), directCount(db, web.userId)]);
  const link = memberNo ? `${new URL(c.req.url).origin}${invitePath(memberNo)}` : null;
  const nonce = c.get('cspNonce');
  return c.html(
    page(
      c,
      '推薦達人',
      html`<h1>推薦達人</h1>
${link
  ? html`<div class="card">
  <label for="invite-link">我的專屬邀請連結</label>
  <input id="invite-link" value="${link}" readonly>
  <label for="invite-code">我的邀請碼</label>
  <input id="invite-code" value="${memberNo}" readonly>
  <div class="actions"><button id="share" type="button">分享邀請連結</button><button id="copy" type="button" class="secondary">複製連結</button></div>
  <p id="share-status" role="status" aria-live="polite"></p>
</div>`
  : html`<div class="banner">會員編號建立中，請稍後重新整理。</div>`}
<div class="statrow"><div class="statbox"><b>${direct}</b><span>直接邀請</span></div></div>
${c.req.query('e') ? html`<div class="banner danger">找不到這個邀請碼，請確認後再輸入。</div>` : ''}
${mine
  ? html`<div class="card"><strong>我的推薦人</strong>${referrerCard(mine)}${COST_NOTE()}</div>`
  : html`<div class="card"><form method="get" action="/account/referral/lookup"><label for="code">輸入別人的邀請碼或邀請連結</label><input id="code" name="code" autocomplete="off" required placeholder="例如 TW9475831"><button type="submit">查看推薦人</button></form></div>`}
<p><a class="button" href="/account/network">查看我的組織網</a></p>`,
      {
        scripts: html`<script nonce="${nonce}">
(function(){
  var link=document.getElementById('invite-link');if(!link)return;
  var status=document.getElementById('share-status');
  function say(t){status.textContent=t;}
  function copy(){var done=function(){say('已複製連結');};
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(link.value).then(done,function(){link.select();document.execCommand('copy');done();});}
    else{link.select();document.execCommand('copy');done();}}
  document.getElementById('copy').addEventListener('click',copy);
  document.getElementById('share').addEventListener('click',function(){
    if(navigator.share){navigator.share({title:'加入繁星',text:'我邀請你加入繁星',url:link.value}).catch(function(){});}
    else{copy();}
  });
})();
</script>`,
      },
    ),
  );
});

function levelLabel(i: number): string {
  return `第 ${i + 1} 層`;
}

/** One person in the chart: a round picture (photo, or the first letters of the name) with the name under it. Tapping the picture opens that member's public profile in a pop-up. */
function chartNode(n: { name: string; initials: string; has_avatar: boolean; member_no: string | null }, userId: string, me = false): Html {
  const bubble = avatarBubble({ initials: n.initials, photo: n.has_avatar && n.member_no ? avatarPath(n.member_no) : null, size: me ? 88 : 72, label: n.name });
  return html`<span class="pn${me ? ' me' : ''}"><button type="button" class="pbtn" data-id="${userId}" aria-label="查看 ${n.name} 的基本資料">${bubble}<span class="pname">${n.name}</span></button></span>`;
}

function renderTree(nodes: OrgNode[], parent: string): Html {
  const kids = nodes.filter((n) => n.parent_id === parent);
  if (kids.length === 0) return html``;
  return html`<ul>${kids.map((n) => html`<li>${chartNode(n, n.user_id)}${renderTree(nodes, n.user_id)}</li>`)}</ul>`;
}

const CHART_STYLE = `
.otree{--ln:3px solid #7b73d9;overflow-x:auto;padding:8px 0 16px;text-align:center}.otree .chart{display:inline-block;min-width:100%}
.otree ul{display:flex;justify-content:center;padding:22px 0 0;margin:0;list-style:none;position:relative}
.otree li{position:relative;padding:22px 6px 0;text-align:center;list-style:none}
.otree li::before,.otree li::after{content:'';position:absolute;top:0;right:50%;width:50%;height:22px;border-top:var(--ln)}
.otree li::after{right:auto;left:50%;border-left:var(--ln)}
.otree li:only-child::before,.otree li:only-child::after{display:none}.otree li:only-child{padding-top:0}
.otree li:first-child::before,.otree li:last-child::after{border:0}
.otree li:last-child::before{border-right:var(--ln);border-radius:0 8px 0 0}.otree li:first-child::after{border-radius:8px 0 0 0}
.otree ul ul::before{content:'';position:absolute;top:0;left:50%;margin-left:-1.5px;height:22px;border-left:var(--ln)}
.otree .root{padding:0;margin:0;display:block}.otree .root>li{padding-top:0}.otree .root>li::before,.otree .root>li::after{display:none}
.pn{display:inline-flex;flex-direction:column;align-items:center}
.pn .avatar{border-radius:50%;object-fit:cover;display:block}
.pbtn{all:unset;position:relative;display:inline-block;border-radius:50%;overflow:hidden;cursor:pointer;line-height:0}.pbtn:focus-visible{outline:2px solid var(--accent,#8b7cf6);outline-offset:2px}
.pn .pname{position:absolute;left:0;right:0;bottom:0;box-sizing:border-box;padding:12px 8px 6px;background:linear-gradient(rgba(5,5,25,0),rgba(5,5,25,.88) 55%);color:#fff;font-size:.7rem;font-weight:600;line-height:1.1;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pn.me .pname{font-size:.78rem;font-weight:800}
#pcard{position:fixed;inset:0;z-index:60;display:grid;place-items:center;padding:16px;background:rgba(5,5,25,.55)}#pcard[hidden]{display:none}
#pcard .box{position:relative;width:min(420px,100%);max-height:86vh;overflow:auto;padding:22px 18px 18px;border-radius:20px;background:#1d1d52;border:1px solid var(--line);box-shadow:0 12px 50px rgba(0,0,0,.6);text-align:left}
#pcard .x{position:absolute;top:8px;right:8px;margin:0;padding:4px 10px;font-size:1.1rem;line-height:1}
`;

/** GET /account/network — 組織網: everyone below me as a chart of round pictures, fully expanded, with counts. */
accountApp.get('/network', async (c) => {
  const web = c.get('web');
  if (!web) return c.redirect('/account?next=/account/network', 303);
  if (web.status !== 'active') return c.redirect('/account', 303);
  const [{ nodes, stats }, me] = await Promise.all([orgNetwork(c.env.DB_IDENTITY, web.userId), selfNode(c.env.DB_IDENTITY, web.userId)]);
  const top = nodes.filter((n) => n.depth === 1);
  const nonce = c.get('cspNonce');
  return c.html(
    page(
      c,
      '組織網',
      html`<h1>組織網</h1>
<style>${raw(CHART_STYLE)}</style>
<div class="statrow">
  <div class="statbox"><b>${stats.total}</b><span>總人數</span></div>
  <div class="statbox"><b>${stats.direct}</b><span>橫排（第 1 層）</span></div>
  <div class="statbox"><b>${stats.depth}</b><span>最深層數</span></div>
  <div class="statbox"><b>${stats.total - stats.direct}</b><span>往下共（第 2 層起）</span></div>
</div>
${stats.perLevel.length > 0 ? html`<div class="chips">${stats.perLevel.map((n, i) => html`<span class="badge">${levelLabel(i)} ${n} 人</span>`)}</div>` : ''}
${stats.truncated ? html`<div class="banner">人數很多，只顯示前 1500 位。</div>` : ''}
${top.length > 0 && me
  ? html`<div class="card otree"><div class="chart"><ul class="root"><li>${chartNode(me, web.userId, true)}${renderTree(nodes, web.userId)}</li></ul></div></div>`
  : html`<div class="card">還沒有人使用你的邀請。到「推薦達人」分享你的邀請連結。</div>`}
<p><a class="button" href="/account/referral">推薦達人</a></p>
<div id="pcard" hidden role="dialog" aria-modal="true" aria-label="會員基本資料"><div class="box"><button type="button" class="secondary x" aria-label="關閉">✕</button><div id="pcard-body"></div></div></div>`,
      {
        scripts: html`<script nonce="${nonce}">
(function(){
  var layer=document.getElementById('pcard'),body=document.getElementById('pcard-body'),seq=0;
  function close(){layer.hidden=true;body.textContent='';seq++;}
  document.addEventListener('click',function(e){
    if(!layer.hidden){if(!(e.target.closest&&e.target.closest('#pcard a'))){close();}return;}
    var btn=e.target.closest&&e.target.closest('.pbtn');if(!btn)return;
    var mine=++seq;body.textContent='載入中…';layer.hidden=false;
    fetch('/account/network/card/'+encodeURIComponent(btn.getAttribute('data-id')),{headers:{accept:'text/html'}}).then(function(r){return r.ok?r.text():null;}).then(function(t){
      if(mine!==seq)return;
      if(t===null){body.textContent='目前無法顯示這位會員的資料。';return;}
      body.innerHTML=t;
    }).catch(function(){if(mine===seq)body.textContent='目前無法顯示這位會員的資料。';});
  });
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!layer.hidden)close();});
})();
</script>`,
      },
    ),
  );
});

// ---------- public pages (no sign-in needed to look) ----------

const PUBLIC_NO = '[A-Z]{2}\\d{7,10}';

/** GET /a/<member number> — a member's public picture (the picture is always public). */
publicPages.get(`/a/:no{${PUBLIC_NO}}`, async (c) => {
  const no = c.req.param('no');
  if (!c.env.AVATARS || !MEMBER_NO.test(no)) return c.body(null, 404);
  const row = await c.env.DB_IDENTITY.prepare("SELECT p.avatar_key FROM users u JOIN profiles p ON p.user_id = u.user_id WHERE u.member_no = ? AND u.status = 'active'").bind(no).first<{ avatar_key: string | null }>();
  const object = row?.avatar_key ? await c.env.AVATARS.get(row.avatar_key) : null;
  if (!object) return c.body(null, 404);
  return new Response(object.body, { headers: { 'content-type': object.httpMetadata?.contentType ?? 'image/jpeg', 'cache-control': 'public, max-age=60' } });
});

/** What the public profile page shows for one member: null when there is no such active member. */
async function publicProfileView(c: WebContext, no: string, withNumber: boolean): Promise<{ name: string; content: Html } | null> {
  const db = c.env.DB_IDENTITY;
  const row = await db.prepare("SELECT user_id FROM users WHERE member_no = ? AND status = 'active'").bind(no).first<{ user_id: string }>();
  const loaded = row ? await loadProfile(db, row.user_id) : null;
  if (!row || !loaded) return null;
  const p = publicProfile(loaded.row, loaded.row.avatar_key ? avatarPath(no) : null, Date.now());
  const name = p.shown_name || (withNumber ? no : '星友');
  const fields: [string, string | null][] = [
    ['姓名', p.display_name],
    ['座右銘', p.motto],
    ['生日', p.birthday_month_day],
    ['星座', p.zodiac_name],
    ['地區', p.location ? [p.location.country, p.location.region, p.location.city].filter(Boolean).join(' ') : null],
    ['職業', p.occupation],
    ['單位', p.organization],
    ['個人網站', p.website],
    ['簡介', p.bio],
    ['語言', p.languages],
    ['興趣', p.interests],
    ['專長', p.skills],
    ['聯絡 Email', p.contact_email],
    ['手機', p.phone],
  ];
  const shown = fields.filter(([, v]) => v !== null && v !== '');
  const content = html`<div class="hero">${avatarBubble({ initials: p.initials, photo: p.avatar_url, size: 88, label: name })}<div><h1>${name}</h1>${withNumber ? html`<span class="badge">${no}</span>` : ''}</div></div>
${shown.length > 0 ? html`<div class="card">${shown.map(([k, v]) => html`<p><strong>${k}</strong> ${k === '個人網站' && v && /^https?:\/\//i.test(v) ? html`<a href="${v}" rel="nofollow noopener noreferrer">${v}</a>` : v}</p>`)}</div>` : ''}`;
  return { name, content };
}

/** GET /<member number> — the member's public profile; only what they chose to make public. */
publicPages.get(`/:no{${PUBLIC_NO}}`, webContext, async (c) => {
  const view = await publicProfileView(c, c.req.param('no'), true);
  if (!view) return c.html(page(c, '找不到會員', html`<h1>找不到這位會員</h1>`), 404);
  return c.html(page(c, view.name, view.content));
});

/** GET /account/network/card/<user id> — the same public profile as a fragment for the pop-up on the network page (no member number shown). Only for me and the members below me. */
accountApp.get('/network/card/:id{[0-9a-fA-F-]{36}}', async (c) => {
  const web = c.get('web');
  if (!web || web.status !== 'active') return c.body(null, 401);
  const id = c.req.param('id').toLowerCase();
  if (id !== web.userId && !(await isAbove(c.env.DB_IDENTITY, web.userId, id))) return c.body(null, 404);
  const row = await c.env.DB_IDENTITY.prepare('SELECT member_no FROM users WHERE user_id = ?').bind(id).first<{ member_no: string | null }>();
  const view = row?.member_no ? await publicProfileView(c, row.member_no, false) : null;
  if (!view) return c.body(null, 404);
  return c.html(view.content);
});

/** GET /account/referral/lookup?code= — a typed or pasted invite code or link opens the confirmation page. */
accountApp.get('/referral/lookup', async (c) => {
  const no = parseInviteInput(c.req.query('code') ?? '');
  return c.redirect(no ? invitePath(no) : '/account/referral?e=1', 303);
});

/** GET /Invite<member number> — the older link form, now sent to /Invite/<member number>. */
publicPages.get(`/:code{Invite${PUBLIC_NO}}`, (c) => c.redirect(invitePath(c.req.param('code').slice('Invite'.length)), 301));

const CONFIRM_BOX = (referrer: Referrer, no: string): Html => html`<div class="card">
${referrerCard(referrer)}
<p><strong>確定要綁定 ${referrer.name} 為你的推薦人嗎？</strong></p>
${COST_NOTE()}
<form method="post" action="/account/referral/bind"><input type="hidden" name="no" value="${no}"><button type="submit">確認綁定</button> <a class="button secondary" href="/account">取消</a></form>
</div>`;

/** GET /Invite/<member number> — shows who is inviting you; binding happens only after you confirm. */
publicPages.get(`/Invite/:no{${PUBLIC_NO}}`, webContext, async (c) => {
  const no = c.req.param('no');
  const db = c.env.DB_IDENTITY;
  const referrer = await memberByNo(db, no);
  if (!referrer) return c.html(page(c, '邀請連結', html`<h1>這個邀請連結無效</h1>`), 404);
  const web = c.get('web');
  if (!web || web.status !== 'active') {
    return c.html(
      page(c, '邀請你加入繁星', html`<h1>${referrer.name} 邀請你加入繁星</h1><div class="card">${referrerCard(referrer)}<a class="button" href="/account?next=/Invite/${no}">登入或註冊</a></div>`),
    );
  }
  const mine = await referrerOf(db, web.userId);
  let body: Html;
  if (referrer.user_id === web.userId) body = html`<div class="banner">這是你自己的邀請連結，分享給朋友吧。</div>`;
  else if (mine && mine.user_id === referrer.user_id) body = html`<div class="banner">你已經綁定這位推薦人。</div><div class="card">${referrerCard(mine)}</div>`;
  else if (mine) body = html`<div class="banner">你已經有推薦人。</div><div class="card"><strong>目前的推薦人</strong>${referrerCard(mine)}${COST_NOTE()}</div>`;
  else if (await wouldLoop(db, web.userId, referrer.user_id)) body = html`<div class="banner danger">無法綁定這位推薦人。</div>`;
  else body = CONFIRM_BOX(referrer, no);
  return c.html(page(c, '邀請你加入繁星', html`<h1>${referrer.name} 的邀請</h1>${body}<p><a class="button secondary" href="/account">進入帳號中心</a></p>`));
});

/** POST /account/referral/bind — the member confirmed: bind once. */
accountApp.post('/referral/bind', async (c) => {
  const web = c.get('web');
  if (!web || web.status !== 'active') return c.redirect('/account', 303);
  const form = await readForm(c);
  const no = normalizeMemberNo(form.no ?? '');
  const db = c.env.DB_IDENTITY;
  const referrer = no ? await memberByNo(db, no) : null;
  if (!referrer) return c.html(page(c, '邀請連結', html`<h1>這個邀請連結無效</h1>`), 404);
  const result = await bindReferrer(db, web.userId, referrer.user_id, c.get('requestId'), Date.now());
  const message =
    result === 'bound'
      ? html`<div class="banner">已綁定推薦人：<strong>${referrer.name}</strong></div><div class="card">${referrerCard(referrer)}${COST_NOTE()}</div>`
      : result === 'self'
        ? html`<div class="banner">這是你自己的邀請連結。</div>`
        : result === 'already'
          ? html`<div class="banner">你已經有推薦人，沒有變更。</div>${COST_NOTE()}`
          : html`<div class="banner danger">無法綁定這位推薦人。</div>`;
  return c.html(page(c, '推薦人', html`<h1>推薦人</h1>${message}<p><a class="button" href="/account">進入帳號中心</a></p>`));
});
