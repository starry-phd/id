# AI-0 W2 integration / operational authorization
2026-10-29 Taiwan; #1/#220. Base #250 7316ee0f014a01649eea87a62b3ad6cdb6b1febd.

## Source review
Import ten untouched blobs from AI-1 #253 f9d86a836d528603e4fca99a0ecfc30f708c2d5f (3), AI-2 #251 33f719db40d9edfd76dd3fefc06110b9d374816d (2), AI-3 #254 f97dfd6422b43eb517552e12c9cdf3015217cfc5 (3), AI-4 #252 a2ce93b9ed3011c52efd69a7849be7a5d73835d5 (2). Each latest owner SHA Actions independently observed completed/success. Prior intermediate fixture failures remain in their PR histories; do not treat those as success.

AI-1 wraps existing R23 with request-local error tracking and WeakMap sealed principal; unknown key null is denied, thrown key/DB failure unavailable. Silent null cannot reveal hidden outages. No automatic retry, no HTTP upgrade; outcome remains local-only.
AI-2 amendment consistently selects provider/store_namespace/store_transaction_ref receipt identity and treats old six-field projection as context lookup; immutable server registry and independently verified Store are required for namespace. First claim still omits member. Accept as design correction only; no SKU/provider identity/resource grant.
AI-3 twelve-pair no-alias vocabulary distinguishes signed source snapshots from observed current versions and origin identity from registry ref/MAC from signature/digest. Server-committed revoke/delete provenance must survive member session invalidation; notification checks remain separate. No final schema or signer.
AI-4 actual local dispatch reuses original public health function and isolated profile handler, validates trusted host/scope/env, default OFF; it is test-support only. Public entrypoint still health-only. Existing 401 vs 503 is unchanged, separate Auth typed outcomes are not silently wired.

## New authorization
Owner now expressly permits AI-0 to complete merges and deployments after appropriate review and verification, and to open replacement AI chats with GitHub handoff. This overrides older blanket operation prohibitions, including historical immutable owner docs; it is not permission to invent release evidence, pay for services or create unspecified true resources. Formal source: https://github.com/starry-phd/id/issues/1#issuecomment-6489238005
Merge/deploy remain centralized with AI-0. No production deployment has occurred. Main is still behind the long 200-commit unmerged development stack; promoting it requires review of full main-relative source/workflows and current deployment mapping. A green isolated integration is not enough to declare all of that reviewed.
G00–G10 11/11 blocked, P05 false, evidence empty. Record operational permission separately from actual release eligibility; do not reset true evidence to hide missing tests.

## Validation / next / rollback
Six new cross-checkout checks: ten blobs; receipt correction; private vocabulary; local Auth/Worker denial; operation vs evidence distinction; original public Worker and official blocked release.
Run new exact-SHA full CI independently, not aggregate separate owner successes.
Next priority: review main-relative promotion scope and deployment wiring, then integrate typed outcome into a separately versioned local HTTP path without changing immutable prior artifacts. Preserve health-only public routing until verified protected-runtime eligibility.
No new paid/true resources/secrets, no H-Global/Echo; Battery free, Ads off. Rollback: close this Draft/drop its added paths; #250/owner PRs untouched.
