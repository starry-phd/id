// Stamps a new handoff version: real Taiwan time, next version number, new test hash. Never type these by hand.
//   npm run handoff:stamp
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = new URL('../src/apps/handoff.ts', import.meta.url);
const TEST = new URL('../test/unit/registered-apps.test.ts', import.meta.url);

const parts = Object.fromEntries(
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date())
    .map((p) => [p.type, p.value]),
);
const day = `${parts.year}-${parts.month}-${parts.day}`;
const stamp = `${day} ${parts.hour}:${parts.minute}（台灣時間）`;

let src = readFileSync(SRC, 'utf8');
const current = /export const HANDOFF_VERSION = '(\d{4}-\d{2}-\d{2})\.(\d+)';/.exec(src);
if (!current) throw new Error('HANDOFF_VERSION not found');
const next = `${day}.${current[1] === day ? Number(current[2]) + 1 : 1}`;
src = src.replace(/export const HANDOFF_VERSION = '[^']+';/, `export const HANDOFF_VERSION = '${next}';`).replace(/export const HANDOFF_UPDATED = '[^']+';/, `export const HANDOFF_UPDATED = '${stamp}';`);
writeFileSync(SRC, src);

const run = () => {
  try {
    execFileSync('npx', ['tsx', '--import', './test/support/shipped-apps.ts', '--test', 'test/unit/registered-apps.test.ts'], { encoding: 'utf8', stdio: 'pipe' });
    return null;
  } catch (error) {
    const out = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    return /actual: '([^']+)'/.exec(out)?.[1] ?? null;
  }
};
const actual = run();
if (actual) {
  const test = readFileSync(TEST, 'utf8').replace(/(assert\.equal\(`\$\{HANDOFF_VERSION\}:\$\{hash\}`, ')[^']+(')/, `$1${actual}$2`);
  writeFileSync(TEST, test);
  if (run() !== null) throw new Error('hash still does not match');
}
console.log(`handoff stamped: ${next}｜${stamp}`);
