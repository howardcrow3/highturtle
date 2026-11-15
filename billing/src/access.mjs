// Decides whether a mirrored subscription currently grants paid access.
//
// Rules:
//   active, trialing  -> access
//   past_due          -> access while Paddle retries the payment (policy "grant", the default),
//                        or no access with policy "deny"
//   paused, canceled  -> no access
//   anything else     -> no access
//
// A scheduled_change (a cancel or pause booked for the end of the billing period) never revokes
// access by itself. The customer has paid through the period; access ends when Paddle actually
// moves the status to canceled or paused and sends subscription.updated / subscription.canceled.

export const ACCESS_STATUSES = new Set(['active', 'trialing']);

export function subscriptionGrantsAccess(subscription, { pastDuePolicy = 'grant' } = {}) {
  if (!subscription) return false;
  const status = subscription.status;
  if (ACCESS_STATUSES.has(status)) return true;
  if (status === 'past_due') return pastDuePolicy === 'grant';
  return false;
}

// True when any of the customer's subscriptions grants access. Pass productIds to require that
// the granting subscription includes one of those products (useful once there are several tiers).
export function anySubscriptionGrantsAccess(subscriptions, { pastDuePolicy = 'grant', productIds } = {}) {
  return subscriptions.some((s) => {
    if (!subscriptionGrantsAccess(s, { pastDuePolicy })) return false;
    if (!productIds || productIds.length === 0) return true;
    const owned = new Set([s.product_id, ...(s.items || []).map((i) => i.product_id)]);
    return productIds.some((p) => owned.has(p));
  });
}
