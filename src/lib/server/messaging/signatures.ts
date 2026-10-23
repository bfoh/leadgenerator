import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

// Webhook signature checks and unsubscribe tokens. All comparisons are constant-time.

function safeEqual(a: Buffer, b: Buffer) {
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Resend signs webhooks with Svix: base64 HMAC-SHA256 of "{svix-id}.{svix-timestamp}.{raw body}"
 * keyed with the base64 part of the "whsec_…" secret. The header lists one or more "v1,<sig>".
 */
export function verifySvixSignature(input: {
  secret: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): boolean {
  const { secret, id, timestamp, signature, body } = input;
  if (!secret || !id || !timestamp || !signature || !/^\d{1,12}$/.test(timestamp)) return false;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > (input.toleranceSeconds ?? 300)) return false;
  let key: Buffer;
  try {
    key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  } catch {
    return false;
  }
  if (!key.length) return false;
  const expected = Buffer.from(createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64'));
  return signature
    .split(' ')
    .map((part) => part.split(','))
    .some(([version, sig]) => version === 'v1' && Boolean(sig) && safeEqual(Buffer.from(sig), expected));
}

/** Meta signs webhook bodies: "X-Hub-Signature-256: sha256=<hex HMAC-SHA256(app secret, raw body)>". */
export function verifyMetaSignature(input: { appSecret: string; signature: string | null; body: string }): boolean {
  const { appSecret, signature, body } = input;
  if (!appSecret || !signature?.startsWith('sha256=')) return false;
  const expected = Buffer.from(createHmac('sha256', appSecret).update(body, 'utf8').digest('hex'));
  return safeEqual(Buffer.from(signature.slice(7).toLowerCase()), expected);
}

/** Constant-time comparison for the WhatsApp verify token. */
export function tokensMatch(given: string | null, expected: string) {
  return Boolean(given && expected) && safeEqual(Buffer.from(given!), Buffer.from(expected));
}

const TOKEN = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/;

/** "{message id}.{base64url HMAC}": identifies the message without exposing the address. */
export function signUnsubscribeToken(secret: string, messageId: string) {
  return `${messageId}.${createHmac('sha256', secret).update(`unsubscribe:${messageId}`).digest('base64url')}`;
}

export function verifyUnsubscribeToken(secret: string, token: string | null): string | null {
  const m = token?.match(TOKEN);
  if (!secret || !m) return null;
  return safeEqual(Buffer.from(signUnsubscribeToken(secret, m[1])), Buffer.from(token!)) ? m[1] : null;
}
