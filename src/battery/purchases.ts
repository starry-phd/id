import type { RcEvent } from '../billing/revenuecat';
import { creditPurchase, reversePurchase } from './quantum';

/**
 * RevenueCat → Quantum Battery. A one-time (consumable) purchase of a product the Owner mapped to units credits that
 * App's Quantum Battery once per store transaction; a refund through customer support takes the units back.
 * Every step is idempotent, so a redelivered or retried event changes nothing twice.
 */
export function quantumHook(db: D1Database, now: number): (appId: string, event: RcEvent) => Promise<void> {
  return async (appId, event) => {
    const ref = event.transactionId ?? event.id;
    if (event.type === 'NON_RENEWING_PURCHASE' && event.productId && event.appUserId) {
      await creditPurchase(db, { userId: event.appUserId, appId, productId: event.productId, ref }, now);
    } else if (event.type === 'CANCELLATION' && event.cancelReason === 'CUSTOMER_SUPPORT' && event.transactionId) {
      await reversePurchase(db, { appId, ref: event.transactionId }, now);
    }
  };
}
