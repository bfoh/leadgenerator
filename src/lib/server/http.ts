import 'server-only';

import { NextResponse, type NextRequest } from 'next/server';
import { ZodError, type ZodType } from 'zod';
import { logEvent } from './log';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const NO_STORE = { 'Cache-Control': 'no-store' };

export function ok(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, { ...init, headers: { ...NO_STORE, ...init?.headers } });
}

/** Maps errors to safe responses. Unexpected errors are logged without request data. */
export function fail(error: unknown) {
  if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status, headers: NO_STORE });
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    return NextResponse.json({ error: `Invalid request: ${issue?.path.join('.') || 'body'} — ${issue?.message ?? 'invalid'}` }, { status: 400, headers: NO_STORE });
  }
  void logEvent('error', 'api_unexpected_error', { error: error instanceof Error ? error.name : 'unknown', detail: error instanceof Error ? error.message : null });
  return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500, headers: NO_STORE });
}

export async function readJson<T>(req: NextRequest, schema: ZodType<T>, maxBytes = 200_000): Promise<T> {
  const length = Number(req.headers.get('content-length') ?? 0);
  if (length > maxBytes) throw new HttpError(413, 'Request body too large.');
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, 'Request body too large.');
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Request body must be JSON.');
  }
  return schema.parse(body);
}

export function clientIp(req: NextRequest) {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'local';
}
