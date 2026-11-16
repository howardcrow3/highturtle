// The three endpoints the CeeVee app calls (docs: CeeVee repo docs/LICENSE_API.md).
//   POST /api/ceevee/v1/trial       {machine}                              -> 200 {token}
//   POST /api/ceevee/v1/activate    {key, machine, app_version, platform} -> 200 {license} | 404 unknown_key | 409 seats_full
//   POST /api/ceevee/v1/deactivate  {key, machine}                         -> 204 | 404 unknown_key
// Every answer is JSON and uncached. The signing key never leaves this function.

import { normalizeKey, signClaims, licenseClaims, trialClaims } from './ceevee.mjs';

const MACHINE_RE = /^[A-Za-z0-9+/=_-]{8,128}$/;
const PREFIX = '/api/ceevee/v1/';

const json = (status, obj) => ({
  statusCode: status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: obj === undefined ? '' : JSON.stringify(obj),
});

function parseBody(event) {
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
  try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : null; } catch { return null; }
}

export const isCeeveePath = (path) => path.startsWith(PREFIX);

export function makeCeeveeApi({ cfg, ceevee, log = () => {}, now = () => new Date() }) {
  const needKey = () => {
    if (cfg.ceeveeSigningKey) return null;
    log({ error: 'CEEVEE_SIGNING_KEY is not set' });
    return json(503, { error: 'unavailable', message: 'Licensing is not available yet. Please try again later.' });
  };

  async function trial(body) {
    if (typeof body.machine !== 'string' || !MACHINE_RE.test(body.machine)) return json(400, { error: 'bad_request' });
    const startedAt = await ceevee.getOrCreateTrial(body.machine, now());
    const token = await signClaims(cfg.ceeveeSigningKey, trialClaims({ machine: body.machine, startedAt }));
    return json(200, { token });
  }

  async function activate(body) {
    const key = normalizeKey(body.key);
    if (!key) return json(404, { error: 'unknown_key' });
    if (typeof body.machine !== 'string' || !MACHINE_RE.test(body.machine)) return json(400, { error: 'bad_request' });
    const meta = {
      app_version: String(body.app_version ?? '').slice(0, 32),
      platform: String(body.platform ?? '').slice(0, 16),
    };
    const result = await ceevee.activateSeat(key, body.machine, meta, now());
    if (result === 'missing') return json(404, { error: 'unknown_key' });
    if (result === 'full') {
      return json(409, { error: 'seats_full', message: `This key is already on ${cfg.ceeveeSeats} computers. Free a seat at ${cfg.site}/ceevee/license or deactivate CeeVee on one of them.` });
    }
    const lic = await ceevee.getLicense(key);
    const license = await signClaims(cfg.ceeveeSigningKey, licenseClaims({
      key, machine: body.machine, issuedAt: now(), major: lic.major, seats: lic.seats,
    }));
    log({ ceevee: 'activated', key_tail: key.slice(-5), platform: meta.platform });
    return json(200, { license });
  }

  async function deactivate(body) {
    const key = normalizeKey(body.key);
    if (!key || typeof body.machine !== 'string' || !MACHINE_RE.test(body.machine)) return json(404, { error: 'unknown_key' });
    const result = await ceevee.releaseSeat(key, body.machine);
    if (result === 'missing') return json(404, { error: 'unknown_key' });
    log({ ceevee: 'deactivated', key_tail: key.slice(-5) });
    return json(204);
  }

  return async function handle(event, method, path) {
    if (method !== 'POST') return json(405, { error: 'method_not_allowed' });
    const route = path.slice(PREFIX.length);
    if (!['trial', 'activate', 'deactivate'].includes(route)) return json(404, { error: 'not found' });
    const unavailable = needKey();
    if (unavailable) return unavailable;
    const body = parseBody(event);
    if (!body) return json(400, { error: 'bad_request' });
    if (route === 'trial') return trial(body);
    if (route === 'activate') return activate(body);
    return deactivate(body);
  };
}
