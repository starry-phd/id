#!/usr/bin/env python3
"""Gate 2 SQLite :memory: smoke for UNAPPLIED AI-3 schema draft; never touches D1."""
import sqlite3
from pathlib import Path

schema = Path('packages/ai3/schema/001_audit_design.sql').read_text(encoding='utf-8')
db = sqlite3.connect(':memory:')
try:
    db.executescript(schema)
    row = ('starry', 'starry.demo', 'staging', 'billing.entitlement.changed', 'nonce_1', 'pending', 0)
    db.execute('INSERT INTO ai3_delivery_dedupe VALUES (?,?,?,?,?,?,?)', row)
    try:
        db.execute('INSERT INTO ai3_delivery_dedupe VALUES (?,?,?,?,?,?,?)', row)
    except sqlite3.IntegrityError:
        pass
    else:
        raise AssertionError('Idempotency unique key must reject replay')
    try:
        db.execute('INSERT INTO ai3_delivery_dedupe VALUES (?,?,?,?,?,?,?)',
                   ('hglobal', 'starry.demo', 'staging', 'event', 'nonce_2', 'pending', 0))
    except sqlite3.IntegrityError:
        pass
    else:
        raise AssertionError('Starry-only DB constraint must reject cross-brand events')
    count = db.execute('SELECT COUNT(*) FROM ai3_delivery_dedupe').fetchone()[0]
    assert count == 1, 'Cross-brand/replayed rows must never insert'
    db.execute("""INSERT INTO ai3_audit_events
       (event_id,event_type,schema_version,brand_id,app_id,environment,occurred_at,
        correlation_id,resource_type,resource_id,result,actor_kind,actor_id,permission,action)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
       ('ev_01','audit.read','0.1','starry','starry.demo','staging',
        '2026-10-26T08:00:00Z','corr_1','member','user_1','denied','user','user_1','audit:read','read'))
    assert db.execute('SELECT COUNT(*) FROM ai3_audit_events').fetchone()[0] == 1
    print('Gate2 SQLite in-memory AI-3 dedupe/audit: PASS')
finally:
    db.close()
