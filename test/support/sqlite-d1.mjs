// Minimal Cloudflare D1 stand-in on node:sqlite for fast unit tests of SQL-heavy domain modules.
// Integration tests still run the real bundle in workerd (Miniflare); this only backs test/unit.
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const plain = (row) => (row ? { ...row } : row);

function bindable(value) {
  if (value === undefined) throw new Error('D1_TYPE_ERROR: Type undefined is not supported');
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

function d1Error(error) {
  return new Error(`D1_ERROR: ${error.message}`);
}

class Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...values) {
    return new Statement(this.db, this.sql, values.map(bindable));
  }

  prepared() {
    try {
      return this.db.sqlite.prepare(this.sql);
    } catch (error) {
      throw d1Error(error);
    }
  }

  execute() {
    const statement = this.prepared();
    try {
      if (statement.columns().length > 0) {
        const results = statement.all(...this.params).map(plain);
        return { results, success: true, meta: { changes: 0, last_row_id: 0, duration: 0 } };
      }
      const outcome = statement.run(...this.params);
      return { results: [], success: true, meta: { changes: Number(outcome.changes), last_row_id: Number(outcome.lastInsertRowid), duration: 0 } };
    } catch (error) {
      throw d1Error(error);
    }
  }

  async first(column) {
    const statement = this.prepared();
    let row;
    try {
      row = plain(statement.get(...this.params));
    } catch (error) {
      throw d1Error(error);
    }
    if (row === undefined) return null;
    return column ? (row[column] ?? null) : row;
  }

  async all() {
    return this.execute();
  }

  async run() {
    return this.execute();
  }
}

export class SqliteD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec('PRAGMA foreign_keys = ON');
  }

  prepare(sql) {
    return new Statement(this, sql);
  }

  /** Runs statements in one transaction, like D1: all succeed or none apply. */
  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try {
      const results = statements.map((statement) => statement.execute());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}

function splitSql(sql) {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, '').trim())
    .join(' ')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

/** A fresh in-memory database with every migration in `dir` applied in order. */
export function migratedDb(dir = 'migrations/identity') {
  const db = new SqliteD1();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    for (const statement of splitSql(readFileSync(`${dir}/${file}`, 'utf8'))) db.sqlite.exec(statement);
  }
  return db;
}
