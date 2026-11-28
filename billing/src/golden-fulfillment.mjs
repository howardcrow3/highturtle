// Golden purchase fulfillment, run from transaction.completed. Emails the buyer a signed licence token (core
// purchase and/or Plaid add-on; each monthly add-on renewal is a new transaction and gets a fresh token with a
// later paid-through date). At most once per transaction (its own claim field). Without a signing key the order
// goes to the support inbox and stays replayable from Paddle, so the buyer is never left with nothing.

import { issueGoldenToken, goldenFields } from './golden.mjs';
import { goldenEmail } from './golden-email.mjs';

export function makeGoldenFulfillment({ cfg, store, paddle, sendEmail, log }) {
  const ids = { priceId: cfg.goldenPriceId, plaidPriceId: cfg.goldenPlaidPriceId, plaidYearlyPriceId: cfg.goldenPlaidYearlyPriceId };

  // Whether this customer already bought the app in an earlier completed transaction, so an add-on
  // renewal key keeps unlocking it instead of being a bank-connections-only key.
  async function ownsApp(customerId, thisTxn) {
    if (!customerId || !ids.priceId) return false;
    const rows = await store.listTransactions(customerId);
    return rows.some((t) => t.transaction_id !== thisTxn && t.status === 'completed'
      && (t.items || []).some((i) => i.price_id === ids.priceId));
  }

  return async function onPurchase(txn) {
    if (!ids.priceId && !ids.plaidPriceId && !ids.plaidYearlyPriceId) return;
    const fields = goldenFields(txn, ids);
    if (!fields) return;
    if (!(await store.claimFulfillment(txn.id, new Date(), 'golden_fulfillment'))) {
      log({ golden: 'skip', transaction: txn.id, reason: 'already done or in progress' });
      return;
    }
    try {
      let email = txn.customerId ? (await store.getCustomer(txn.customerId))?.email : null;
      if (!email && txn.customerId) email = (await paddle.customers.get(txn.customerId))?.email;
      if (!email) throw new Error(`no email for customer ${txn.customerId}`);

      if (!cfg.goldenSigningKey) {
        await sendEmail({
          to: cfg.opsEmail,
          subject: `Golden order ${txn.id}: signing key not configured`,
          text: `A Golden order completed but GOLDEN_SIGNING_KEY is not set, so no licence was sent.\n\nBuyer: ${email}\nPaddle transaction: ${txn.id}\n\nRun Billing setup (it creates the key), then redeliver this event from Paddle (Developer tools > Notifications > Logs).`,
        });
        await store.releaseFulfillment(txn.id, 'golden_fulfillment');
        log({ golden: 'blocked-no-signing-key', transaction: txn.id });
        return;
      }

      const core = fields.core > 0 || (await ownsApp(txn.customerId, txn.id));
      const token = await issueGoldenToken(cfg.goldenSigningKey, {
        issued: fields.issued, plaidUntil: fields.plaidUntil, buyer: txn.customerId, core,
      });
      const mail = goldenEmail({ token, site: cfg.site, core: fields.core, ownsApp: core, plaidUntil: fields.plaidUntil, order: txn.invoiceNumber || txn.id });
      await sendEmail({ to: email, subject: mail.subject, text: mail.text, html: mail.html });
      await store.finishFulfillment(txn.id, 'emailed', 'golden_fulfillment');
      log({ golden: 'emailed', transaction: txn.id });
    } catch (err) {
      await store.releaseFulfillment(txn.id, 'golden_fulfillment');
      throw err; // the webhook answers 500 and Paddle retries
    }
  };
}
