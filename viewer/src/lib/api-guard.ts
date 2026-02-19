import { NextResponse } from 'next/server';

/**
 * Multi-layer CSRF protection for state-changing API endpoints.
 *
 * Layer 1: If Origin header present → validate hostname + port against whitelist
 * Layer 2: If Referer header present → validate hostname + port against whitelist
 * Layer 3: If Sec-Fetch-Site header present → reject 'cross-site'
 * Fallback: No browser headers at all → allow (non-browser client: curl, IDE, etc.)
 *
 * Returns null if valid, or a NextResponse 403 if invalid.
 */
export function verifyCsrfProtection(request: Request): NextResponse | null {
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const secFetchSite = request.headers.get('sec-fetch-site');
  const allowedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'];
  const allowedPorts = ['3100', '3000'];

  // Layer 1: Origin header check
  if (origin) {
    try {
      const url = new URL(origin);
      if (allowedHosts.includes(url.hostname) && allowedPorts.includes(url.port)) {
        return null;
      }
    } catch { /* invalid URL */ }
    return NextResponse.json(
      { error: 'Forbidden: untrusted origin' },
      { status: 403 }
    );
  }

  // Layer 2: Referer header check
  if (referer) {
    try {
      const url = new URL(referer);
      if (allowedHosts.includes(url.hostname) && allowedPorts.includes(url.port)) {
        return null;
      }
    } catch { /* invalid URL */ }
    return NextResponse.json(
      { error: 'Forbidden: untrusted referer' },
      { status: 403 }
    );
  }

  // Layer 3: Sec-Fetch-Site check
  if (secFetchSite === 'cross-site') {
    return NextResponse.json(
      { error: 'Forbidden: cross-site request' },
      { status: 403 }
    );
  }

  // No Origin, no Referer, no cross-site → non-browser client, allow
  return null;
}
