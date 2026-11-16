// Typed handlers for verified Paddle events. Each turns the event's entity into a row and upserts it.
// Event types without a handler are acknowledged and ignored.

export function customerRow(c) {
  return {
    customer_id: c.id,
    email: c.email,
    email_lc: (c.email || '').trim().toLowerCase(),
    name: c.name ?? null,
    status: c.status,
    paddle_created_at: c.createdAt,
  };
}

export function subscriptionRow(s) {
  const items = (s.items || []).map((i) => ({
    price_id: i.price?.id ?? null,
    product_id: i.price?.productId ?? i.product?.id ?? null,
    quantity: i.quantity,
    status: i.status,
  }));
  // The spec's single price_id / product_id columns hold the first item. All items are kept in `items`.
  const first = items[0] || {};
  return {
    subscription_id: s.id,
    customer_id: s.customerId,
    status: s.status,
    price_id: first.price_id ?? 'unknown',
    product_id: first.product_id ?? 'unknown',
    items,
    scheduled_change_action: s.scheduledChange?.action ?? null,
    scheduled_change_at: s.scheduledChange?.effectiveAt ?? null,
    next_billed_at: s.nextBilledAt ?? null,
    current_period_ends_at: s.currentBillingPeriod?.endsAt ?? null,
    canceled_at: s.canceledAt ?? null,
    paused_at: s.pausedAt ?? null,
    paddle_created_at: s.createdAt,
  };
}

export function transactionRow(t) {
  return {
    transaction_id: t.id,
    customer_id: t.customerId ?? null,
    subscription_id: t.subscriptionId ?? null,
    status: t.status,
    origin: t.origin,
    currency_code: t.currencyCode,
    total: t.details?.totals?.grandTotal ?? null, // minor units, as a string
    invoice_number: t.invoiceNumber ?? null,
    items: (t.items || []).map((i) => ({
      price_id: i.price?.id ?? null,
      product_id: i.price?.productId ?? null,
      quantity: i.quantity,
    })),
    billed_at: t.billedAt ?? null,
    paddle_created_at: t.createdAt,
  };
}

const versionOf = (event) => event.data?.updatedAt || event.occurredAt;

async function onCustomer(event, { store, log }) {
  const result = await store.upsertCustomer(customerRow(event.data), versionOf(event));
  log({ event: event.eventType, id: event.data.id, result });
  return result;
}

async function onSubscription(event, { store, log }) {
  const result = await store.upsertSubscription(subscriptionRow(event.data), versionOf(event));
  log({ event: event.eventType, id: event.data.id, status: event.data.status, result });
  return result;
}

async function onTransactionCompleted(event, { store, log, onPurchase }) {
  const result = await store.upsertTransaction(transactionRow(event.data), versionOf(event));
  log({ event: event.eventType, id: event.data.id, result });
  // Hook for one-time purchases (for example, emailing a Backer license key). Runs on every
  // delivery, so whatever it does must itself be idempotent, keyed on the transaction ID.
  if (onPurchase) await onPurchase(event.data);
  return result;
}

async function onAdjustment(event, { log, onRefund }) {
  const revoked = onRefund ? await onRefund(event.data) : 0;
  log({ event: event.eventType, id: event.data.id, revoked });
  return revoked ? 'revoked' : 'ok';
}

export const HANDLERS = {
  'adjustment.created': onAdjustment,
  'adjustment.updated': onAdjustment,
  'customer.created': onCustomer,
  'customer.updated': onCustomer,
  'subscription.created': onSubscription,
  'subscription.updated': onSubscription,
  'subscription.canceled': onSubscription,
  'transaction.completed': onTransactionCompleted,
};

export async function routeEvent(event, ctx) {
  const handler = HANDLERS[event.eventType];
  if (!handler) {
    ctx.log({ event: event.eventType, id: event.eventId, result: 'ignored' });
    return 'ignored';
  }
  return handler(event, ctx);
}
