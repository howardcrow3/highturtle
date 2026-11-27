import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, signBody, validate } from '../src/core.mjs';

const KEYS = { backer: 'a'.repeat(64), ceevee: 'b'.repeat(64), golden: 'c'.repeat(64) };
const NOW = Date.UTC(2026, 10, 26, 12, 0, 0);

function setup(opts = {}) {
  const items = [];
  const counters = new Map();
  const claimed = new Set();
  let n = 0;
  const store = {
    async put(item) { items.push(item); },
    async hit(key) { const c = (counters.get(key) || 0) + 1; counters.set(key, c); return c; },
    async claim(key) { if (claimed.has(key)) return false; claimed.add(key); return true; },
  };
  const app = makeApp({ getAppKeys: async () => KEYS, store, now: () => NOW, newId: () => `id-${++n}`, ...opts });
  return { app, items };
}

const post = (body, headers = {}, ip = '1.2.3.4') => ({
  rawPath: '/v1/feedback',
  requestContext: { http: { method: 'POST', sourceIp: ip } },
  headers,
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

const signed = (app, body, { key = KEYS[app], ts = Math.floor(NOW / 1000) } = {}) => {
  const raw = JSON.stringify(body);
  return post(raw, { 'x-ht-app': app, 'x-ht-timestamp': String(ts), 'x-ht-signature': signBody(key, String(ts), raw) });
};

test('a signed app submission is stored with id, timestamp, app, rating and message', async () => {
  const { app, items } = setup();
  const res = await app(signed('backer', { app: 'backer', rating: 4, message: 'Please add scheduled backups', category: 'feature', appVersion: '1.2.0' }));
  assert.equal(res.statusCode, 201);
  const out = JSON.parse(res.body);
  assert.equal(out.id, 'id-1');
  assert.equal(out.createdAt, '2026-11-26T12:00:00.000Z');
  assert.deepEqual(items[0], {
    id: 'id-1', createdAt: '2026-11-26T12:00:00.000Z', app: 'backer', rating: 4, message: 'Please add scheduled backups',
    category: 'feature', appVersion: '1.2.0', source: 'app', status: 'new',
  });
});

test('a request from an allowed website origin is accepted without a signature', async () => {
  const { app, items } = setup();
  const res = await app(post({ app: 'turtlebox-site', rating: 5 }, { origin: 'https://turtlebox.studio' }));
  assert.equal(res.statusCode, 201);
  assert.equal(items[0].source, 'web');
});

test('unsigned requests from other origins, or with no origin, are refused', async () => {
  const { app, items } = setup();
  assert.equal((await app(post({ app: 'backer', rating: 5 }, { origin: 'https://evil.example' }))).statusCode, 403);
  assert.equal((await app(post({ app: 'backer', rating: 5 }))).statusCode, 403);
  assert.equal(items.length, 0);
});

test('bad signature, wrong key, unknown app and stale timestamp are refused', async () => {
  const { app } = setup();
  const body = { app: 'backer', rating: 3 };
  assert.equal((await app(signed('backer', body, { key: KEYS.ceevee }))).statusCode, 401);
  assert.equal((await app(signed('nope', { app: 'backer', rating: 3 }, { key: 'f'.repeat(64) }))).statusCode, 401);
  assert.equal((await app(signed('backer', body, { ts: Math.floor(NOW / 1000) - 600 }))).statusCode, 401);
  const tampered = signed('backer', body);
  tampered.body = JSON.stringify({ app: 'backer', rating: 1 });
  assert.equal((await app(tampered)).statusCode, 401);
});

test('a signature is accepted only once (replay is refused)', async () => {
  const { app } = setup();
  const ev = signed('golden', { app: 'golden', rating: 5 });
  assert.equal((await app(ev)).statusCode, 201);
  assert.equal((await app(ev)).statusCode, 409);
});

test('an app key cannot submit feedback as another app', async () => {
  const { app } = setup();
  assert.equal((await app(signed('backer', { app: 'golden', rating: 5 }))).statusCode, 403);
});

test('per-IP rate limit returns 429 after the hourly allowance', async () => {
  const { app } = setup({ perIpPerHour: 2 });
  const web = () => app(post({ app: 'highturtle-site', rating: 5 }, { origin: 'https://highturtle.com' }));
  assert.equal((await web()).statusCode, 201);
  assert.equal((await web()).statusCode, 201);
  assert.equal((await web()).statusCode, 429);
});

test('honeypot submissions look successful but are not stored', async () => {
  const { app, items } = setup();
  const res = await app(post({ app: 'turtlebox-site', rating: 5, hp: 'http://spam' }, { origin: 'https://turtlebox.studio' }));
  assert.equal(res.statusCode, 201);
  assert.equal(items.length, 0);
});

test('oversized bodies and bad JSON are refused', async () => {
  const { app } = setup();
  assert.equal((await app(post('x'.repeat(17 * 1024), { origin: 'https://turtlebox.studio' }))).statusCode, 413);
  assert.equal((await app(post('{not json', { origin: 'https://turtlebox.studio' }))).statusCode, 400);
});

test('validation rules', () => {
  assert.equal(validate({ app: 'backer' }).ok, false, 'needs rating or message');
  assert.equal(validate({ app: 'backer', rating: 0 }).ok, false);
  assert.equal(validate({ app: 'backer', rating: 6 }).ok, false);
  assert.equal(validate({ app: 'backer', rating: 3.5 }).ok, false);
  assert.equal(validate({ app: 'other', rating: 3 }).ok, false);
  assert.equal(validate({ app: 'backer', message: 'x'.repeat(5001) }).ok, false);
  assert.equal(validate({ app: 'backer', message: 'hi', category: 'bogus' }).ok, false);
  assert.equal(validate({ app: 'backer', message: 'hi', email: 'nope' }).ok, false);
  assert.deepEqual(validate({ app: 'ceevee', message: '  crash on start  ', email: ' a@b.co ' }).item,
    { app: 'ceevee', message: 'crash on start', category: 'other', email: 'a@b.co' });
  assert.deepEqual(validate({ app: 'golden', rating: 5 }).item, { app: 'golden', rating: 5 });
});

test('email is optional and checked on the server', () => {
  for (const bad of ['nope', 'a@b', 'a@b.c', 'a b@c.co', 'a@b..co', '.a@b.co', 'a..b@c.co', 'a@-b.co', 'a\n@b.co', '<a@b.co>', 'a@b@c.co',
    `${'x'.repeat(65)}@b.co`, `a@${'b'.repeat(250)}.co`, 42, true, {}]) {
    assert.equal(validate({ app: 'backer', message: 'hi', email: bad }).ok, false, JSON.stringify(bad));
  }
  for (const good of ['a@b.co', 'first.last+tag@mail.example.com', 'O\'Neil@Example.ORG', 'x_y-z@sub-domain.example.io']) {
    assert.equal(validate({ app: 'backer', message: 'hi', email: good }).item.email, good);
  }
  for (const none of [undefined, null, '', '   ']) assert.equal(validate({ app: 'backer', message: 'hi', email: none }).item.email, undefined);
});

test('anonymous feedback never keeps an email', async () => {
  assert.equal(validate({ app: 'backer', message: 'hi', email: 'a@b.co', anonymous: true }).item.email, undefined);
  assert.equal(validate({ app: 'backer', message: 'hi', email: 'garbage', anonymous: true }).ok, true, 'not checked when dropped');
  assert.equal(validate({ app: 'backer', message: 'hi', email: 'a@b.co', anonymous: false }).item.email, 'a@b.co');
  assert.equal(validate({ app: 'backer', message: 'hi', anonymous: 'yes' }).ok, false);
  const { app, items } = setup();
  const res = await app(signed('golden', { app: 'golden', rating: 3, email: 'me@example.com', anonymous: true }));
  assert.equal(res.statusCode, 201);
  assert.equal('email' in items[0], false);
  assert.equal('anonymous' in items[0], false);
});

test('older app builds that send email without the anonymous flag keep working', async () => {
  const { app, items } = setup();
  const res = await app(signed('ceevee', { app: 'ceevee', message: 'Export to PDF please', email: 'me@example.com' }));
  assert.equal(res.statusCode, 201);
  assert.equal(items[0].email, 'me@example.com');
});

test('health check and unknown routes', async () => {
  const { app } = setup();
  assert.equal((await app({ rawPath: '/v1/health', requestContext: { http: { method: 'GET' } } })).statusCode, 200);
  assert.equal((await app({ rawPath: '/v1/other', requestContext: { http: { method: 'POST' } } })).statusCode, 404);
});

test('the JS client signs exactly as the server verifies', async () => {
  const { app, items } = setup();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const res = await app(post(init.body, init.headers));
    return { ok: res.statusCode < 300, status: res.statusCode, json: async () => JSON.parse(res.body) };
  };
  try {
    const { sendFeedback } = await import('../client/feedback.js');
    const realNow = Date.now;
    Date.now = () => NOW;
    try {
      const out = await sendFeedback({ app: 'ceevee', rating: 2, message: 'Crashes on import', category: 'issue' }, { key: KEYS.ceevee });
      assert.equal(out.id, 'id-1');
      assert.equal(items[0].source, 'app');
    } finally { Date.now = realNow; }
  } finally { globalThis.fetch = realFetch; }
});
