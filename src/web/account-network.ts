import { html } from 'hono/html';
import { initialsOf } from '../identity/initials';
import { MEMBER_NO } from '../identity/member-number';
import { bindReferrer, directCount, memberByNo, orgNetwork, referrerOf, type OrgNode } from '../identity/referrals';
import { avatarBubble, avatarPath } from './member-nav';
import { page, type Html, type WebContext } from './layout';
import { accountApp, publicPages } from './account-lib';
import { webContext } from './layout';
import { loadProfile, publicProfile } from '../identity/profile';

/** Invite link and code: /Invite<member number>, e.g. https://id.starry.phd/InviteTW0112342 */
export const inviteCode = (memberNo: string): string => `Invite${memberNo}`;

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
  const link = memberNo ? `${new URL(c.req.url).origin}/${inviteCode(memberNo)}` : null;
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
  <input id="invite-code" value="${inviteCode(memberNo!)}" readonly>
  <div class="actions"><button id="share" type="button">分享邀請連結</button><button id="copy" type="button" class="secondary">複製連結</button></div>
  <p id="share-status" role="status" aria-live="polite"></p>
</div>`
  : html`<div class="banner">會員編號建立中，請稍後重新整理。</div>`}
<div class="statrow"><div class="statbox"><b>${direct}</b><span>直接邀請</span></div></div>
${mine ? html`<div class="card">我的推薦人：<strong>${mine.name}</strong></div>` : ''}
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

function memberBubble(n: Pick<OrgNode, 'has_avatar' | 'member_no' | 'initials' | 'name'>, size = 32): Html {
  return avatarBubble({ initials: n.initials, photo: n.has_avatar && n.member_no ? avatarPath(n.member_no) : null, size, label: n.name });
}

function renderTree(nodes: OrgNode[], parent: string): Html {
  const kids = nodes.filter((n) => n.parent_id === parent);
  if (kids.length === 0) return html``;
  return html`<ul>${kids.map((n) => html`<li><span class="node">${memberBubble(n)}<span>${n.name}</span><span class="lv">${levelLabel(n.depth - 1)}</span></span>${renderTree(nodes, n.user_id)}</li>`)}</ul>`;
}

/** GET /account/network — 組織網: everyone below me, fully expanded, with counts. */
accountApp.get('/network', async (c) => {
  const web = c.get('web');
  if (!web) return c.redirect('/account?next=/account/network', 303);
  if (web.status !== 'active') return c.redirect('/account', 303);
  const { nodes, stats } = await orgNetwork(c.env.DB_IDENTITY, web.userId);
  const top = nodes.filter((n) => n.depth === 1);
  return c.html(
    page(
      c,
      '組織網',
      html`<h1>組織網</h1>
<div class="statrow">
  <div class="statbox"><b>${stats.total}</b><span>總人數</span></div>
  <div class="statbox"><b>${stats.direct}</b><span>橫排（第 1 層）</span></div>
  <div class="statbox"><b>${stats.depth}</b><span>最深層數</span></div>
  <div class="statbox"><b>${stats.total - stats.direct}</b><span>往下共（第 2 層起）</span></div>
</div>
${stats.perLevel.length > 0 ? html`<div class="chips">${stats.perLevel.map((n, i) => html`<span class="badge">${levelLabel(i)} ${n} 人</span>`)}</div>` : ''}
${stats.truncated ? html`<div class="banner">人數很多，只顯示前 1500 位。</div>` : ''}
${top.length > 0
  ? html`<div class="card"><ul class="tree">${top.map((n) => html`<li><span class="node">${memberBubble(n)}<span>${n.name}</span><span class="lv">${levelLabel(0)}</span></span>${renderTree(nodes, n.user_id)}</li>`)}</ul></div>`
  : html`<div class="card">還沒有人使用你的邀請。到「推薦達人」分享你的邀請連結。</div>`}
