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
    assert.match(a.no, /^\d{1,4}-\d{7}$/);

    const anon = await worker.call(`/Invite${a.no}`, get());
    assert.equal(anon.status, 200);
    const anonHtml = await anon.text();
    assert.match(anonHtml, /王小明 邀請你加入繁星/);
    assert.ok(anonHtml.includes(`/account?next=/Invite${a.no}`));
    assert.equal((await worker.call('/Invite886-9999999', get())).status, 404);

    const bound = await (await worker.call(`/Invite${a.no}`, get(b.cookie))).text();
    assert.match(bound, /已綁定推薦人：<strong>王小明<\/strong>/);
    const again = await (await worker.call(`/Invite${c.no}`, get(b.cookie))).text();
    assert.match(again, /你的推薦人是 <strong>王小明<\/strong>/, 'one referrer, set once');
    assert.equal((await worker.db.prepare('SELECT COUNT(*) AS n FROM referrals WHERE invitee_user_id = ?').bind(b.userId).first()).n, 1);
    assert.match(await (await worker.call(`/Invite${a.no}`, get(a.cookie))).text(), /自己的邀請連結/);

    // C joins under B; A (above B) cannot be bound under C.
    assert.match(await (await worker.call(`/Invite${b.no}`, get(c.cookie))).text(), /已綁定推薦人：<strong>John Smith<\/strong>/);
    assert.match(await (await worker.call(`/Invite${c.no}`, get(a.cookie))).text(), /無法綁定/);
    assert.equal((await worker.db.prepare('SELECT COUNT(*) AS n FROM referrals WHERE invitee_user_id = ?').bind(a.userId).first()).n, 0);

    const network = await (await worker.call('/account/network', get(a.cookie))).text();
    assert.match(network, /<b>2<\/b><span>總人數/);
    assert.match(network, /<b>1<\/b><span>橫排/);
    assert.match(network, /<b>2<\/b><span>最深層數/);
    assert.ok(network.indexOf('John Smith') < network.indexOf('陳大文'), 'the tree shows the downline below its parent');
    assert.match(network, /第 2 層 1 人/);

    const referral = await (await worker.call('/account/referral', get(a.cookie))).text();
    assert.ok(referral.includes(`https://api.test/Invite${a.no}`));
    assert.match(referral, /id="share"/);
    assert.match(await (await worker.call('/account/referral', get(b.cookie))).text(), /我的推薦人：<strong>王小明<\/strong>/);
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
    assert.equal((await worker.call('/886-0000000', get())).status, 404);
    assert.equal((await worker.call(`/a/${d.no}`, get())).status, 404, 'no picture yet: the page shows the initials');
    assert.match(page, /role="img"[^>]*>林小<\/span>/);
    const home = await (await worker.call('/account', get(d.cookie))).text();
    for (const label of ['關於我', '推薦達人', '組織網', 'class="starnav"']) assert.ok(home.includes(label), label);
    assert.ok(!home.includes('burger'), 'no hamburger menu');
  });
});
