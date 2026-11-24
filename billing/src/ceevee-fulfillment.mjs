// CeeVee one-time purchase fulfillment, run from transaction.completed (after the Backer hook).
// Creates one license per unit bought and emails the key plus an Activate button (ceevee-email.mjs; the button opens an https page that hands the key to ceevee://activate). At most once per
// transaction (its own claim field, so it never collides with Backer). Keys are derived from the transaction,
// so a retry after a half-finished run re-sends the same key. Without a signing key the order goes to the
// support inbox instead, and the buyer is never left with nothing.

import { deriveKey } from './ceevee.mjs';
import { ceeveeEmail } from './ceevee-email.mjs';

export function makeCeeveeFulfillment({ cfg, store, ceevee, paddle, sendEmail, log }) {
  const priceIds = new Set(cfg.ceeveePriceIds || []);

  return async function onPurchase(txn) {
    if (priceIds.size === 0) return;
    const qty = (txn.items || [])
      .filter((i) => priceIds.has(i.price?.id))
      .reduce((n, i) => n + (i.quantity || 1), 0);
    if (qty === 0) return;

    if (!(await store.claimFulfillment(txn.id, new Date(), 'ceevee_fulfillment'))) {
      log({ ceevee: 'skip', transaction: txn.id, reason: 'already done or in progress' });
      return;
    }
    try {
      let email = txn.customerId ? (await store.getCustomer(txn.customerId))?.email : null;
      if (!email && txn.customerId) email = (await paddle.customers.get(txn.customerId))?.email;
      if (!email) throw new Error(`no email for customer ${txn.customerId}`);

      if (!cfg.ceeveeSigningKey) {
        await sendEmail({
          to: cfg.opsEmail,
          subject: `CeeVee order ${txn.id}: signing key not configured`,
          text: `A CeeVee order completed but CEEVEE_SIGNING_KEY is not set, so no key was created or sent.\n\nBuyer: ${email}\nQuantity: ${qty}\nPaddle transaction: ${txn.id}\n\nSet the key in the highturtle/billing secret, then redeliver this event from Paddle (Developer tools > Notifications > Logs).`,
        });
        await store.releaseFulfillment(txn.id, 'ceevee_fulfillment');
        log({ ceevee: 'blocked-no-signing-key', transaction: txn.id });
        return;
      }

      const keys = [];
      for (let i = 0; i < qty; i++) {
        const key = deriveKey(cfg.ceeveeSigningKey, txn.id, i);
        await ceevee.createLicense({
          license_key: key, email, transaction_id: txn.id, seats: cfg.ceeveeSeats, major: cfg.ceeveeMajor,
        });
        keys.push(key);
      }
      const mail = ceeveeEmail({ keys, site: cfg.site, seats: cfg.ceeveeSeats, order: txn.invoiceNumber || txn.id });
      await sendEmail({ to: email, subject: mail.subject, text: mail.text, html: mail.html });
      await store.finishFulfillment(txn.id, 'emailed', 'ceevee_fulfillment');
      log({ ceevee: 'emailed', transaction: txn.id, keys: keys.length });
    } catch (err) {
      await store.releaseFulfillment(txn.id, 'ceevee_fulfillment');
      throw err; // the webhook answers 500 and Paddle retries
    }
  };
}

// A full refund cancels the license made for that transaction: it can no longer be activated (activate answers
// unknown_key) and its seats can't be re-taken. Computers already activated keep working offline until
// they next check; the app never phones home for a running license. Partial refunds change nothing.
// Keys are derived from the transaction, so no lookup table is needed.
export function makeCeeveeRefund({ cfg, ceevee, log }) {
  return async function onRefund(adj) {
    if (!cfg.ceeveeSigningKey || !adj?.transactionId) return 0;
    if (adj.action !== 'refund' || adj.type !== 'full' || adj.status !== 'approved') return 0;
    let revoked = 0;
    for (let i = 0; i < 10; i++) {
      const key = deriveKey(cfg.ceeveeSigningKey, adj.transactionId, i);
      const lic = await ceevee.getLicense(key);
      if (!lic) break;
      if (lic.status !== 'revoked') { await ceevee.revokeLicense(key); revoked++; }
    }
    if (revoked) log({ ceevee: 'revoked after refund', transaction: adj.transactionId, keys: revoked });
    return revoked;
  };
}
