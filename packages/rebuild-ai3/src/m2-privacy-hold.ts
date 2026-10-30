/** AI-3 M2 policy HOLD boundary. Starry only; no live execution or authority.
 * Implements the 2026-10-30 owner decisions pending Q104/Q119/legal review.
 * This is NOT a Battery grant, erasure, audit, or PITR adapter.
 * Never wire its result to a privileged mutation as authorization.
 */
export const M2_PRIVACY_LIVE_ENABLED = false as const;
export type UnapprovedPrivacyAction =
  | 'battery_first_gift'
  | 'retain_cross_account_dedupe_identifier'
  | 'pitr_snapshot_restore'
  | 'erase_with_unapproved_retention_plan';
export type PrivacyHold = Readonly<{
  action: UnapprovedPrivacyAction;
  status: 'pending_eligibility' | 'blocked_pending_approval';
  may_execute: false;
  may_grant_battery: false;
  may_retain_identifier: false;
  may_restore: false;
  may_erase_without_approved_plan: false;
  live_enabled: false;
}>;
const valid = new Set<UnapprovedPrivacyAction>([
  'battery_first_gift', 'retain_cross_account_dedupe_identifier',
  'pitr_snapshot_restore', 'erase_with_unapproved_retention_plan',
]);
/** Never reads caller proofs or injected ports. There is no positive execution path. */
export function holdUnapprovedPrivacyAction(action: unknown): PrivacyHold {
  if (typeof action !== 'string' || !valid.has(action as UnapprovedPrivacyAction))
    throw new Error('AI3_PRIVACY_ACTION_DENIED');
  return Object.freeze({
    action: action as UnapprovedPrivacyAction,
    status: action === 'battery_first_gift'
      ? 'pending_eligibility' as const
      : 'blocked_pending_approval' as const,
    may_execute: false as const,
    may_grant_battery: false as const,
    may_retain_identifier: false as const,
    may_restore: false as const,
    may_erase_without_approved_plan: false as const,
    live_enabled: M2_PRIVACY_LIVE_ENABLED,
  });
}
