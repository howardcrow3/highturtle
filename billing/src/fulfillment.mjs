// Backer one-time purchase fulfillment, run from transaction.completed.
// Emails the buyer a signed Backer license key (one per unit bought). Runs at most once per transaction,
// even though Paddle can deliver the event more than once. If the signing key is not configured yet, the
// order goes to the support inbox instead so a key can be issued by hand; the buyer is never left with nothing.

import { issueKey } from './license.mjs';

export function makeBackerFulfillment({ cfg, store, paddle, sendEmail, log }) {
  const priceIds = new Set(cfg.backerPriceIds || []);

  return async function onPurchase(txn) {
    if (priceIds.size === 0) return;
    const qty = (txn.items || [])
      .filter((i) => priceIds.has(i.price?.id))
      .reduce((n, i) => n + (i.quantity || 1), 0);
    if (qty === 0) return;

    if (!(await store.claimFulfillment(txn.id))) {
      log({ fulfillment: 'skip', transaction: txn.id, reason: 'already done or in progress' });
      return;
    }
    try {
      let email = txn.customerId ? (await store.getCustomer(txn.customerId))?.email : null;
      if (!email && txn.customerId) email = (await paddle.customers.get(txn.customerId))?.email;
      if (!email) throw new Error(`no email for customer ${txn.customerId}`);

      if (!cfg.backerSigningKey) {
        await sendEmail({
          to: cfg.opsEmail,
          subject: `Backer order ${txn.id}: issue a license key by hand`,
          text: `A Backer order completed but the signing key is not configured, so no key was sent.\n\nBuyer: ${email}\nQuantity: ${qty}\nPaddle transaction: ${txn.id}\n\nIssue with: backer-keygen issue ~/backer-signing-key.txt ${email}\nthen email the key to the buyer.`,
        });
        await store.finishFulfillment(txn.id, 'manual');
        log({ fulfillment: 'manual', transaction: txn.id });
        return;
      }

      const keys = [];
      for (let i = 0; i < qty; i++) keys.push(await issueKey(cfg.backerSigningKey, email));
      const plural = keys.length > 1;
      await sendEmail({
        to: email,
        subject: plural ? 'Your Backer license keys' : 'Your Backer license key',
        text: `Thanks for buying Backer.\n\nYour license key${plural ? 's' : ''}:\n\n${keys.join('\n\n')}\n\nTo turn it on: open Backer, go to Settings, then License, paste the key and click Activate.\nThe key is tied to ${email} and covers all 1.x versions.\n\nDownload Backer: ${cfg.site}/backer/\nOrder: ${txn.invoiceNumber || txn.id} (receipt from Paddle, our Merchant of Record)\nQuestions: reply to this email.\n\nTurtlebox`,
      });
      await store.finishFulfillment(txn.id, 'emailed', 'fulfillment', { license_keys: keys });
      log({ fulfillment: 'emailed', transaction: txn.id, keys: keys.length });
    } catch (err) {
      await store.releaseFulfillment(txn.id);
      throw err; // the webhook answers 500 and Paddle retries
    }
  };
}
