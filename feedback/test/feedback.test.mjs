import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sign as edSign, createPrivateKey, createPublicKey } from 'node:crypto';
import { makeApp, validate, verifyInstall } from '../src/core.mjs';

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
  const app = makeApp({ store, now: () => NOW, newId: () => `id-${++n}`, ...opts });
  return { app, items };
}

const post = (body, headers = {}, ip = '1.2.3.4') => ({
  rawPath: '/v1/feedback',
  requestContext: { http: { method: 'POST', sourceIp: ip } },
  headers,
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

// Apps sign with per-install Ed25519 keys (helpers defined near the bottom).
const SEEDS = { backer: 1, ceevee: 2, golden: 3 };
const signed = (app, body, opts = {}) => installSigned(app, body, { k: installKey(SEEDS[app] || 9), name: app, ...opts });

test('a signed app submission is stored with id, timestamp, app, rating and message', async () => {
  const { app, items } = setup();
  const res = await app(signed('backer', { app: 'backer', rating: 4, message: 'Please add scheduled backups', category: 'feature', appVersion: '1.2.0' }));
  assert.equal(res.statusCode, 201);
  const out = JSON.parse(res.body);
  assert.equal(out.id, 'id-1');
  assert.equal(out.createdAt, '2026-11-26T12:00:00.000Z');
  assert.deepEqual(items[0], {
    id: 'id-1', createdAt: '2026-11-26T12:00:00.000Z', app: 'backer', rating: 4, message: 'Please add scheduled backups',
    category: 'feature', appVersion: '1.2.0', installId: installKey(1).pub, source: 'app', status: 'new',
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

test('the JS website client posts what the server accepts', async () => {
  const { app, items } = setup();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const res = await app(post(init.body, init.headers));
    return { ok: res.statusCode < 300, status: res.statusCode, json: async () => JSON.parse(res.body) };
  };
  try {
    const { sendFeedback } = await import('../client/feedback.js');
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (u, init) => origFetch(u, { ...init, headers: { ...init.headers, origin: 'https://turtlebox.studio' } });
    const out = await sendFeedback({ app: 'turtlebox-site', rating: 2, message: 'Crashes on import', category: 'issue' });
    assert.equal(out.id, 'id-1');
    assert.equal(items[0].source, 'web');
  } finally { globalThis.fetch = realFetch; }
});

// ---- Per-install Ed25519 keys ----
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const installKey = (seedByte = 7) => {
  const priv = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.alloc(32, seedByte)]), format: 'der', type: 'pkcs8' });
  const pub = createPublicKey(priv).export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
  return { priv, pub };
};
const installSigned = (app, body, { k = installKey(), ts = Math.floor(NOW / 1000), name = body.app } = {}) => {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const sig = edSign(null, Buffer.from(`${name}.${k.pub}.${ts}.${raw}`), k.priv).toString('hex');
  return post(raw, { 'x-ht-app': name, 'x-ht-install': k.pub, 'x-ht-timestamp': String(ts), 'x-ht-signature': sig });
};

test('the app test vector verifies (seed 07 x32, ts 1795694400)', () => {
  const k = installKey(7);
  const raw = '{"app":"ceevee","rating":5}';
  const sig = edSign(null, Buffer.from(`ceevee.${k.pub}.1795694400.${raw}`), k.priv).toString('hex');
  assert.equal(verifyInstall('ceevee', k.pub, '1795694400', raw, sig), true);
  assert.equal(verifyInstall('ceevee', k.pub, '1795694400', raw + ' ', sig), false);
});

test('an install-signed submission is stored with its install id', async () => {
  const { app, items } = setup();
  const k = installKey();
  const res = await app(installSigned('ceevee', { app: 'ceevee', rating: 5, message: 'Love it' }, { k }));
  assert.equal(res.statusCode, 201);
  assert.equal(items[0].installId, k.pub);
  assert.equal(items[0].source, 'app');
});

test('install requests: tampered body, wrong key, stale timestamp, bad shapes are refused', async () => {
  const { app, items } = setup();
  const body = { app: 'ceevee', rating: 5 };
  const good = installSigned('ceevee', body);
  assert.equal((await app({ ...good, body: JSON.stringify({ app: 'ceevee', rating: 1 }) })).statusCode, 401);
  const other = installKey(9);
  assert.equal((await app({ ...good, headers: { ...good.headers, 'x-ht-install': other.pub } })).statusCode, 401);
  assert.equal((await app(installSigned('ceevee', body, { ts: Math.floor(NOW / 1000) - 3600 }))).statusCode, 401);
  assert.equal((await app({ ...good, headers: { ...good.headers, 'x-ht-install': 'zz' } })).statusCode, 401);
  assert.equal((await app({ ...good, headers: { ...good.headers, 'x-ht-signature': 'ab' } })).statusCode, 401);
  assert.equal((await app(installSigned('x', body, { name: 'website' }))).statusCode, 401);
  assert.equal(items.length, 0);
});

test('an install signature is accepted only once', async () => {
  const { app } = setup();
  const req = installSigned('ceevee', { app: 'ceevee', rating: 5 });
  assert.equal((await app(req)).statusCode, 201);
  assert.equal((await app(req)).statusCode, 409);
});

test('an install key cannot submit as another app', async () => {
  const { app } = setup();
  assert.equal((await app(installSigned('ceevee', { app: 'golden', rating: 5 }, { name: 'ceevee' }))).statusCode, 403);
});

test('per-install limits: 5 an hour, 20 a day; other installs are unaffected', async () => {
  const { app } = setup({ perIpPerHour: 1000 });
  const k = installKey(1);
  for (let i = 0; i < 5; i++) assert.equal((await app(installSigned('ceevee', { app: 'ceevee', rating: 5, message: `m${i}` }, { k }))).statusCode, 201);
  assert.equal((await app(installSigned('ceevee', { app: 'ceevee', rating: 5, message: 'sixth' }, { k }))).statusCode, 429);
  assert.equal((await app(installSigned('ceevee', { app: 'ceevee', rating: 5 }, { k: installKey(2) }))).statusCode, 201);
});

test('per-install daily cap applies across hours', async () => {
  let t = NOW;
  const { app } = setup({ perIpPerHour: 1000, now: () => t });
  const k = installKey(3);
  let ok = 0;
  for (let h = 0; h < 10; h++) {
    t = NOW + h * 3_600_000;
    for (let i = 0; i < 5; i++) {
      const r = await app(installSigned('ceevee', { app: 'ceevee', message: `h${h}i${i}` }, { k, ts: Math.floor(t / 1000) }));
      if (r.statusCode === 201) ok++;
    }
  }
  assert.equal(ok, 20);
});

test('per-IP limit also applies to install-signed requests', async () => {
  const { app } = setup({ perInstallPerHour: 1000, perInstallPerDay: 1000 });
  for (let i = 0; i < 20; i++) assert.equal((await app(installSigned('ceevee', { app: 'ceevee', message: `m${i}` }, { k: installKey(i + 10) }))).statusCode, 201);
  assert.equal((await app(installSigned('ceevee', { app: 'ceevee', message: 'over' }, { k: installKey(99) }))).statusCode, 429);
});

test('install requests are capped at 10 KB', async () => {
  const { app } = setup();
  const res = await app(installSigned('ceevee', { app: 'ceevee', message: 'x'.repeat(4000), pad: 'y'.repeat(7000) }));
  assert.equal(res.statusCode, 413);
});

test('a blocked install is refused', async () => {
  const k = installKey(5);
  const { app, items } = setup({ blockedInstalls: new Set([k.pub]) });
  assert.equal((await app(installSigned('ceevee', { app: 'ceevee', rating: 5 }, { k }))).statusCode, 403);
  assert.equal(items.length, 0);
});

test('shared-key (HMAC) requests are retired: no install header means 401', async () => {
  const { app, items } = setup();
  const res = await app(post('{"app":"ceevee","rating":5}', { 'x-ht-app': 'ceevee', 'x-ht-timestamp': String(Math.floor(NOW / 1000)), 'x-ht-signature': 'ab'.repeat(32) }));
  assert.equal(res.statusCode, 401);
  assert.equal(items.length, 0);
});
