// Mirror of Paddle customer, subscription and transaction state, in DynamoDB.
//
// Matches the rest of this repo (DynamoDB, us-east-2) instead of Postgres. One table per entity,
// each keyed on the Paddle ID, with the column names from the spec:
//
//   highturtle-billing-customers      customer_id (PK), email, email_lc (GSI "email-index"), ...
//   highturtle-billing-subscriptions  subscription_id (PK), customer_id (GSI "customer-index"),
//                                     status, price_id, product_id, scheduled_change_action,
//                                     scheduled_change_at, ...
//   highturtle-billing-transactions   transaction_id (PK), customer_id, subscription_id, status, ...
//
// Every write is an upsert keyed on the Paddle ID (never a blind insert), so a redelivered event is
// harmless. Deliveries can also arrive out of order, so each row stores `paddle_updated_at`, the
// entity's own updated_at from Paddle, and a write only lands when it is at least as new as what is
// stored. An older event that arrives late is skipped. Nothing in this module deletes anything.

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

// Builds one conditional upsert. Exported so tests can check the exact request.
export function buildUpsert(table, keyName, keyValue, fields, version) {
  const names = { '#pk': keyName, '#v': 'paddle_updated_at', '#created': 'created_at', '#updated': 'updated_at' };
  const values = { ':v': version, ':now': new Date().toISOString() };
  const sets = ['#v = :v', '#updated = :now', '#created = if_not_exists(#created, :now)'];
  const removes = [];
  let i = 0;
  for (const [k, val] of Object.entries(fields)) {
    if (k === keyName) continue;
    const n = `#f${i}`;
    names[n] = k;
    if (val === null || val === undefined) {
      removes.push(n);
    } else {
      values[`:f${i}`] = val;
      sets.push(`${n} = :f${i}`);
    }
    i++;
  }
  let expr = 'SET ' + sets.join(', ');
  if (removes.length) expr += ' REMOVE ' + removes.join(', ');
  return {
    TableName: table,
    Key: { [keyName]: keyValue },
    UpdateExpression: expr,
    ConditionExpression: 'attribute_not_exists(#pk) OR #v <= :v',
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  };
}

export class DynamoStore {
  constructor({ tables, region, client } = {}) {
    this.tables = tables;
    this.db = client || DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  async #upsert(table, keyName, keyValue, fields, version) {
    try {
      await this.db.send(new UpdateCommand(buildUpsert(table, keyName, keyValue, fields, version)));
      return 'applied';
    } catch (err) {
      if (err && err.name === 'ConditionalCheckFailedException') return 'stale';
      throw err;
    }
  }

  upsertCustomer(row, version) {
    return this.#upsert(this.tables.customers, 'customer_id', row.customer_id, row, version);
  }

  upsertSubscription(row, version) {
    return this.#upsert(this.tables.subscriptions, 'subscription_id', row.subscription_id, row, version);
  }

  upsertTransaction(row, version) {
    return this.#upsert(this.tables.transactions, 'transaction_id', row.transaction_id, row, version);
  }

  // One-time fulfillment (for example a Backer license email) runs at most once per transaction.
  // claim -> do the work -> mark done; on failure, release so Paddle's retry can try again.
  // A claim older than 5 minutes is treated as abandoned (the Lambda died mid-way) and can be taken over.
  async claimFulfillment(transactionId, now = new Date()) {
    const stale = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
    try {
      await this.db.send(new UpdateCommand({
        TableName: this.tables.transactions,
        Key: { transaction_id: transactionId },
        UpdateExpression: 'SET fulfillment_status = :c, fulfillment_at = :now',
        ConditionExpression: 'attribute_not_exists(fulfillment_status) OR (fulfillment_status = :c AND fulfillment_at < :stale)',
        ExpressionAttributeValues: { ':c': 'claimed', ':now': now.toISOString(), ':stale': stale },
      }));
      return true;
    } catch (err) {
      if (err && err.name === 'ConditionalCheckFailedException') return false;
      throw err;
    }
  }

