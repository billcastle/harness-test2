// Minimal cookie helpers (no dependency).
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k && !(k in out)) out[k] = part.slice(i + 1).trim();
  }
  return out;
}

export interface CookieOpts {
  secure: boolean;
  expires: Date | null; // null = clear now
}

/**
 * Production uses the `__Host-` prefix, which the browser only accepts when the cookie is Secure,
 * has Path=/ and has no Domain. Local HTTP development uses a plain name (secure: false).
 */
export const sessionCookieName = (secure: boolean) => (secure ? '__Host-session' : 'session');

export function serializeSession(name: string, value: string, o: CookieOpts): string {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (o.secure) parts.push('Secure');
  if (o.expires === null) {
    parts.push('Max-Age=0', 'Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  } else {
    parts.push(`Expires=${o.expires.toUTCString()}`);
  }
  return parts.join('; ');
}
