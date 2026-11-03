// Load test (spec 11.10, simplified: "上線前以預估尖峰流量壓測登入與 Battery 預留").
// Runs the built Worker (dist/index.js) in local workerd + D1 with test sign-in keys, so it
// measures our code and SQL under concurrency, not Cloudflare's network. Each virtual member:
// nonce → sign-in → me → profile edit → app config → Battery reserve + commit → battery → refresh.
// Usage: npm run build && node scripts/load-test.mjs [members=300] [concurrency=50]
import { appendFileSync } from 'node:fs';
import { authBindings, idTokenClaims, signJwt } from '../test/auth-fixtures.mjs';
import { startWorker } from '../test/helpers.mjs';

const MEMBERS = Number(process.argv[2] ?? 300);
const CONCURRENCY = Number(process.argv[3] ?? 50);
const KEY = 'l'.repeat(40);
const json = (body, headers = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

const keys = await authBindings();
const worker = await startWorker({ bindings: { ...keys.bindings, BATTERY_SERVICE_KEYS: JSON.stringify({ echo: KEY }) } });
await worker.battery.prepare("INSERT INTO battery_task_types (task_type, app_id, label, unit_cost, max_units, timeout_ms, enabled, updated_at) VALUES ('echo.ai', 'echo', 'AI', 1, 10, NULL, 1, 0)").run();

const timings = new Map();
const failures = [];
async function step(name, expected, run) {
  const started = performance.now();
  const res = await run();
  const ms = performance.now() - started;
  if (!timings.has(name)) timings.set(name, []);
  timings.get(name).push(ms);
  if (res.status !== expected) failures.push(`${name}: ${res.status} ${(await res.text()).slice(0, 120)}`);
  return res;
}

async function member(i) {
  const { nonce } = await (await step('POST /v1/auth/nonce', 200, () => worker.call('/v1/auth/nonce', json({ app_id: 'echo' })))).json();
  const idToken = await signJwt(keys.google, idTokenClaims('google', { sub: `load-${i}`, nonce }));
  const session = await (await step('POST /v1/auth/google', 200, () => worker.call('/v1/auth/google', json({ app_id: 'echo', id_token: idToken, nonce })))).json();
  const auth = { authorization: `Bearer ${session.access_token}` };
  await step('GET /v1/me', 200, () => worker.call('/v1/me', { headers: auth }));
  await step('PATCH /v1/me/profile', 200, () =>
    worker.call('/v1/me/profile', { method: 'PATCH', headers: { ...auth, 'content-type': 'application/json', 'if-match': '"1"' }, body: JSON.stringify({ display_name: `會員 ${i}`, phone: '0912345678', birthday: '1990-02-28' }) }),
  );
  await step('GET /v1/apps/echo/config', 200, () => worker.call('/v1/apps/echo/config'));
  const r = await (await step('POST /v1/battery/reservations', 201, () => worker.call('/v1/battery/reservations', json({ task_type: 'echo.ai', units: 1, idempotency_key: `load-${i}-0001` }, { ...auth, 'x-starry-app-key': KEY })))).json();
  await step('POST /v1/battery/reservations/{id}/commit', 200, () => worker.call(`/v1/battery/reservations/${r.reservation_id}/commit`, { method: 'POST', headers: { 'x-starry-app-key': KEY } }));
  await step('GET /v1/me/battery', 200, () => worker.call('/v1/me/battery', { headers: auth }));
  await step('POST /v1/auth/refresh', 200, () => worker.call('/v1/auth/refresh', json({ refresh_token: session.refresh_token })));
}

const started = performance.now();
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < MEMBERS) {
      const i = next++;
      await member(i).catch((e) => failures.push(`member ${i}: ${e.message}`));
    }
  }),
);
const seconds = (performance.now() - started) / 1000;
const used = Number((await worker.battery.prepare('SELECT COALESCE(SUM(used), 0) AS n FROM battery_accounts').first('n')) ?? 0);
const overspent = Number((await worker.battery.prepare('SELECT COUNT(*) AS n FROM battery_accounts WHERE used + reserved > allowance').first('n')) ?? 0);
await worker.mf.dispose();

const pct = (values, p) => values.slice().sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor((p / 100) * values.length))] ?? 0;
const requests = [...timings.values()].reduce((n, v) => n + v.length, 0);
const lines = [
  `## Load test: ${MEMBERS} members, ${CONCURRENCY} at a time (local workerd + D1)`,
  '',
  `- ${requests} requests in ${seconds.toFixed(1)} s (${(requests / seconds).toFixed(0)} requests/s)`,
  `- failures: ${failures.length}${failures.length ? ` (first: ${failures[0]})` : ''}`,
  `- Battery used: ${used} (expected ${MEMBERS}); accounts over their allowance: ${overspent}`,
  '',
  '| Endpoint | n | p50 ms | p95 ms | max ms |',
  '|---|---|---|---|---|',
  ...[...timings.entries()].map(([name, v]) => `| ${name} | ${v.length} | ${pct(v, 50).toFixed(1)} | ${pct(v, 95).toFixed(1)} | ${Math.max(...v).toFixed(1)} |`),
];
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
if (failures.length > 0 || used !== MEMBERS || overspent > 0) process.exit(1);
process.exit(0);
