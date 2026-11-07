import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { authBindings, GOOGLE_AUDIENCE, idTokenClaims, signJwt } from './auth-fixtures.mjs';
import { startWorker } from './helpers.mjs';

const ORIGIN = 'https://api.test';

describe('referrals, the organization network and public profiles', () => {
  let worker;
  let keys;
  before(async () => {
    keys = await authBindings();
    const audiences = { account: { apple: ['phd.starry.id.web'], google: [GOOGLE_AUDIENCE] } };
    worker = await startWorker({ bindings: { ...keys.bindings, AUTH_TEST_AUDIENCES: JSON.stringify(audiences) } });
  });
  after(async () => {
    await worker?.mf.dispose();
  });

  const get = (cookie) => ({ redirect: 'manual', headers: cookie ? { cookie } : {} });

  async function member(sub, name) {
    const loginPage = await (await worker.call('/account')).text();
    const nonce = /"nonce":"([A-Za-z0-9_-]+)"/.exec(loginPage)?.[1];
    const idToken = await signJwt(keys.google, idTokenClaims('google', { sub, nonce, email: `${sub}@example.com` }));
    const res = await worker.call('/account/session', { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ provider: 'google', id_token: idToken, nonce }) });
    assert.equal(res.status, 200, await res.clone().text());
    const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
    const row = await worker.db.prepare("SELECT u.user_id, u.member_no FROM users u JOIN auth_identities i ON i.user_id = u.user_id WHERE i.provider = 'google' AND i.subject = ?").bind(sub).first();
    await worker.db.prepare('UPDATE profiles SET display_name = ?, phone = ?, motto = ? WHERE user_id = ?').bind(name, '+886912000111', '向星星出發', row.user_id).run();
    return { cookie, userId: row.user_id, no: row.member_no };
  }

  test('invite links bind once, never to yourself or to someone below you; the network counts everyone', async () => {
    const a = await member('ref-a', '王小明');
    const b = await member('ref-b', 'John Smith');
    const c = await member('ref-c', '陳大文');
    assert.match(a.no, /^[A-Z]{2}\d{7}$/);

    const bind = (user, no) => worker.call('/account/referral/bind', { method: 'POST', headers: { cookie: user.cookie, origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ no }), redirect: 'manual' });
    const anon = await worker.call(`/Invite/${a.no}`, get());
    assert.equal(anon.status, 200);
    const anonHtml = await anon.text();
    assert.match(anonHtml, /王小明 邀請你加入繁星/);
    assert.ok(anonHtml.includes(`/account?next=/Invite/${a.no}`));
    assert.ok(anonHtml.includes(a.no), 'the inviter number is shown');
    assert.equal((await worker.call('/Invite/TW9999999', get())).status, 404);
    const old = await worker.call(`/Invite${a.no}`, get());
    assert.equal(old.status, 301);
    assert.equal(old.headers.get('location'), `/Invite/${a.no}`);

    // Opening the link only asks; nothing is bound until the member confirms.
    const ask = await (await worker.call(`/Invite/${a.no}`, get(b.cookie))).text();
    assert.match(ask, /確定要綁定 王小明 為你的推薦人嗎/);
    assert.match(ask, /1000 顆普通電池/);
    assert.match(ask, /10 顆量子電池/);
    assert.ok(ask.includes('🔋') && ask.includes('⚛️'), 'battery icons are shown with batteries');
    assert.equal((await worker.db.prepare('SELECT COUNT(*) AS n FROM referrals WHERE invitee_user_id = ?').bind(b.userId).first()).n, 0);
    const bound = await (await bind(b, a.no)).text();
    assert.match(bound, /已綁定推薦人：<strong>王小明<\/strong>/);
    const again = await (await worker.call(`/Invite/${c.no}`, get(b.cookie))).text();
    assert.match(again, /你已經有推薦人/);
    assert.match(await (await bind(b, c.no)).text(), /沒有變更/);
    assert.equal((await worker.db.prepare('SELECT COUNT(*) AS n FROM referrals WHERE invitee_user_id = ?').bind(b.userId).first()).n, 1);
    assert.match(await (await worker.call(`/Invite/${a.no}`, get(a.cookie))).text(), /自己的邀請連結/);

    // The typed code or pasted link finds the inviter too.
    const lookup = await worker.call(`/account/referral/lookup?code=${encodeURIComponent(`https://id.starry.phd/Invite/${b.no}`)}`, get(c.cookie));
    assert.equal(lookup.status, 303);
    assert.equal(lookup.headers.get('location'), `/Invite/${b.no}`);
    assert.equal((await worker.call(`/account/referral/lookup?code=${b.no.toLowerCase()}`, get(c.cookie))).headers.get('location'), `/Invite/${b.no}`);
    assert.equal((await worker.call('/account/referral/lookup?code=oops', get(c.cookie))).headers.get('location'), '/account/referral?e=1');

    // C joins under B; A (above B) cannot be bound under C.
    assert.match(await (await worker.call(`/Invite/${b.no}`, get(c.cookie))).text(), /John Smith/);
    assert.match(await (await bind(c, b.no)).text(), /已綁定推薦人：<strong>John Smith<\/strong>/);
    assert.match(await (await worker.call(`/Invite/${c.no}`, get(a.cookie))).text(), /無法綁定/);
    assert.equal((await worker.db.prepare('SELECT COUNT(*) AS n FROM referrals WHERE invitee_user_id = ?').bind(a.userId).first()).n, 0);

    const network = await (await worker.call('/account/network', get(a.cookie))).text();
    assert.match(network, /<b>2<\/b><span>總人數/);
    assert.match(network, /<b>1<\/b><span>橫排/);
    assert.match(network, /<b>2<\/b><span>最深層數/);
    assert.ok(network.indexOf('John Smith') < network.indexOf('陳大文'), 'the tree shows the downline below its parent');
    assert.ok(network.includes('otree') && network.includes('class="pn me"'), 'round chart with me on top');
    assert.ok(!network.includes(b.no) && !network.includes(c.no), 'member numbers are not shown in the chart');
    assert.match(network, /第 2 層 1 人/);
    assert.ok(network.includes(`data-id="${b.userId}"`) && network.includes('id="pcard"'), 'every picture opens a pop-up');
    const card = await worker.call(`/account/network/card/${b.userId}`, get(a.cookie));
    assert.equal(card.status, 200, 'I can open a member below me');
    const cardHtml = await card.text();
    assert.ok(cardHtml.includes('John Smith') && !cardHtml.includes(b.no), 'the pop-up shows the public profile without the member number');
    assert.equal((await worker.call(`/account/network/card/${a.userId}`, get(c.cookie))).status, 404, 'not someone above me');
    assert.equal((await worker.call(`/account/network/card/${b.userId}`)).status, 401, 'sign-in needed');
    const profilePage = await (await worker.call('/account/profile', get(a.cookie))).text();
    assert.equal(profilePage.split('class="inline crown"').length - 1, 2, 'a crown button beside the nickname and beside the name');

    const referral = await (await worker.call('/account/referral', get(a.cookie))).text();
    assert.ok(referral.includes(`https://api.test/Invite/${a.no}`));
    assert.match(referral, /輸入別人的邀請碼/);
    assert.match(referral, /id="share"/);
    assert.match(await (await worker.call('/account/referral', get(b.cookie))).text(), /我的推薦人<\/strong>[\s\S]*王小明/);
    assert.equal((await worker.call('/account/network', get())).status, 303);
  });

  test('the public profile shows only what the member made public; the menu is always on top', async () => {
    const d = await member('pub-d', '林小美');
    const page = await (await worker.call(`/${d.no}`, get())).text();
    assert.match(page, /林小美/);
    assert.match(page, /向星星出發/);
    assert.ok(!page.includes('912000111'), 'the private phone number stays hidden');
    assert.ok(!page.includes('pub-d@example.com'));
    await worker.db.prepare("UPDATE profiles SET visibility = json_set(visibility, '$.phone', 'public') WHERE user_id = ?").bind(d.userId).run();
    assert.ok((await (await worker.call(`/${d.no}`, get())).text()).includes('912000111'));
    assert.equal((await worker.call('/TW0000000', get())).status, 404);
    assert.equal((await worker.call(`/a/${d.no}`, get())).status, 404, 'no picture yet: the page shows the initials');
    assert.match(page, /role="img"[^>]*>林小<\/span>/);
    const home = await (await worker.call('/account', get(d.cookie))).text();
    for (const label of ['關於我', '推薦達人', '組織網', 'class="starnav"']) assert.ok(home.includes(label), label);
    assert.ok(!home.includes('burger'), 'no hamburger menu');
  });
  test('a member can change the member number; links follow, the old one stops working, taken and bad ones are refused', async () => {
    const a = await member('no-a', '李小華');
    const b = await member('no-b', '周大同');
    const post = (cookie, no) => worker.call('/account/member-no', { method: 'POST', headers: { cookie, origin: ORIGIN, accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ no }) });
    const page = await (await worker.call('/account/profile', get(a.cookie))).text();
    assert.ok(page.includes('id="mn-card"') && page.includes(a.no), 'the profile page has the member number card');
    assert.ok(page.includes('TW:886,HK:852'), 'countries start with Taiwan and its neighbours');

    const check = async (cookie, no) => (await worker.call(`/account/member-no/check?no=${no}`, get(cookie))).json();
    assert.equal((await check(a.cookie, b.no)).available, false);
    assert.equal((await check(a.cookie, 'JP0000042')).available, true);
    assert.equal((await check(a.cookie, '886-1234567')).available, false);
    const random = await (await worker.call('/account/member-no/random?iso=KR', get(a.cookie))).json();
    assert.match(random.digits, /^\d{7}$/);

    assert.equal((await post(a.cookie, b.no)).status, 409);
    assert.equal((await post(a.cookie, '886-1234567')).status, 400);
    const done = await post(a.cookie, 'jp0000042');
    assert.equal(done.status, 200);
    assert.equal((await done.json()).member_no, 'JP0000042');
    assert.equal((await worker.call(`/${a.no}`, get())).status, 404, 'the old public page is gone');
    assert.equal((await worker.call('/JP0000042', get())).status, 200);
    assert.equal((await worker.call(`/Invite/${a.no}`, get())).status, 404, 'the old invite link stops working');
    assert.match(await (await worker.call('/Invite/JP0000042', get())).text(), /李小華 邀請你加入繁星/);
    assert.match(await (await worker.call('/account/referral', get(a.cookie))).text(), /Invite\/JP0000042/);

    // three changes a day, then the limit; another member can take the freed number.
    assert.equal((await post(a.cookie, 'JP0000043')).status, 200);
    assert.equal((await post(a.cookie, 'JP0000044')).status, 200);
    assert.equal((await post(a.cookie, 'JP0000045')).status, 429);
    assert.equal((await post(b.cookie, 'JP0000042')).status, 200, 'a released number can be taken');
  });
  test('a first Google sign-in starts the basic profile from what Google sent', async () => {
    const loginPage = await (await worker.call('/account')).text();
    const nonce = /"nonce":"([A-Za-z0-9_-]+)"/.exec(loginPage)?.[1];
    const idToken = await signJwt(keys.google, idTokenClaims('google', { sub: 'seed-g', nonce, email: 'seed-g@example.com', name: '張小星', locale: 'ja' }));
    const res = await worker.call('/account/session', { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ provider: 'google', id_token: idToken, nonce }) });
    assert.equal(res.status, 200, await res.clone().text());
    const row = await worker.db.prepare("SELECT p.display_name, p.locale, p.contact_email, p.contact_email_verified_at FROM profiles p JOIN auth_identities i ON i.user_id = p.user_id WHERE i.subject = 'seed-g'").first();
    assert.equal(row.display_name, '張小星');
    assert.equal(row.locale, 'ja-JP');
    assert.equal(row.contact_email, 'seed-g@example.com');
    assert.ok(row.contact_email_verified_at > 0);
  });
  test('profile page: all public / all hidden, one field in place, nickname dice, and the shown name in the API', async () => {
    const m = await member('vis-a', '許小光');
    const post = (path, params) => worker.call(path, { method: 'POST', headers: { cookie: m.cookie, origin: ORIGIN, accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
    const version = async () => (await worker.db.prepare('SELECT version FROM profiles WHERE user_id = ?').bind(m.userId).first()).version;
    const page = await (await worker.call('/account/profile', get(m.cookie))).text();
    for (const text of ['id="vis-all-public"', 'id="vis-all-private"', 'id="vis-toast"', 'data-suggest="nickname"', 'data-label="姓名"']) assert.ok(page.includes(text), text);

    const hidden = await post('/account/profile/visibility-all', { value: 'private', version: String(await version()) });
    assert.equal(hidden.status, 200);
    const body = await hidden.json();
    assert.equal(body.ok, true);
    assert.equal(body.visibility.phone, 'private');
    assert.equal(body.visibility.display_name, 'private');
    assert.equal(body.visibility.avatar, 'public', 'the picture is always public');
    assert.equal((await post('/account/profile/visibility-all', { value: 'public', version: '0' })).status, 409, 'stale version is refused');
    const shown = await post('/account/profile/visibility-all', { value: 'public', version: String(body.version) });
    const all = await shown.json();
    assert.ok(Object.values(all.visibility).every((v) => v === 'public'));
    assert.equal((await post('/account/profile/visibility-all', { value: 'maybe', version: String(all.version) })).status, 400);

    // one field: JSON answer, no redirect, version moves on
    const one = await post('/account/profile', { version: String(all.version), field: 'visibility.phone', value: 'private' });
    assert.equal(one.status, 200);
    assert.equal((await one.json()).ok, true);
    assert.equal((await worker.db.prepare("SELECT json_extract(visibility, '$.phone') AS v FROM profiles WHERE user_id = ?").bind(m.userId).first()).v, 'private');

    const dice = await (await worker.call('/account/nickname-suggestion?current=x', get(m.cookie))).json();
    assert.match(dice.nickname, /^[\u4e00-\u9fff]{3,12}$/);
    assert.equal((await worker.call('/account/nickname-suggestion', get())).status, 401);

    // the shown name: nickname first, then the real name
    const token = await (await worker.call('/account', get(m.cookie))).text();
    assert.ok(token.includes('許小光'), 'no nickname yet: the real name is shown');
    await worker.db.prepare("UPDATE profiles SET nickname = '樂觀蜜蜂' WHERE user_id = ?").bind(m.userId).run();
    const home = await (await worker.call('/account', get(m.cookie))).text();
    assert.ok(home.includes('樂觀蜜蜂') && !home.includes('<h1>許小光</h1>'));
  });
});
