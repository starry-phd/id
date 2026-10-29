# AI-0 W1 four-owner integration review
2026-10-29 Taiwan. Refs #1/#2/#3/#4/#5/#220; base #245 e1b255b014c673439f134ef5a58107a036f4b60f.

## Received and reviewed
AI-1 #247 abb0a10bc91bcf72990d6abf11facea0277fadea (4 files); AI-2 #249 bda400fbbd1092cae5f29ce7a994f519a92fdf85 (2); AI-3 #248 dc81ed3a9c27a99fff1066899d69795683736553 (3); AI-4 #246 06bd8f27345955f2336f7a8a39c1ae91657df8ec (2). All four own final SHA Actions completed/success independently checked. Original eleven blobs are imported by SHA, not rewritten.
This new tree inherits #243 requirements queue, #244 isolated handler, #245 isolated client/spec/roundtrip. Each Owner branch remains based on fixed #242; none is rebased or merged into main.

## Review acceptance: narrowly scoped
AI-1 source code/tests/source map and review: accepts metadata names/route for review only; no auth from user-provided flags, no side effects or event publication. A JavaScript field-name checker is not a cryptographic or hostile-code sandbox and must not be used as runtime authorization.
AI-2 design: AI-2 exclusive Billing writer, receipt/first-claim/entitlement/outbox same authority commit; current Auth for purchase/restore but independently authenticated provider revocation must not require user login. No writer/schema migration implemented.
AI-3 design/tests: separate source and receiver commits, durable inbox/audit before conceptual ACK; current Queue ack_safe is not real trust proof. The old four-field deletion row is not a canonical D06 signed event. No legal duration inferred.
AI-4 design: exact canonical /v1/starry-id/members/me, five fields, revision >=1, no aliases, explicit local transport/token port, no cookies/redirect/cache/retry. Existing public Worker/OpenAPI/SDK remain health-only.
Accepted for source-preserving isolated contract integration, not for live/public runtime registration.

## Material unresolved differences
1. Billing JSON identity_keys.transaction_unique_key includes brand/app/environment; proposed billing_verified_receipt.unique and ADR use global provider/store_namespace/store_transaction_ref. Before writer implementation AI-2 must reconcile authoritative receipt identity versus contextual scope. Do not weaken original-lineage first-claim uniqueness. This integration preserves and flags the inconsistent original; tests enforce that it remains explicitly blocked, not silently approved.
2. Private envelope candidates use different names (issuer vs issuer_ref, signature vs integrity_signature, session_version vs current_session_version). These are not a final wire contract. Public eleven core names plus conditional idempotency match. No synthetic thirteenth field or promotion of the old seventeen-field candidate.
3. Initial Auth/key/DB failure may be 401 while final DB failure 503. Keep the actual wire behavior, prohibit automatic token refresh/retry, require separate reviewed outage semantics before shared/public routing.
4. Q104/Q119, real isolated resources, official issuer/key custody, independent anti-PITR and real Queue/D1 evidence remain blocked.

## Validation and remaining work
Six new integration checks verify eleven immutable blobs, AI-1/AI-4/actual profile contract parity, AI-1/AI-2/AI-3 core alignment, no live authority, explicit Billing mismatch and official release denial. They exercise real imported checkout data; not another mock implementation. Existing eight handler/seven roundtrip tests and Owner W1 tests run on this new checkout in existing CI.
New exact integration SHA must finish its own full offline CI; Owner successes are not a combined-SHA success. A shared runtime work order must specify local-only composition and retain deployment/resource denial; this PR itself never registers a protected endpoint.
G00–G10 remain 11/11 blocked, release/P05 false, main untouched. No deployment, secrets, real resources, paid service, H-Global or Echo work. Rollback: close this independent Draft/discard its 14 additions; #245/Owner PRs remain intact.