<p><a class="button" href="/account/referral">推薦達人</a></p>`,
    ),
  );
});

// ---------- public pages (no sign-in needed to look) ----------

const PUBLIC_NO = '[A-Z]{2}\\d{7}';

/** GET /a/<member number> — a member's public picture (the picture is always public). */
publicPages.get(`/a/:no{${PUBLIC_NO}}`, async (c) => {
  const no = c.req.param('no');
  if (!c.env.AVATARS || !MEMBER_NO.test(no)) return c.body(null, 404);
  const row = await c.env.DB_IDENTITY.prepare("SELECT p.avatar_key FROM users u JOIN profiles p ON p.user_id = u.user_id WHERE u.member_no = ? AND u.status = 'active'").bind(no).first<{ avatar_key: string | null }>();
  const object = row?.avatar_key ? await c.env.AVATARS.get(row.avatar_key) : null;
  if (!object) return c.body(null, 404);
  return new Response(object.body, { headers: { 'content-type': object.httpMetadata?.contentType ?? 'image/jpeg', 'cache-control': 'public, max-age=300' } });
});

/** GET /<member number> — the member's public profile; only what they chose to make public. */
publicPages.get(`/:no{${PUBLIC_NO}}`, webContext, async (c) => {
  const no = c.req.param('no');
  const db = c.env.DB_IDENTITY;
  const row = await db.prepare("SELECT user_id FROM users WHERE member_no = ? AND status = 'active'").bind(no).first<{ user_id: string }>();
  const loaded = row ? await loadProfile(db, row.user_id) : null;
  if (!row || !loaded) return c.html(page(c, '找不到會員', html`<h1>找不到這位會員</h1>`), 404);
  const p = publicProfile(loaded.row, loaded.row.avatar_key ? avatarPath(no) : null, Date.now());
  const name = p.nickname || p.display_name || no;
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
  return c.html(
    page(
      c,
      name,
      html`<div class="hero">${avatarBubble({ initials: initialsOf(p.display_name ?? p.nickname), photo: p.avatar_url, size: 88, label: name })}<div><h1>${name}</h1><span class="badge">${no}</span></div></div>
${shown.length > 0 ? html`<div class="card">${shown.map(([k, v]) => html`<p><strong>${k}</strong> ${k === '個人網站' && v && /^https?:\/\//i.test(v) ? html`<a href="${v}" rel="nofollow noopener noreferrer">${v}</a>` : v}</p>`)}</div>` : ''}`,
    ),
  );
});

/** GET /Invite<member number> — the invite link: shows who invited you and binds you to them. */
publicPages.get(`/:code{Invite${PUBLIC_NO}}`, webContext, async (c) => {
  const no = c.req.param('code').slice('Invite'.length);
  const db = c.env.DB_IDENTITY;
  const referrer = await memberByNo(db, no);
  if (!referrer) return c.html(page(c, '邀請連結', html`<h1>這個邀請連結無效</h1>`), 404);
  const web = c.get('web');
  if (!web || web.status !== 'active') {
    return c.html(
      page(c, '邀請你加入繁星', html`<h1>${referrer.name} 邀請你加入繁星</h1><div class="card"><a class="button" href="/account?next=/Invite${no}">登入或註冊</a></div>`),
    );
  }
  const result = await bindReferrer(db, web.userId, referrer.user_id, c.get('requestId'), Date.now());
  const mine = await referrerOf(db, web.userId);
  const message =
    result === 'bound'
      ? html`<div class="banner">已綁定推薦人：<strong>${referrer.name}</strong></div>`
      : result === 'self'
        ? html`<div class="banner">這是你自己的邀請連結，分享給朋友吧。</div>`
        : mine
          ? html`<div class="banner">你的推薦人是 <strong>${mine.name}</strong>。</div>`
          : html`<div class="banner danger">無法綁定這位推薦人。</div>`;
  return c.html(page(c, '邀請你加入繁星', html`<h1>${referrer.name} 的邀請</h1>${message}<p><a class="button" href="/account">進入帳號中心</a></p>`));
});