  async finishFulfillment(transactionId, status) {
    await this.db.send(new UpdateCommand({
      TableName: this.tables.transactions,
      Key: { transaction_id: transactionId },
      UpdateExpression: 'SET fulfillment_status = :s, fulfillment_at = :now',
      ExpressionAttributeValues: { ':s': status, ':now': new Date().toISOString() },
    }));
  }

  async releaseFulfillment(transactionId) {
    try {
      await this.db.send(new UpdateCommand({
        TableName: this.tables.transactions,
        Key: { transaction_id: transactionId },
        UpdateExpression: 'REMOVE fulfillment_status, fulfillment_at',
        ConditionExpression: 'fulfillment_status = :c',
        ExpressionAttributeValues: { ':c': 'claimed' },
      }));
    } catch (err) {
      if (!(err && err.name === 'ConditionalCheckFailedException')) throw err;
    }
  }

  async getCustomer(customerId) {
    const out = await this.db.send(new GetCommand({ TableName: this.tables.customers, Key: { customer_id: customerId } }));
    return out.Item || null;
  }

  async findCustomerByEmail(email) {
    const out = await this.db.send(new QueryCommand({
      TableName: this.tables.customers,
      IndexName: 'email-index',
      KeyConditionExpression: 'email_lc = :e',
      ExpressionAttributeValues: { ':e': email.trim().toLowerCase() },
      Limit: 2,
    }));
    return (out.Items || [])[0] || null;
  }

  async listSubscriptions(customerId) {
    const out = await this.db.send(new QueryCommand({
      TableName: this.tables.subscriptions,
      IndexName: 'customer-index',
      KeyConditionExpression: 'customer_id = :c',
      ExpressionAttributeValues: { ':c': customerId },
    }));
    return out.Items || [];
  }
}

// Same behaviour as DynamoStore, kept in memory. Used by the tests and for local runs.
export class MemoryStore {
  constructor() {
    this.customers = new Map();
    this.subscriptions = new Map();
    this.transactions = new Map();
  }

  #upsert(map, key, row, version) {
    const existing = map.get(key);
    if (existing && existing.paddle_updated_at > version) return 'stale';
    const now = new Date().toISOString();
    const next = { ...(existing || {}), created_at: existing?.created_at || now };
    for (const [k, v] of Object.entries(row)) {
      if (v === null || v === undefined) delete next[k];
      else next[k] = v;
    }
    next.paddle_updated_at = version;
    next.updated_at = now;
    map.set(key, next);
    return 'applied';
  }

  async upsertCustomer(row, version) { return this.#upsert(this.customers, row.customer_id, row, version); }
  async upsertSubscription(row, version) { return this.#upsert(this.subscriptions, row.subscription_id, row, version); }
  async upsertTransaction(row, version) { return this.#upsert(this.transactions, row.transaction_id, row, version); }
  async getCustomer(id) { return this.customers.get(id) || null; }
  async claimFulfillment(id, now = new Date()) {
    const t = this.transactions.get(id) || { transaction_id: id };
    const stale = now.getTime() - 5 * 60 * 1000;
    if (t.fulfillment_status && !(t.fulfillment_status === 'claimed' && Date.parse(t.fulfillment_at) < stale)) return false;
    this.transactions.set(id, { ...t, fulfillment_status: 'claimed', fulfillment_at: now.toISOString() });
    return true;
  }
  async finishFulfillment(id, status) {
    const t = this.transactions.get(id);
    this.transactions.set(id, { ...t, fulfillment_status: status, fulfillment_at: new Date().toISOString() });
  }
  async releaseFulfillment(id) {
    const t = this.transactions.get(id);
    if (t?.fulfillment_status === 'claimed') { delete t.fulfillment_status; delete t.fulfillment_at; }
  }
  async findCustomerByEmail(email) {
    const e = email.trim().toLowerCase();
    return [...this.customers.values()].find((c) => c.email_lc === e) || null;
  }
  async listSubscriptions(customerId) {
    return [...this.subscriptions.values()].filter((s) => s.customer_id === customerId);
  }
}
