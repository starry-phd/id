# AI-2 Round 6 — Offline Store verification release prerequisites

This document is a Gate checklist, not permission to operate any real service. Source baseline: AI-0 Draft #52 at b4e34c4dc1fc9425e8c2730e7d2421fcbb87d4f0.

## Authoritative queue decision
A missing Billing committed row is an eventual-visibility condition: retry, never ACK, never quarantine. After retry exhaustion only a persistently written DLQ receipt may precede ACK. Audit must not trust a client-sent committed flag or a Billing plan without a post-commit DB read. A later refund event must not overwrite a newer entitlement.

## Apple / x5c / revocation Gate — NOT APPROVED
- Official Apple Root CA bytes and fingerprints must originate from reviewed official PKI material, be stored in server-side pin registry, be rotated under change control, and never be extracted from JWS x5c.
- Validate entire signed X509 leaf/intermediate/root chain; Apple-specific leaf and intermediate extension, ES256/JWS claims, certificate dates, bundle ID, store Sandbox, purchase owner, and exact SKU.
- OCSP verification must check the cryptographic response signature, delegated responder chain, issuer+serial linkage, status good, thisUpdate/nextUpdate freshness, trusted time, responder timeout, revoked/unknown states and appropriate replay/nonce policy. A callback returning only {outcome:'good'} is NOT evidence of official OCSP verification.
- Existing apple-pki-node.mjs is Node-only, with ephemeral self-signed fixture root and stubbed OCSP port; it is NOT compatible proof for Workers Production, approved Apple PKI, or official revocation verification.
- No live Apple API, trust anchor, OCSP, Store sandbox purchase, production entitlement or release approval is configured.

## Google Play authorization Gate — NOT APPROVED
- Obtain short-lived official Google OAuth2 token from server-owned workload identity/service account, scope https://www.googleapis.com/auth/androidpublisher, with least privilege Play Console package access, trusted token issuer/audience, key rotation and credential secrecy.
- Use backend-only bearer to query purchases.subscriptionsv2.get at https://androidpublisher.googleapis.com with fixed Starry package, TLS verification, redirect refusal, timeouts, content-type/JSON limits, and bounded retry/backoff; do not accept a token, SKU, package name or source URL from HTTP client claims.
- The existing google-play-requery.ts implements ONLY an offline injected token/fetch adapter, with mock token and mock response. It cannot attest service account IAM, OAuth exchange, Play Console access, signed RTDN, Google JWKS or a real sandbox purchase.
- Before any real purchase: verify RTDN Pub/Sub JWT origin and claims, requery official Play API independently, ensure package/subscriptionState/expiry/lineItems/testPurchase/token owner, and atomically write Billing owner/event/entitlement/outbox.
- Never mark paid from RTDN payload alone; Store/rights are disabled pending explicit AI-0 Gate.

## Release status
The AI-0 P05 13-field shape remains candidate, PUBLISHABLE=false. G00-G10 = BLOCKED. Never merge main, run live D1/Queues migrations, deploy Workers/EAS, configure secrets, enable real purchases, or spend without a new authorization. Starry Battery remains free; no H-Global shared identity or Billing.
