/**
 * AI-3 M2 source-only LOCAL SQLite deletion preflight.
 * Inspects real source-side FK edges and record classes; NEVER executes
 * UPDATE/DELETE, treats legal/retention decisions as unresolved, and cannot
 * authorize a deletion request, physical erasure, restore, or Battery grant.
 * AI-1 alone owns the source transaction and production Auth/Session schema.
 */
export const M2_PHYSICAL_ERASURE_LIVE_ENABLED = false as const;

export type ReadonlySqliteInspector = Readonly<{
  prepare: (sql: string) => Readonly<{
    get: (...args: string[]) => unknown;
    all: (...args: string[]) => unknown[];
  }>;
}>;
export type MemberFkClass =
  | 'provider_identity'
  | 'session_refresh'
  | 'admin_grant'
  | 'm1_audit_intent'
  | 'm2_mutation_audit';
export type PhysicalErasureBlocker =
  | 'FOREIGN_KEY_ENFORCEMENT_DISABLED'
  | 'SOURCE_SCHEMA_INCOMPLETE'
  | 'UNRECOGNIZED_MEMBER_FOREIGN_KEY'
  | 'REFERENTIAL_INTEGRITY_FAILURE'
  | 'ACCOUNT_NOT_PRESENT'
  | 'REFERENCING_MEMBER_ROWS'
  | 'LEGAL_DISPOSITION_NOT_APPROVED'
  | 'EXTERNAL_ERASURE_AND_PITR_UNVERIFIED';

export type LocalPhysicalErasureReview = Readonly<{
  status: 'quarantined_source_review';
  foreign_keys_enforced: boolean;
  referential_integrity_ok: boolean;
  member_present: boolean;
  referenced_rows: Readonly<Record<MemberFkClass, number>>;
  unexpected_member_fk_tables: readonly string[];
  blockers: readonly PhysicalErasureBlocker[];
  may_delete_member: false;
  may_erase_audit: false;
  may_execute_transaction: false;
  may_restore: false;
  may_grant_battery: false;
  release_approved: false;
  live_enabled: false;
}>;

const referenceClasses = Object.freeze([
  ['starry_identities', 'provider_identity'],
  ['starry_sessions', 'session_refresh'],
  ['starry_admin_grants', 'admin_grant'],
  ['starry_m1_audit_intents', 'm1_audit_intent'],
  ['starry_m2_member_mutation_audit', 'm2_mutation_audit'],
] as const);
const sqlIdentifier = /^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/;
function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('AI3_LOCAL_ERASURE_INVALID_SQL_RESULT');
  return value as Record<string, unknown>;
}
function count(value: unknown): number {
  const amount = row(value).n;
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0)
    throw Error('AI3_LOCAL_ERASURE_INVALID_SQL_RESULT');
  return amount;
}
function inspectSql(db: ReadonlySqliteInspector, sql: string): Record<string, unknown>[] {
  return db.prepare(sql).all().map(row);
}

/**
 * This is an inspection, never an executable erasure plan.
 * No member reference, event ID, provider subject, refresh hash or PII is
 * returned. The real legal dispositions for all audit categories are UNKNOWN.
 */
