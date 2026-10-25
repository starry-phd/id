# Starry ID GitHub Automation — Setup and Verification Runbook
> Status: staged automation configuration, NOT an assertion of four live background AI workers.
> Code owner: starry-phd/id. GitHub login: yukidu. Starry-only. H-Global is PAUSED.

## Evidence observed 2026-10-26 (UTC+8)
- ChatGPT Codex Connector installed for starry-phd with repository_selection=all (existing installation).
- Repository is PUBLIC, default branch main, initially unprotected, no repository rulesets, no previous GitHub Actions runs or PRs.
- Existing docs and AI-0 ... AI-4 Issues #1 ... #5; future member API reserved (disabled) in #6.
- A separate Starry Cloudflare connection for starry.phd@gmail.com exists; the yukidu Cloudflare account is different. Deployment credentials have NOT been supplied or verified.
- Team billing is user-reported, NOT independently audited.

## What this PR actually configures
1. starry-ci.yml: automatically checks PRs/pushes to main for documented public-repo rules; real app TypeScript/lint/tests run only AFTER AI-4 adds a root package-lock.json and mandatory scripts. A PASS before then is only a policy PASS, not application CI.
2. starry-agent.yml: official OpenAI Codex Action; trusted yukidu may dispatch AI-1..AI-4 singly or ALL serially. Each reads its existing GitHub Issue, works in a dedicated branch, creates a DRAFT PR, posts the PR link and SHA back to GitHub Issue. No background work without an explicit workflow trigger. API requests are independently billed.
3. starry-deploy.yml: optional automatic STAGING deploy only after main CI success, STARRY_STAGING_ENABLED=true and Starry Cloudflare secrets configured. PRODUCTION requires protected environment, explicit workflow_dispatch + confirmation phrase.
4. No workflow merges PRs, approves itself, modifies H-Global, creates DB automatically, or runs payment in production.

## Required GitHub UI settings (NOT writable by current ChatGPT GitHub connector)
- Open https://github.com/organizations/starry-phd/settings/actions and check Actions -> General.
  - Permit vetted required actions: actions/checkout, actions/setup-node, openai/codex-action. Avoid allowing arbitrary untrusted actions if a narrow allowlist can work.
  - Keep default GITHUB_TOKEN permission at 'Read repository contents and packages'; workflows request granular scopes explicitly.
  - To let workflow-created DRAFT PRs work, enable 'Allow GitHub Actions to create and approve pull requests'. The workflow does not actually submit approving reviews.
  - Do NOT enable permissive fork PR workflows, self-hosted runners with sensitive files, or pull_request_target workflows.
- Open https://github.com/starry-phd/id/settings/rules and add an ENABLED branch ruleset targeting exact main:
  - Require a PR before merge, require CI checks and block force pushes/deletion.
  - Initially require 'Repository policy'; AFTER AI-4 adds the app scaffold and tests, also require 'App typecheck, lint and tests'.
  - For one-person repos, do NOT set an impossible second-human approval requirement; review and merge decisions remain yukidu's responsibility.
  - Do not add broad bypass actors or permit AI to bypass main protection.
- Consider GitHub secret scanning and push protection if available at repository settings; never assume a Public repo means secrets are okay.
- Restrict ChatGPT Codex Connector installation from All repositories to Only selected -> id if future repos should not inherit write access: https://github.com/organizations/starry-phd/settings/installations/175255031
- Enable MFA for yukidu before mandating 2FA organization-wide to avoid locking out the sole owner.

## Required GitHub secrets, variables and environments
- For OPENAI/CODEX: GitHub Repository Settings -> Secrets and variables -> Actions -> New repository secret -> OPENAI_API_KEY. This is a separately billed OpenAI PLATFORM key, not included in ChatGPT Plus or GitHub Team. Set API billing budget and limits in the API provider first. Never add API key to public code or GitHub Issues.
- Do not run the Starry Codex agent workflow without valid secret, team billing budget, and GitHub Actions PR-creation setting. Choose workflow 'Starry Codex agent (controlled)' -> Run workflow -> 'AI-1', 'AI-2', 'AI-3', 'AI-4' or 'ALL' on main. ALL runs sequentially to limit concurrency.
- Create GitHub Environments 'staging' and 'production' under Repository Settings -> Environments. Set deployment branch to main only, prevent self-bypass when supported, and configure required reviewers for production if a separate reviewer is actually available. With one human, only explicit dispatch/confirmation is assured; required second approver may make deployment impossible.
- Add environment secrets CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID for the correct Starry Cloudflare account ONLY. Scope token narrowly to Worker deployment; add D1 access separately only if really needed. NEVER reuse H-Global credentials.
- AI-4 must create root package.json, package-lock.json with scripts 'typecheck', 'lint', 'test', Wrangler dependency and apps/api/wrangler.toml with separate staging/production environments before enabling deploy.
- After all previous checks and Staging dry run, set repository Actions variable STARRY_STAGING_ENABLED=true. Default absence/false means no automatic deploy.
- Keep production deployment human-gated; do not unlock live deployment just to claim 'full automation'.

## Verification acceptance
- [ ] Branch ruleset displayed ENFORCED and main protected
- [ ] CI 'Repository policy' check passes on PR
- [ ] AI-4 adds real app scaffold -> App typecheck/lint/tests check becomes active and passes
- [ ] OPENAI_API_KEY verified and budget set; single AI-4 workflow_dispatch produces dedicated Draft PR and issue handoff
- [ ] H-Global has no writes or deployments; future cross-brand API remains DISABLED
- [ ] Correct Starry-only Cloudflare account and Staging environment verified
- [ ] Staging runs after successful main CI only when enabled
- [ ] Production requires explicit dispatch and approved environment

## Important limits
- The GitHub connector used to author this PR can write repository contents/Issues/PRs, but does not expose administrative org settings, ruleset creation, GitHub Actions secrets, environments or billing budget controls.
- A GitHub Issue, a ChatGPT connection, and the Codex Connector do NOT themselves start four continuous agents. This workflow can run real Codex agents when trusted actor triggers it, GitHub allows it, and the separately-billed API secret exists.
- GitHub Actions on PUBLIC standard hosted runners generally do not consume included private-repo minutes, but OpenAI API, Cloudflare Workers, Expo EAS Build, and other services have independent pricing.
- As with any public CI, review third-party action versions, permissions and workflow changes carefully.
