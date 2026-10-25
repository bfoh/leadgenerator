import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV === 'development';

/** The Supabase origin the browser may call (sign-in and data); nothing else leaves the page. */
function supabaseOrigin() {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin : '';
  } catch {
    return '';
  }
}

// Without nonces (pages stay static): inline scripts are needed for Next's bootstrap and the theme
// script, so the policy's value is in limiting where the page can load from and send data to.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  // Preview images and footage come from private storage through short-lived signed URLs, so the
  // Supabase origin is allowed for media only; nothing else may load from it.
  `img-src 'self' data: blob: ${supabaseOrigin()}`.trim(),
  `media-src 'self' blob: ${supabaseOrigin()}`.trim(),
  "font-src 'self'",
  `connect-src 'self' ${supabaseOrigin()}`.trim(),
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Content-Security-Policy', value: csp },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