export function inspectLocalMemberErasureForeignKeys(
  db: ReadonlySqliteInspector,
  memberRef: unknown,
): LocalPhysicalErasureReview {
  if (typeof memberRef !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(memberRef))
    throw Error('AI3_LOCAL_ERASURE_INVALID_MEMBER_REF');
  if (!db || typeof db.prepare !== 'function')
    throw Error('AI3_LOCAL_ERASURE_INVALID_READER');

  const fkRow = row(db.prepare('PRAGMA foreign_keys').get());
  const enforced = fkRow.foreign_keys === 1;
  const integrity = inspectSql(db, 'PRAGMA foreign_key_check').length === 0;
  const knownTables = inspectSql(db,
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .map(value => {
      if (typeof value.name !== 'string' || !sqlIdentifier.test(value.name))
        throw Error('AI3_LOCAL_ERASURE_UNKNOWN_SCHEMA');
      return value.name;
    });
  const present = new Set(knownTables);
  const complete = present.has('starry_members') &&
    present.has('starry_m1_oauth_attempts') &&
    referenceClasses.every(([table]) => present.has(table));

  const actualInbound = new Set<string>();
  for (const table of knownTables) {
    const edges = inspectSql(db, `PRAGMA foreign_key_list("${table}")`);
    for (const edge of edges) {
      if (edge.table === 'starry_members') {
        // An inbound relation on another column cannot be assumed cleaned
        // by deleting s_user_id. Any unexpected shape remains a blocker.
        actualInbound.add(table + ':' + String(edge.from) + ':' + String(edge.to));
      }
    }
  }
  const expectedInbound = new Set(referenceClasses.map(
    ([table]) => table + ':s_user_id:s_user_id',
  ));
  const unknownEdges = [...actualInbound].filter(entry => !expectedInbound.has(entry)).sort();
  for (const edge of expectedInbound)
    if (!actualInbound.has(edge)) unknownEdges.push('MISSING:' + edge);
  unknownEdges.sort();

  const references: Record<MemberFkClass, number> = {
    provider_identity: 0, session_refresh: 0, admin_grant: 0,
    m1_audit_intent: 0, m2_mutation_audit: 0,
  };
  // Only perform data reads if source schema is EXACTLY the approved local
  // fixture shape. Unknown incoming FK edges are not safe to query by guess.
  if (complete && unknownEdges.length === 0) {
    for (const [table, category] of referenceClasses) {
      const value = db.prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE s_user_id = ?`)
        .get(memberRef);
      references[category] = count(value);
    }
  }
  const memberPresent = present.has('starry_members')
    ? count(db.prepare('SELECT COUNT(*) AS n FROM starry_members WHERE s_user_id = ?')
      .get(memberRef)) === 1
    : false;

  const blockers: PhysicalErasureBlocker[] = [];
  if (!enforced) blockers.push('FOREIGN_KEY_ENFORCEMENT_DISABLED');
  if (!complete) blockers.push('SOURCE_SCHEMA_INCOMPLETE');
  if (unknownEdges.length) blockers.push('UNRECOGNIZED_MEMBER_FOREIGN_KEY');
  if (!integrity) blockers.push('REFERENTIAL_INTEGRITY_FAILURE');
  if (!memberPresent) blockers.push('ACCOUNT_NOT_PRESENT');
  if (Object.values(references).some(value => value > 0))
    blockers.push('REFERENCING_MEMBER_ROWS');
  blockers.push('LEGAL_DISPOSITION_NOT_APPROVED');
  blockers.push('EXTERNAL_ERASURE_AND_PITR_UNVERIFIED');

  return Object.freeze({
    status: 'quarantined_source_review' as const,
    foreign_keys_enforced: enforced,
    referential_integrity_ok: integrity,
    member_present: memberPresent,
    referenced_rows: Object.freeze(references),
    unexpected_member_fk_tables: Object.freeze(unknownEdges),
    blockers: Object.freeze(blockers),
    may_delete_member: false as const, may_erase_audit: false as const,
    may_execute_transaction: false as const, may_restore: false as const,
    may_grant_battery: false as const, release_approved: false as const,
    live_enabled: M2_PHYSICAL_ERASURE_LIVE_ENABLED,
  });
}


/**
 * NEW 004-specific dependency lineage, NOT an erasure allow-list.
 * The original five-FK guard intentionally still reports
 * UNRECOGNIZED_MEMBER_FOREIGN_KEY after applying 004. This read-only
 * companion supplies actionable direct+transitive row counts to reviewers,
 * without suppressing that guard or selecting any member/audit identifiers.
 *
 * An approved future Auth transaction, legal disposition and independent
 * anti-PITR witness MUST be designed elsewhere. Never use these counts as an
 * execution permit, a retention policy, or a snapshot-consistent D1 oracle.
 */
export type LocalM2DeletionChainReview = Readonly<{
  status: 'quarantined_source_review';
  schema_chain_verified: boolean;
  counts_verified: boolean;
  foreign_keys_enforced: boolean;
  referential_integrity_ok: boolean;
  member_present: boolean;
  request_count: number;
  awaiting_second_confirmation_count: number;
  pending_processing_count: number;
  first_confirmation_audit_count: number;
  second_confirmation_audit_count: number;
  unexpected_chain_edges: readonly string[];
  blockers: readonly (
    'SOURCE_SCHEMA_INCOMPLETE' |
    'FOREIGN_KEY_ENFORCEMENT_DISABLED' |
    'REFERENTIAL_INTEGRITY_FAILURE' |
    'ACCOUNT_NOT_PRESENT' |
    'UNVERIFIED_DELETION_FK_CHAIN' |
    'INCOMPLETE_DELETION_REQUEST_AUDIT' |
    'DELETION_REQUEST_ROWS_REMAIN' |
    'LEGAL_DISPOSITION_NOT_APPROVED' |
    'EXTERNAL_ERASURE_AND_PITR_UNVERIFIED'
  )[];
  may_delete_member: false;
  may_delete_request_or_audit: false;
  may_retain_identifiers: false;
  may_restore: false;
  may_grant_battery: false;
  live_enabled: false;
}>;

/**
 * Inspects the precise 004 member -> request -> request-audit FK chain
 * with REAL SQLite 001-004, including any unknown later inbound FK.
 * This deliberately does not modify the older five-edge fail-closed guard.
 */
export function inspectLocalM2DeletionRequestChain(
  db: ReadonlySqliteInspector,
  memberRef: unknown,
): LocalM2DeletionChainReview {
  if (typeof memberRef !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(memberRef))
    throw Error('AI3_LOCAL_ERASURE_INVALID_MEMBER_REF');
  if (!db || typeof db.prepare !== 'function')
    throw Error('AI3_LOCAL_ERASURE_INVALID_READER');

  const enforced = row(db.prepare('PRAGMA foreign_keys').get()).foreign_keys === 1;
  const integrity = inspectSql(db, 'PRAGMA foreign_key_check').length === 0;
  const names = inspectSql(db,
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .map(v => {
      if (typeof v.name !== 'string' || !sqlIdentifier.test(v.name))
        throw Error('AI3_LOCAL_ERASURE_UNKNOWN_SCHEMA');
      return v.name;
    });
  const present = new Set(names);
  const complete = ['starry_members', 'starry_m2_deletion_requests',
    'starry_m2_deletion_request_audit'].every(v => present.has(v));
  const edges: string[] = [];
  for (const table of names) {
    for (const fk of inspectSql(db, 'PRAGMA foreign_key_list("' + table + '")')) {
      if (!['starry_members', 'starry_m2_deletion_requests',
        'starry_m2_deletion_request_audit'].includes(String(fk.table)))
        continue;
      if (typeof fk.from !== 'string' || typeof fk.to !== 'string' ||
          typeof fk.table !== 'string' || typeof fk.on_delete !== 'string')
        throw Error('AI3_LOCAL_ERASURE_INVALID_SQL_RESULT');
      edges.push(table + ':' + fk.from + ':' + fk.table + ':' + fk.to +
        ':' + fk.on_delete);
    }
  }
  // All pre-existing member FKs from 001-003 remain valid; 004 must add
  // precisely these two edges. No cascading delete or new hidden child.
  const expected = new Set([
    ...referenceClasses.map(([table]) =>
      table + ':s_user_id:starry_members:s_user_id:NO ACTION'),
    'starry_m2_deletion_requests:s_user_id:starry_members:s_user_id:NO ACTION',
    'starry_m2_deletion_request_audit:request_id:starry_m2_deletion_requests:request_id:NO ACTION',
  ]);
  const unexpected = edges.filter(e => !expected.has(e));
  for (const e of expected) if (!edges.includes(e)) unexpected.push('MISSING:' + e);
  unexpected.sort();
  const schemaVerified = complete && unexpected.length === 0;
  const countsVerified = schemaVerified && enforced && integrity;
  const presentMember = present.has('starry_members') &&
    count(db.prepare('SELECT COUNT(*) AS n FROM starry_members WHERE s_user_id = ?')
      .get(memberRef)) === 1;
  let requestCount = 0, awaiting = 0, pending = 0, first = 0, second = 0;
  if (countsVerified && presentMember) {
    requestCount = count(db.prepare(
      'SELECT COUNT(*) AS n FROM starry_m2_deletion_requests WHERE s_user_id = ?')
      .get(memberRef));
    awaiting = count(db.prepare(
      "SELECT COUNT(*) AS n FROM starry_m2_deletion_requests WHERE s_user_id = ? AND status = 'awaiting_second_confirmation'")
      .get(memberRef));
    pending = count(db.prepare(
      "SELECT COUNT(*) AS n FROM starry_m2_deletion_requests WHERE s_user_id = ? AND status = 'pending_processing'")
      .get(memberRef));
    const auditSql =
      'SELECT COUNT(*) AS n FROM starry_m2_deletion_request_audit a ' +
      'JOIN starry_m2_deletion_requests r ON a.request_id = r.request_id ' +
      'WHERE r.s_user_id = ? AND a.event_type = ?';
    first = count(db.prepare(auditSql).get(memberRef, 'first_confirmation_received'));
    second = count(db.prepare(auditSql).get(memberRef, 'second_confirmation_received'));
  }
  const blockers: LocalM2DeletionChainReview['blockers'][number][] = [];
  if (!complete) blockers.push('SOURCE_SCHEMA_INCOMPLETE');
  if (!enforced) blockers.push('FOREIGN_KEY_ENFORCEMENT_DISABLED');
  if (!integrity) blockers.push('REFERENTIAL_INTEGRITY_FAILURE');
  if (!presentMember) blockers.push('ACCOUNT_NOT_PRESENT');
  if (!schemaVerified) blockers.push('UNVERIFIED_DELETION_FK_CHAIN');
  if (countsVerified && presentMember &&
    (requestCount !== awaiting + pending || first !== requestCount ||
      second !== pending))
    blockers.push('INCOMPLETE_DELETION_REQUEST_AUDIT');
  if (countsVerified && requestCount > 0)
    blockers.push('DELETION_REQUEST_ROWS_REMAIN');
  blockers.push('LEGAL_DISPOSITION_NOT_APPROVED');
  blockers.push('EXTERNAL_ERASURE_AND_PITR_UNVERIFIED');

  return Object.freeze({
    status: 'quarantined_source_review' as const,
    schema_chain_verified: schemaVerified,
    counts_verified: countsVerified && presentMember,
    foreign_keys_enforced: enforced,
    referential_integrity_ok: integrity,
    member_present: presentMember,
    request_count: requestCount,
    awaiting_second_confirmation_count: awaiting,
    pending_processing_count: pending,
    first_confirmation_audit_count: first,
    second_confirmation_audit_count: second,
    unexpected_chain_edges: Object.freeze(unexpected),
    blockers: Object.freeze(blockers),
    may_delete_member: false as const,
    may_delete_request_or_audit: false as const,
    may_retain_identifiers: false as const,
    may_restore: false as const,
    may_grant_battery: false as const,
    live_enabled: M2_PHYSICAL_ERASURE_LIVE_ENABLED,
  });
}
