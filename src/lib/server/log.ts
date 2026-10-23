import 'server-only';

// Structured server logs (phase 10): one JSON line per event on stdout/stderr, which the host's log
// drain collects. Only short labels, codes and counts are logged; any string is redacted (email
// addresses, phone numbers, key-like tokens) and cut short, so personal data and secrets stay out of
// the logs even if a caller passes the wrong thing. Errors can also go to ERROR_REPORT_URL (any HTTPS
// webhook, such as a team chat or an alerting service) with the same redacted fields.

type Field = string | number | boolean | null | undefined;

const RULES: [RegExp, string][] = [
  [/\b(?:sk-ant-|AIza|sb_secret_|EAA|re_)[\w-]{8,}/g, '[secret]'],
  [/\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g, '[token]'],
  [/(bearer\s+)[\w.~+/-]+=*/gi, '$1[secret]'],
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]'],
  [/\+?\d[\d\s-]{7,}\d/g, '[number]'],
];

export function redact(text: string) {
  let out = text;
  for (const [re, by] of RULES) out = out.replace(re, by);
  return out.length > 300 ? `${out.slice(0, 300)}…` : out;
}

export function logEvent(level: 'error' | 'warn' | 'info', event: string, fields: Record<string, Field> = {}) {
  const clean: Record<string, Field> = {};
  for (const [k, v] of Object.entries(fields)) clean[k] = typeof v === 'string' ? redact(v) : v;
  const line = JSON.stringify({ level, event, at: new Date().toISOString(), ...clean });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  if (level === 'error') return forward({ event, ...clean });
}

/** Sends a redacted error event to ERROR_REPORT_URL, when set. Never throws, never retries. */
async function forward(payload: Record<string, Field>) {
  const url = process.env.ERROR_REPORT_URL;
  if (!url || !url.startsWith('https://')) return;
  try {
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app: 'digital-opportunity-finder', ...payload }), signal: AbortSignal.timeout(3_000) });
  } catch {
    // Reporting must never break the request that failed.
  }
}
