# AI-4 Wave1 Round-004: Google AdMob Mediation Future AdsCore / Offline Gate

State: DRAFT, ADS OFF, NO SDK, NO NETWORK, NO DEPLOY. Authority: AI-0 Issue #1 comment 6473979811 and AI-4 #5 comment 6474004855. Owner approval Q4=A supersedes Q4=D. Reference AI-0 Q4 decision Draft #202 (exact SHA eee3de052f9fc9fb9bc5337fb14e15230687c10b) and original Google v1.3; neither is merged into this isolated Owner branch.

## Deliverables and ownership
- AI-4 new TypeScript type-only future AdsCore and AdMobMediation ports, explicit blocked defaults and offline review. All results deny SDK initialization, Ad Requests, Ad Units, account creation, paid resources, entitlement changes, release and deployment.
- Synthetic negative tests deny cross-App remove-ads, alternative provider, production, imported callbacks and forged owner/consent flags; preserve Round-003 protected OpenAPI and P05 queue fail-closed parity.
- One App's remove-ads entitlement never unlocks another App. AI-2 remains sole Billing entitlement authority. No AdMob SDK dependency, real app/unit ID, test ad traffic, native build, AdMob account, personal data or secrets.
- AdMob category / advertiser exclusions are a future owner action in the official AdMob management interface; do not promise perfect filtering or create a custom synchronized category administration UI.

## Activation preflight for a FUTURE separately approved consumer App
1. Owner separately approves per-App ad enablement, ad formats/placements, disable switch, privacy policy, cost ceilings and official AdMob exclusions. Provider selection alone is not activation authorization.
2. On actual consumer App kickoff, verify current stable Expo/RN, latest supported native Google Mobile Ads / Mediation plugin and transitive dependencies; validate iOS and Android development builds on actual devices, not Expo Go. Central current Expo54 is NOT upgraded; Q5 private consumer Monorepo remains deferred.
3. Audit Google UMP consent, EU/UK region requirements, Apple ATT and privacy manifests, app-store privacy declarations, Google Play Data Safety, audience age and family policies; confirm user consent, privacy defaults and SDK initialization order using then-current official docs.
4. If independently authorized, use official test IDs in sandbox only; validate denied/no consent, child users, region restrictions, offline mode, per-App remove-ads rights, cross-App switching and error/rollback paths. Never run actual ads from this PR.
5. Confirm scoped App ID/ad units, release tracking, crash monitoring, data minimization, verified entitlement owner, forecast versus actual bill, per-App metrics, kill switch, stop/rollback plan and explicit cost approval before real SDK/ad traffic.
6. A dedicated Owner/AI-0 Gate plus genuine native, consent, store and financial evidence is required before any future SDK install, real ad request or Store submit.

## Existing Gate and Cloudflare read-only RCA
- AI-4 Round-003 PR #201 is the direct parent; it remains OPEN/DRAFT, preserving real Worker GET /v1/health, 3 unregistered protected POST proposals and P05 future Queue ACK interfaces. This Round-004 source does not create any actual protected route or ACK.
- AI-0 R002 four-owner integrated #197 exact 4215bb23bacb709fe3a659a443782032e2a1d5fe; AI-0 R003 four-owner SAME-SHA integration still pending when work starts. R003 Owner-only CI green is not integrated Gate.
- External Cloudflare Workers Builds id-starry FAILED due to missing previews block for npx wrangler preview. AI-0 selected OPTION A: leave watched trigger unchanged. Any isolated repair needs a separate approved Worker, branch, Access, binding, cost and rollback design. No Cloudflare configuration is altered here.
- Gate1 PARTIAL/BLOCKED. Gate3 G00-G10 11/11 BLOCKED. P05/PUBLISHABLE=false and release_authorization.granted=false. Ads OFF; Battery permanently free; H-Global / external products excluded.

## Repro and rollback
- Only 3 NEW AI-4 owned files; unchanged existing Worker, OpenAPI, Billing, Auth, Battery, database, CI, package manager, Expo, Cloudflare and main. Run existing repo same-SHA strict TS, lint, full offline tests, SQLite memory tests, Worker dry-run and formal assert-blocked release.
- Rollback: close this Draft and remove only the 3 new paths. Parent AI-4 R003 #201 and AI-0 R002 #197 stay intact. No live state or fees to revert.
