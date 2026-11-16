// Finds (or, only when missing, creates) what the Backer checkout needs in Paddle:
//   - the "Backer" product
//   - its one-time USD 4.99 price
//   - a client-side token for Paddle.js on turtlebox.studio
// Never deletes, archives or edits anything that already exists. Prints the IDs as GitHub notices.
// Price IDs and client-side tokens are public by design (they ship in the page), so printing them is safe.
// Usage: PADDLE_API_KEY=... node billing/scripts/backer-catalog.mjs [--dry-run]

const KEY = process.env.PADDLE_API_KEY;
const BASE = process.env.PADDLE_ENVIRONMENT === 'sandbox' ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com';
const DRY = process.argv.includes('--dry-run');
const AMOUNT = '499';
const CURRENCY = 'USD';

if (!KEY) { console.log('::error::PADDLE_API_KEY is not set'); process.exit(1); }

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(`${method} ${path} -> ${res.status} ${json?.error?.code || ''} ${json?.error?.detail || ''}`);
    e.status = res.status;
    throw e;
  }
  return json;
}

const notice = (title, msg) => console.log(`::notice title=${title}::${msg}`);

async function main() {
  // 1. Product
  const products = (await api('GET', '/products?status=active&per_page=200')).data;
  notice('products', products.map((p) => `${p.id} "${p.name}"`).join(' | ') || 'none');
  let product = products.find((p) => p.name.trim().toLowerCase() === 'backer');
  if (!product && !DRY) {
    product = (await api('POST', '/products', {
      name: 'Backer',
      tax_category: 'standard',
      description: 'Backer license key for macOS and Windows. One key covers all 1.x versions.',
    })).data;
    notice('created', `product ${product.id}`);
  }
  if (!product) return notice('dry-run', 'no Backer product; would create one');

  // 2. Price
  const prices = (await api('GET', `/prices?product_id=${product.id}&status=active&per_page=200`)).data;
  notice('prices', prices.map((p) => `${p.id} ${p.unit_price.amount} ${p.unit_price.currency_code} ${p.billing_cycle ? 'recurring' : 'one-time'}`).join(' | ') || 'none');
  let price = prices.find((p) => !p.billing_cycle && p.unit_price.amount === AMOUNT && p.unit_price.currency_code === CURRENCY);
  if (!price && !DRY) {
    price = (await api('POST', '/prices', {
      product_id: product.id,
      description: 'Backer 1.x license (one-time)',
      name: 'Backer license',
      unit_price: { amount: AMOUNT, currency_code: CURRENCY },
      quantity: { minimum: 1, maximum: 1 },
    })).data;
    notice('created', `price ${price.id}`);
  }

  // 3. Client-side token
  let token = null;
  try {
    const tokens = (await api('GET', '/client-tokens?status=active&per_page=50')).data;
    token = tokens[0] || null;
    if (!token && !DRY) {
      token = (await api('POST', '/client-tokens', { name: 'turtlebox.studio checkout', description: 'Paddle.js on turtlebox.studio' })).data;
      notice('created', `client token ${token.id}`);
    }
  } catch (e) {
    notice('client-token', `could not read or create one with this API key (${e.message}). Create it in Paddle: Developer tools > Authentication > Client-side tokens.`);
  }

  notice('result', `product=${product.id} price=${price?.id || 'none'} client_token=${token?.token || 'none'}`);
}

main().catch((e) => { console.log(`::error::${e.message}`); process.exit(1); });
