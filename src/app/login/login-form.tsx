'use client';

import { ArrowRight, MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { browserSupabase } from '@/lib/supabase/client';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, FormError, Input } from '@/components/ui/field';
import { Notice } from '@/components/ui/misc';

function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export function LoginForm() {
  const params = useSearchParams();
  const router = useRouter();
  const next = safeNext(params.get('next'));
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(params.get('error') === 'link' ? 'That sign-in link is invalid or has expired. Request a new one.' : null);

  if (!isSupabaseConfigured()) {
    return (
      <Card className="w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold">Demo workspace</h1>
        <p className="mt-2 text-sm text-subtle">
          Supabase is not configured, so this deployment runs in demo mode: no sign-in, and data stays in this browser. See the README to enable team sign-in.
        </p>
        <ButtonLink href="/" variant="primary" className="mt-5 w-full justify-center">
          Open the demo workspace <ArrowRight />
        </ButtonLink>
      </Card>
    );
  }

  const sb = browserSupabase()!;

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Enter a valid email address.');
    setPending(true);
    const { error } = await sb.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`, shouldCreateUser: true },
    });
    setPending(false);
    if (error) return setError(error.status === 429 ? 'Too many attempts. Wait a minute and try again.' : 'Could not send the sign-in email. Check the address and try again.');
    setSent(true);
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6,10}$/.test(code.trim())) return setError('Enter the numeric code from the email.');
    setPending(true);
    const { error } = await sb.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    setPending(false);
    if (error) return setError('That code is invalid or has expired.');
    router.replace(next);
    router.refresh();
  }

  return (
    <Card className="w-full max-w-sm p-6">
      <div className="mb-5">
        <span className="mb-4 grid size-9 place-items-center rounded-lg bg-foreground font-serif text-lg italic text-background" aria-hidden>
          d
        </span>
        <h1 className="text-lg font-semibold">Sign in to Opportunity Finder</h1>
        <p className="mt-1 text-sm text-subtle">We email you a sign-in link. No password needed.</p>
      </div>
      {!sent ? (
        <form onSubmit={sendLink} className="space-y-4" noValidate>
          <Field label="Work email" required>
            {(p) => <Input {...p} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@agency.com.gh" />}
          </Field>
          <FormError message={error} />
          <Button type="submit" variant="primary" loading={pending} className="w-full justify-center">
            Email me a sign-in link
          </Button>
        </form>
      ) : (
        <div className="space-y-4">
          <Notice tone="success" icon={MailCheck} title="Check your email">
            We sent a link to <strong>{email}</strong>. Open it on this device, or enter the code from the email below.
          </Notice>
          <form onSubmit={verifyCode} className="space-y-4" noValidate>
            <Field label="Sign-in code" hint="Only needed if your email includes a code.">
              {(p) => <Input {...p} inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />}
            </Field>
            <FormError message={error} />
            <Button type="submit" variant="primary" loading={pending} className="w-full justify-center">
              Verify code
            </Button>
            <button type="button" className="w-full text-center text-xs text-subtle underline-offset-2 hover:underline" onClick={() => setSent(false)}>
              Use a different email
            </button>
          </form>
        </div>
      )}
      <p className="mt-6 text-xs text-subtle">
        New accounts get their own workspace. To join your agency&apos;s workspace, ask an owner to invite your email first.{' '}
        <Link href="/privacy" className="underline">
          Privacy
        </Link>
      </p>
    </Card>
  );
}
