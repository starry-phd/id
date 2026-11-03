import { readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';

/** Same compatibility date as the deployed Worker, read from wrangler.jsonc. */
export const COMPATIBILITY_DATE = JSON.parse(readFileSync('wrangler.jsonc', 'utf8').replace(/^\s*\/\/.*$/gm, '')).compatibility_date;

/** Splits a migration file into single statements for D1 prepare(). */
export function splitSql(sql) {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, '').trim())
    .join(' ')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
    .reduce((statements, piece) => {
      // CREATE TRIGGER bodies contain ';' — keep them together until their END.
      const last = statements[statements.length - 1];
      if (last && /^CREATE\s+TRIGGER\b/i.test(last) && !/\bEND$/i.test(last)) statements[statements.length - 1] = `${last}; ${piece}`;
      else statements.push(piece);
      return statements;
    }, []);
}

/** Applies every migration in order, exactly as `wrangler d1 migrations apply` would. */
export async function applyMigrations(db, dir = 'migrations/identity') {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    for (const statement of splitSql(await readFile(`${dir}/${file}`, 'utf8'))) {
      await db.prepare(statement).run();
    }
  }
  return files;
}

/**
 * Starts the bundled Worker (dist/index.js, built by `npm run build`) in local
 * workerd with a fresh in-memory D1. Nothing here talks to Cloudflare.
 */
export async function startWorker({ migrate = true, bindings = {} } = {}) {
  const mf = new Miniflare({
    modules: true,
    scriptPath: 'dist/index.js',
    compatibilityDate: COMPATIBILITY_DATE,
    d1Databases: { DB_IDENTITY: 'starry-identity-test', DB_BILLING: 'starry-billing-test' },
    r2Buckets: { AVATARS: 'starry-avatars-test', SUPPORT_FILES: 'starry-support-files-test' },
    bindings: { STARRY_ENV: 'development', ...bindings },
  });
  let db;
  let billing;
  try {
    db = await mf.getD1Database('DB_IDENTITY');
    billing = await mf.getD1Database('DB_BILLING');
    if (migrate) {
      await applyMigrations(db);
      await applyMigrations(billing, 'migrations/billing');
    }
  } catch (error) {
    // A runtime that failed to start must still be shut down, or the test process never exits.
    await mf.dispose().catch(() => {});
    throw error;
  }
  const call = (path, init) => mf.dispatchFetch(`https://api.test${path}`, init);
  return { mf, db, billing, call };
}
