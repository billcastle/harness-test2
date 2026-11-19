/** TRUST_PROXY: "true" trusts the platform's forwarded header (Vercel overwrites it); otherwise a comma-separated list of proxy addresses/CIDRs. Unset = socket address. */
export function parseTrustProxy(v: string | undefined): boolean | string[] {
  if (!v) return false;
  if (v.trim().toLowerCase() === 'true') return true;
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}
