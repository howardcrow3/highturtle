// Lambda entry point (Node 22; the AWS SDK v3 ships with the runtime, so nothing is bundled).
import { DynamoDBClient, PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { makeApp, DEFAULT_ORIGINS } from './core.mjs';

const ddb = new DynamoDBClient({});

// Feedback items hold only strings and whole numbers.
const marshall = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)
  .map(([k, v]) => [k, typeof v === 'number' ? { N: String(v) } : { S: String(v) }]));
const TABLE = process.env.FEEDBACK_TABLE;
const LIMITS_TABLE = process.env.LIMITS_TABLE;

const store = {
  async put(item) {
    await ddb.send(new PutItemCommand({
      TableName: TABLE,
      Item: marshall(item),
      ConditionExpression: 'attribute_not_exists(id)',
    }));
  },
  async hit(key, ttlSec) {
    const out = await ddb.send(new UpdateItemCommand({
      TableName: LIMITS_TABLE,
      Key: { pk: { S: key } },
      UpdateExpression: 'ADD n :one SET expiresAt = if_not_exists(expiresAt, :exp)',
      ExpressionAttributeValues: { ':one': { N: '1' }, ':exp': { N: String(Math.floor(Date.now() / 1000) + ttlSec) } },
      ReturnValues: 'UPDATED_NEW',
    }));
    return Number(out.Attributes.n.N);
  },
  async claim(key, ttlSec) {
    try {
      await ddb.send(new PutItemCommand({
        TableName: LIMITS_TABLE,
        Item: { pk: { S: key }, expiresAt: { N: String(Math.floor(Date.now() / 1000) + ttlSec) } },
        ConditionExpression: 'attribute_not_exists(pk)',
      }));
      return true;
    } catch (e) {
      if (e.name === 'ConditionalCheckFailedException') return false;
      throw e;
    }
  },
};

const origins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_ORIGINS;
// Abuse switch: BLOCKED_INSTALLS is a comma-separated list of install ids (public keys) to refuse.
const blockedInstalls = new Set((process.env.BLOCKED_INSTALLS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
const app = makeApp({ store, origins, blockedInstalls });

export const handler = async (event) => {
  try {
    return await app(event);
  } catch (e) {
    console.error('feedback error', e);
    return { statusCode: 500, headers: { 'content-type': 'application/json' }, body: '{"error":"server error"}' };
  }
};
