// CeeVee license and trial storage.
//
//   highturtle-ceevee-licenses  license_key (PK), email, email_lc (GSI "email-index"), transaction_id,
//                               seats, major, status, machines (map: machine hash -> {activated_at, ...})
//   highturtle-ceevee-trials    machine (PK), started_at   (first sight of a machine; never overwritten)
//
// Seats are enforced inside one conditional write, so two computers activating at once cannot both
// take the last seat.

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const isCondFail = (err) => err && err.name === 'ConditionalCheckFailedException';

export class CeeveeDynamoStore {
  constructor({ tables, region, client } = {}) {
    this.tables = tables;
    this.db = client || DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  // Creates the license if it does not exist yet. Returns true when created, false if it was already there.
  async createLicense(row) {
    try {
      await this.db.send(new PutCommand({
        TableName: this.tables.ceeveeLicenses,
        Item: { ...row, email_lc: row.email.trim().toLowerCase(), status: 'active', machines: {}, created_at: new Date().toISOString() },
        ConditionExpression: 'attribute_not_exists(license_key)',
      }));
      return true;
    } catch (err) {
      if (isCondFail(err)) return false;
      throw err;
    }
  }

  async getLicense(key) {
    const out = await this.db.send(new GetCommand({ TableName: this.tables.ceeveeLicenses, Key: { license_key: key } }));
    return out.Item || null;
  }

  async findLicensesByEmail(email) {
    const out = await this.db.send(new QueryCommand({
      TableName: this.tables.ceeveeLicenses,
      IndexName: 'email-index',
      KeyConditionExpression: 'email_lc = :e',
      ExpressionAttributeValues: { ':e': email.trim().toLowerCase() },
    }));
    return out.Items || [];
  }

  // 'ok' (seat taken, or this machine already had one), 'full', or 'missing' (unknown or revoked key).
  async activateSeat(key, machine, meta, now = new Date()) {
    try {
      await this.db.send(new UpdateCommand({
        TableName: this.tables.ceeveeLicenses,
        Key: { license_key: key },
        UpdateExpression: 'SET machines.#m = if_not_exists(machines.#m, :info)',
        ConditionExpression: 'attribute_exists(license_key) AND #s = :active AND (attribute_exists(machines.#m) OR size(machines) < seats)',
        ExpressionAttributeNames: { '#m': machine, '#s': 'status' },
        ExpressionAttributeValues: { ':info': { activated_at: now.toISOString(), ...meta }, ':active': 'active' },
      }));
      return 'ok';
    } catch (err) {
      if (!isCondFail(err)) throw err;
      const lic = await this.getLicense(key);
      return lic && lic.status === 'active' ? 'full' : 'missing';
    }
  }

  // 'ok' (seat freed or none was held) or 'missing'.
  async releaseSeat(key, machine) {
    try {
      await this.db.send(new UpdateCommand({
        TableName: this.tables.ceeveeLicenses,
        Key: { license_key: key },
        UpdateExpression: 'REMOVE machines.#m',
        ConditionExpression: 'attribute_exists(license_key)',
        ExpressionAttributeNames: { '#m': machine },
      }));
      return 'ok';
    } catch (err) {
      if (isCondFail(err)) return 'missing';
      throw err;
    }
  }

  async revokeLicense(key) {
    await this.db.send(new UpdateCommand({
      TableName: this.tables.ceeveeLicenses,
      Key: { license_key: key },
      UpdateExpression: 'SET #s = :r, revoked_at = :now',
      ConditionExpression: 'attribute_exists(license_key)',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':r': 'revoked', ':now': new Date().toISOString() },
    }));
  }

  // The first started_at ever recorded for this machine; later calls get the same answer.
  async getOrCreateTrial(machine, now = new Date()) {
    try {
      await this.db.send(new PutCommand({
        TableName: this.tables.ceeveeTrials,
        Item: { machine, started_at: now.toISOString() },
        ConditionExpression: 'attribute_not_exists(machine)',
      }));
      return now.toISOString();
    } catch (err) {
      if (!isCondFail(err)) throw err;
      const out = await this.db.send(new GetCommand({ TableName: this.tables.ceeveeTrials, Key: { machine } }));
      return out.Item.started_at;
    }
  }
}

export class CeeveeMemoryStore {
  constructor() { this.licenses = new Map(); this.trials = new Map(); }

  async createLicense(row) {
    if (this.licenses.has(row.license_key)) return false;
    this.licenses.set(row.license_key, {
      ...row, email_lc: row.email.trim().toLowerCase(), status: 'active', machines: {}, created_at: new Date().toISOString(),
    });
    return true;
  }
  async getLicense(key) { return structuredClone(this.licenses.get(key) || null); }
  async findLicensesByEmail(email) {
    const e = email.trim().toLowerCase();
    return [...this.licenses.values()].filter((l) => l.email_lc === e).map((l) => structuredClone(l));
  }
  async activateSeat(key, machine, meta, now = new Date()) {
    const l = this.licenses.get(key);
    if (!l || l.status !== 'active') return 'missing';
    if (!l.machines[machine]) {
      if (Object.keys(l.machines).length >= l.seats) return 'full';
      l.machines[machine] = { activated_at: now.toISOString(), ...meta };
    }
    return 'ok';
  }
  async releaseSeat(key, machine) {
    const l = this.licenses.get(key);
    if (!l) return 'missing';
    delete l.machines[machine];
    return 'ok';
  }
  async revokeLicense(key) {
    const l = this.licenses.get(key);
    if (l) { l.status = 'revoked'; l.revoked_at = new Date().toISOString(); }
  }
  async getOrCreateTrial(machine, now = new Date()) {
    if (!this.trials.has(machine)) this.trials.set(machine, now.toISOString());
    return this.trials.get(machine);
  }
}
