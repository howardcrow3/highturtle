import test from 'node:test';
import assert from 'node:assert/strict';
import { backerEmail } from '../src/backer-email.mjs';

test('Backer email shows every key in text and HTML and escapes the address', () => {
  const m = backerEmail({ keys: ['BACKER-AAAA-BBBB', 'BACKER-CCCC-DDDD'], email: 'a<b>@x.com', site: 'https://turtlebox.studio/', seats: 2, order: 'inv_1' });
  assert.equal(m.subject, 'Your Backer license keys');
  for (const k of ['BACKER-AAAA-BBBB', 'BACKER-CCCC-DDDD']) { assert.ok(m.text.includes(k)); assert.ok(m.html.includes(k)); }
  assert.ok(m.html.includes('a&lt;b&gt;@x.com'));
  assert.ok(m.html.includes('https://turtlebox.studio/backer/') && m.html.includes('/assets/icons/backer-144.png'));
  assert.ok(m.text.includes('up to 2 computers'));
  for (const k of ['BACKER-AAAA-BBBB', 'BACKER-CCCC-DDDD']) { assert.ok(m.text.includes(`https://turtlebox.studio/backer/activate/#key=${k}`)); assert.ok(m.html.includes(`href="https://turtlebox.studio/backer/activate/#key=${k}"`)); }
});

test('Backer email uses the singular for one key', () => {
  const m = backerEmail({ keys: ['BACKER-AAAA'], email: 'a@x.com', order: 'inv_1' });
  assert.equal(m.subject, 'Your Backer license key');
});
