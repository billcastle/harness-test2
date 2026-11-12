import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { api, ApiError } from '../lib/api';

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Four PIN slots backed by one real input (paste, autofill and screen readers just work). Auto-submits on the 4th digit. */
export function PinScreen({ onSuccess }: { onSuccess: () => void }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const input = useRef<HTMLInputElement>(null);

  const remaining = lockedUntil ? Math.max(0, Math.ceil((lockedUntil - now) / 1000)) : 0;
  const locked = remaining > 0;

  useEffect(() => {
    if (!lockedUntil) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [lockedUntil]);
  useEffect(() => {
    if (lockedUntil && remaining === 0) {
      setLockedUntil(null);
      setError(null);
      input.current?.focus();
    }
  }, [lockedUntil, remaining]);

  async function submit(value: string) {
    setBusy(true);
    setError(null);
    try {
      await api.login(value);
      onSuccess();
    } catch (e) {
      setPin('');
      if (e instanceof ApiError && e.retryAfterSeconds) {
        setNow(Date.now());
        setLockedUntil(Date.now() + e.retryAfterSeconds * 1000);
        setError(e.status === 401 ? 'Wrong PIN.' : 'Too many wrong attempts.');
      } else if (e instanceof ApiError && e.status === 429) {
        setError('Too many attempts. Please try again later.'); // generic by design: the global cap shows no countdown
      } else if (e instanceof ApiError && e.status === 401) {
        setError('Wrong PIN. Try again.');
      } else {
        setError('Could not sign in. Check your connection and try again.');
      }
      setTimeout(() => input.current?.focus(), 0);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-muted/40 p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Enter your PIN</CardTitle>
          <CardDescription>4 digits</CardDescription>
        </CardHeader>
        <CardContent className="grid justify-items-center gap-6">
          <InputOTP
            ref={input}
            maxLength={4}
            value={pin}
            onChange={setPin}
            onComplete={(v) => void submit(v)}
            pattern="^[0-9]*$"
            inputMode="numeric"
            autoFocus
            disabled={busy || locked}
            aria-label="PIN, 4 digits"
            aria-invalid={error ? true : undefined}
            aria-describedby="pin-msg"
            containerClassName="gap-3"
          >
            <InputOTPGroup className="gap-3">
              {[0, 1, 2, 3].map((i) => (
                <InputOTPSlot key={i} index={i} mask className="rounded-2xl border" aria-invalid={error ? true : undefined} />
              ))}
            </InputOTPGroup>
          </InputOTP>
          <div id="pin-msg" role="alert" aria-live="assertive" className="min-h-6 text-center text-sm">
            {locked ? (
              <p className="text-destructive">
                {error} Try again in <span className="font-semibold tabular-nums">{mmss(remaining)}</span>
              </p>
            ) : error ? (
              <p className="text-destructive">{error}</p>
            ) : null}
          </div>
          {busy && <p className="text-sm text-muted-foreground" aria-live="polite">Checking…</p>}
        </CardContent>
      </Card>
    </main>
  );
}
