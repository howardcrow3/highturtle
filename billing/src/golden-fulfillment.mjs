// Golden purchase fulfillment, run from transaction.completed. Emails the buyer a signed licence token (core
// purchase and/or Plaid add-on; each monthly add-on renewal is a new transaction and gets a fresh token with a
// later paid-through date). At most once per transaction (its own claim field). Without a signing key the order
// goes to the support inbox and stays replayable from Paddle, so the buyer is never left with nothing.

import { issueGoldenToken, goldenFields } from './golden.mjs';

export function makeGoldenFulfillment({ cfg, store, paddle, sendEmail, log }) {
  const ids = { priceId: cfg.goldenPriceId, plaidPriceId: cfg.goldenPlaidPriceId };

  return async function onPurchase(txn) {
    if (!ids.priceId && !ids.plaidPriceId) return;
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

      const token = await issueGoldenToken(cfg.goldenSigningKey, {
        issued: fields.issued, plaidUntil: fields.plaidUntil, buyer: txn.customerId,
      });
      const renewal = !fields.core && fields.plaidUntil;
      const lines = [
        renewal
          ? `Your Golden bank-connection add-on is paid through ${fields.plaidUntil}. Paste this new licence key into Golden to keep it active:`
          : 'Thanks for buying Golden. Your licence key:',
        '', token, '',
        'To activate: open Golden, go to the Licence screen, paste the key and choose Activate.',
        'It works offline and covers every 1.x update. Keep this email; you can use the key again on a new computer.',
      ];
      if (!renewal && fields.plaidUntil) lines.push('', `The bank-connection add-on is included through ${fields.plaidUntil}.`);
      lines.push('', `Order: ${txn.invoiceNumber || txn.id} (receipt from Paddle, our Merchant of Record)`, 'Questions: reply to this email.', '', 'Turtlebox');
      await sendEmail({
        to: email,
        subject: renewal ? 'Your Golden bank-connection licence is renewed' : 'Your Golden licence key',
        text: lines.join('\n'),
      });
      await store.finishFulfillment(txn.id, 'emailed', 'golden_fulfillment');
      log({ golden: 'emailed', transaction: txn.id });
    } catch (err) {
      await store.releaseFulfillment(txn.id, 'golden_fulfillment');
      throw err; // the webhook answers 500 and Paddle retries
    }
  };
}
