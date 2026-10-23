// Scans what the browser receives (client JavaScript, prerendered HTML and RSC payloads in .next) for
// server secrets: key formats of the providers in use, a Supabase service-role token, and the actual
// values of the secrets in the environment or .env.local. Variable names alone are allowed (the UI
// tells people which variable to set). Prints only the file and the rule that matched, never the
// match. Run after `next build`.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SERVER_SECRETS = [
  'GOOGLE_PLACES_API_KEY',
  'BRAVE_SEARCH_API_KEY',
  'ANTHROPIC_API_KEY',
  'CRON_SECRET',
  'SUPABASE_SERVICE_ROLE_KEY',
  'MESSAGING_UNSUBSCRIBE_SECRET',
  'RESEND_API_KEY',
  'RESEND_WEBHOOK_SECRET',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_APP_SECRET',
  'WHATSAPP_VERIFY_TOKEN',
];

const PATTERNS = [
  ['Anthropic API key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
  ['Resend API key', /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}/],
  ['Meta access token', /\bEAA[A-Za-z0-9]{40,}/],
  ['Supabase secret key', /\bsb_secret_[A-Za-z0-9_-]{16,}/],
];

/** Values of server secrets from the environment and .env.local (never printed). */
function secretValues() {
  const values = new Map();
  if (existsSync('.env.local')) {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && SERVER_SECRETS.includes(m[1])) values.set(m[1], m[2].replace(/^["']|["']$/g, ''));
    }
  }
  for (const name of SERVER_SECRETS) if (process.env[name]) values.set(name, process.env[name]);
  return [...values].filter(([, v]) => v.length >= 8);
}

function serviceRoleJwt(text) {
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
    try {
      if (JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')).role === 'service_role') return true;
    } catch {
      // not a JWT
    }
  }
  return false;
}

function* files(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(js|mjs|html|rsc|json|css|txt)$/.test(name)) yield path;
  }
}

if (!existsSync('.next/static')) {
  console.error('No build found: run `next build` first.');
  process.exit(2);
}

const values = secretValues();
const findings = [];
let scanned = 0;
// Client chunks, plus the prerendered pages and payloads the server sends as they are.
const targets = [...files('.next/static'), ...[...files('.next/server/app')].filter((f) => /\.(html|rsc|txt)$/.test(f))];
for (const file of targets) {
  const text = readFileSync(file, 'utf8');
  scanned++;
  for (const [label, re] of PATTERNS) if (re.test(text)) findings.push(`${file}: looks like a ${label}`);
  if (serviceRoleJwt(text)) findings.push(`${file}: contains a Supabase service-role token`);
  for (const [name, value] of values) if (text.includes(value)) findings.push(`${file}: contains the value of ${name}`);
}

if (findings.length) {
  console.error(`Client bundle check failed (${findings.length}):\n${findings.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(1);
}
console.log(`Client bundle check passed: ${scanned} files checked for ${PATTERNS.length} key formats, service-role tokens and ${values.length} configured secret values; no matches.`);
