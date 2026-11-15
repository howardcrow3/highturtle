import { createHmac } from 'node:crypto';

export const SECRET = 'pdl_ntfset_test_secret';

export function sign(body, secret = SECRET, ts = Math.floor(Date.now() / 1000)) {
  const h1 = createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex');
  return `ts=${ts};h1=${h1}`;
}

export function webhookEvent(body, signature, { base64 = false } = {}) {
  return {
    rawPath: '/api/billing/webhook',
    requestContext: { http: { method: 'POST' } },
    headers: { 'content-type': 'application/json', ...(signature ? { 'paddle-signature': signature } : {}) },
    body: base64 ? Buffer.from(body).toString('base64') : body,
    isBase64Encoded: base64,
  };
}

let n = 0;
const envelope = (type, data, occurred = '2026-11-15T10:00:00.000000Z') => ({
  event_id: `evt_${++n}`,
  notification_id: `ntf_${n}`,
  event_type: type,
  occurred_at: occurred,
  data,
});

export function customerEvent(type, { id = 'ctm_01', email = 'Buyer@Example.com', updated = '2026-11-15T10:00:00.000000Z' } = {}) {
  return envelope(type, {
    id, email, name: 'Buyer', status: 'active', marketing_consent: false, locale: 'en',
    custom_data: null, created_at: '2026-11-15T09:00:00.000000Z', updated_at: updated, import_meta: null,
  });
}

export function subscriptionEvent(type, {
  id = 'sub_01', customer = 'ctm_01', status = 'active', updated = '2026-11-15T10:00:00.000000Z',
  scheduledChange = null, priceId = 'pri_monthly', productId = 'pro_pro',
} = {}) {
  return envelope(type, {
    id, status, customer_id: customer, address_id: 'add_01', business_id: null, currency_code: 'USD',
    created_at: '2026-11-15T09:00:00.000000Z', updated_at: updated, started_at: '2026-11-15T09:00:00.000000Z',
    first_billed_at: '2026-11-15T09:00:00.000000Z', next_billed_at: '2026-12-15T09:00:00.000000Z',
    paused_at: null, canceled_at: status === 'canceled' ? updated : null, discount: null, collection_mode: 'automatic',
    billing_details: null,
    current_billing_period: { starts_at: '2026-11-15T09:00:00.000000Z', ends_at: '2026-12-15T09:00:00.000000Z' },
    billing_cycle: { interval: 'month', frequency: 1 },
    scheduled_change: scheduledChange,
    items: [{
      status: 'active', quantity: 1, recurring: true, created_at: '2026-11-15T09:00:00.000000Z',
      updated_at: updated, previously_billed_at: null, next_billed_at: null, trial_dates: null,
      price: {
        id: priceId, product_id: productId, description: 'Monthly', type: 'standard', name: 'Monthly',
        billing_cycle: { interval: 'month', frequency: 1 }, trial_period: null, tax_mode: 'account_setting',
        unit_price: { amount: '1000', currency_code: 'USD' }, unit_price_overrides: [],
        quantity: { minimum: 1, maximum: 1 }, status: 'active', custom_data: null, import_meta: null,
        created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
      },
      product: null,
    }],
    custom_data: null, import_meta: null,
  });
}

export function transactionCompletedEvent({ id = 'txn_01', customer = 'ctm_01', subscription = null } = {}) {
  return envelope('transaction.completed', {
    id, status: 'completed', customer_id: customer, address_id: 'add_01', business_id: null, custom_data: null,
    currency_code: 'USD', origin: 'web', subscription_id: subscription, invoice_id: 'inv_01',
    invoice_number: '325-10566', collection_mode: 'automatic', discount_id: null, billing_details: null,
    billing_period: null,
    items: [{ price: { id: 'pri_backer', product_id: 'pro_backer', description: 'Backer', type: 'standard', name: 'Backer',
      billing_cycle: null, trial_period: null, tax_mode: 'account_setting', unit_price: { amount: '499', currency_code: 'USD' },
      unit_price_overrides: [], quantity: { minimum: 1, maximum: 1 }, status: 'active', custom_data: null, import_meta: null,
      created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z' }, quantity: 1, proration: null }],
    details: null, payments: [], checkout: null,
    created_at: '2026-11-15T09:59:00.000000Z', updated_at: '2026-11-15T10:00:00.000000Z', billed_at: '2026-11-15T10:00:00.000000Z',
    revised_at: null,
  });
}
