// Empties the computer list on Backer keys (support reset). Reads EMAIL or KEY from the environment.
// Run by the "Backer seat reset" workflow, which provides AWS credentials. Changes only the `machines` map.
import { execFileSync } from 'node:child_process';
import { keyIdOf } from '../src/backer-activation.mjs';

const TABLE = process.env.BACKER_ACTIVATIONS_TABLE || 'highturtle-backer-activations';
const aws = (...args) => JSON.parse(execFileSync('aws', [...args, '--output', 'json'], { encoding: 'utf8' }) || 'null');
const ids = [];

if (process.env.KEY?.trim()) {
  const id = keyIdOf(process.env.KEY);
  if (!id) throw new Error('That is not a Backer key.');
  ids.push(id);
} else {
  const email = process.env.EMAIL.trim().toLowerCase();
  // Keys are activated lazily, so the table has a row only for keys that were used; find them by the email stored on the row.
  const out = aws('dynamodb', 'scan', '--table-name', TABLE, '--filter-expression', 'email_lc = :e',
    '--expression-attribute-values', JSON.stringify({ ':e': { S: email } }), '--projection-expression', 'license_key');
  for (const it of out.Items || []) ids.push(it.license_key.S);
}
if (!ids.length) { console.log('::notice title=Backer reset::No activated keys found, so nothing to reset.'); process.exit(0); }
for (const id of ids) {
  aws('dynamodb', 'update-item', '--table-name', TABLE, '--key', JSON.stringify({ license_key: { S: id } }),
    '--update-expression', 'SET machines = :m', '--condition-expression', 'attribute_exists(license_key)',
    '--expression-attribute-values', JSON.stringify({ ':m': { M: {} } }));
}
console.log(`::notice title=Backer reset::Freed all computers on ${ids.length} key(s).`);
