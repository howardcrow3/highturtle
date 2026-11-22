// Backer one-time purchase fulfillment, run from transaction.completed.
// Emails the buyer a signed Backer license key (one per unit bought). Runs at most once per transaction,
// even though Paddle can deliver the event more than once. If the signing key is not configured yet, the
// order goes to the support inbox instead so a key can be issued by hand; the buyer is never left with nothing.

import { createHash } from 'node:crypto';
import { issueKey, publicKeyHex } from './license.mjs';

// Every unit gets its own key, and so its own 2 computers. The key's "issued day" is not used by the app, so it carries a small
// per-unit offset (from the transaction id and unit number) to make keys differ even for one email on one day.
export function unitDay(txnId, index, today = Math.floor(Date.now() / 86400000)) {
  const h = createHash('sha256').update(`backer-unit|${txnId}|${index}`).digest();
  return today + h.readUInt16BE(0);
}

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

      let problem = '';
      if (!cfg.backerSigningKey) problem = 'the signing key is not configured';
      else if (cfg.backerPublicKey && (await publicKeyHex(cfg.backerSigningKey)) !== cfg.backerPublicKey) {
        problem = `the configured signing key does not match the public key the Backer app trusts (${cfg.backerPublicKey.slice(0, 8)}...), so its keys would be rejected`;
      }
      if (problem) {
        await sendEmail({
          to: cfg.opsEmail,
          subject: `Backer order ${txn.id}: issue a license key by hand`,
          text: `A Backer order completed but ${problem}, so no key was sent.\n\nBuyer: ${email}\nQuantity: ${qty}\nPaddle transaction: ${txn.id}\n\nIssue with: backer-keygen issue ~/backer-signing-key.txt ${email}\nthen email the key to the buyer.\n\nOnce the key is fixed (GitHub secret BACKER_SIGNING_KEY, then run Billing setup), resend this transaction's webhook from Paddle (Developer tools > Notifications > Event log) and the buyer gets the key automatically.`,
        });
        // Leave the order unfulfilled (not 'manual') so replaying the event from Paddle can still deliver the key.
        await store.releaseFulfillment(txn.id);
        log({ fulfillment: 'needs-key', transaction: txn.id, problem });
        return;
      }

      const keys = [];
      for (let i = 0; i < qty; i++) keys.push(await issueKey(cfg.backerSigningKey, email, unitDay(txn.id, i)));
      const plural = keys.length > 1;
      await sendEmail({
        to: email,
        subject: plural ? 'Your Backer license keys' : 'Your Backer license key',
        text: `Thanks for buying Backer.\n\nYour license key${plural ? 's' : ''}:\n\n${keys.join('\n\n')}\n\nTo turn it on: open Backer, go to Settings, then License, paste the key and click Activate.\nThe key is tied to ${email}, covers all 1.x versions and works on up to ${cfg.backerSeats || 2} computers at once. To move it to a new computer, choose Deactivate in Settings, License on the old one, or free a computer at ${cfg.site}/account/.\n\nDownload Backer: ${cfg.site}/backer/\nOrder: ${txn.invoiceNumber || txn.id} (receipt from Paddle, our Merchant of Record)\nQuestions: reply to this email.\n\nTurtlebox`,
      });
      await store.finishFulfillment(txn.id, 'emailed', 'fulfillment', { license_keys: keys });
      log({ fulfillment: 'emailed', transaction: txn.id, keys: keys.length });
    } catch (err) {
      await store.releaseFulfillment(txn.id);
      throw err; // the webhook answers 500 and Paddle retries
    }
  };
}
