/**
 * URL Validation Utilities
 *
 * SSRF protection: validates URLs against private/restricted network ranges.
 * Used by any outbound HTTP calls where the target URL originates from user
 * or company configuration (e.g. the ABRA Flexi API URL).
 *
 * Ported from Foldera V1 (`backend/src/utils/urlValidation.ts`) — textual
 * hostname checks only (fast, synchronous). DNS-rebinding checks were not
 * ported; V2 only talks to long-lived, admin-configured ERP hosts.
 */

/**
 * Check if an IPv4 address string falls in a private/reserved range.
 */
function isPrivateIPv4(hostname: string): boolean {
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4Match) return false;

  const a = Number(ipv4Match[1]);
  const b = Number(ipv4Match[2]);
  return (
    a === 127 || // Loopback
    a === 10 || // RFC1918
    (a === 172 && b >= 16 && b <= 31) || // RFC1918
    (a === 192 && b === 168) || // RFC1918
    (a === 169 && b === 254) || // Link-local
    (a === 100 && b >= 64 && b <= 127) || // RFC6598 carrier-grade NAT
    a === 0 // 0.0.0.0/8
  );
}

/**
 * Check if an IPv6 hostname literal falls in a private/reserved range.
 */
function isPrivateIPv6(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (lower === '::1' || lower === '::') return true; // Loopback / unspecified
  if (/^fe[89ab][0-9a-f]/.test(lower)) return true; // Link-local (fe80::/10)
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // Unique-local (fc00::/7)
  if (lower.startsWith('::ffff:')) {
    // IPv4-mapped — check the embedded IPv4
    const embedded = lower.slice(7);
    if (isPrivateIPv4(embedded)) return true;
    if (embedded.includes(':')) {
      const hex = embedded.split(':');
      if (hex.length === 2) {
        const hi = parseInt(hex[0] ?? '', 16);
        const lo = parseInt(hex[1] ?? '', 16);
        if (!isNaN(hi) && !isNaN(lo)) {
          const dotted = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
          if (isPrivateIPv4(dotted)) return true;
        }
      }
    }
  }
  return false;
}

/**
 * Check if a URL targets a private/restricted network range (textual check only).
 * Blocks: non-http(s) schemes, localhost, 127.x, 10.x, 172.16-31.x, 192.168.x,
 * 169.254.x (link-local), 100.64.x (CGNAT), 0.x, ::1, fe80::/10, fc00::/7, etc.
 */
export function isPrivateUrl(urlStr: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return true; // Invalid URL — block it
  }

  const hostname = parsed.hostname.toLowerCase();

  // Reject non-http(s) schemes
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return true;
  }

  // Localhost patterns
  if (
    hostname === 'localhost' ||
    hostname === '0.0.0.0' ||
    hostname.endsWith('.localhost')
  ) {
    return true;
  }

  if (isPrivateIPv4(hostname)) return true;
  if (hostname.includes(':') || hostname.startsWith('[')) {
    if (isPrivateIPv6(hostname)) return true;
  }

  return false;
}

/**
 * Validate that a URL is safe for outbound requests (textual check only).
 * Throws an error if the URL is private/restricted.
 */
export function assertPublicUrl(urlStr: string, context: string): void {
  if (isPrivateUrl(urlStr)) {
    throw new Error(`SSRF blocked: ${context} URL targets a private/restricted network range`);
  }
}

/** True if a bare hostname literal (IP or `localhost`) is private/reserved. */
function isPrivateHostLiteral(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (isPrivateIPv4(h)) return true;
  if (h.includes(':')) return isPrivateIPv6(h);
  return false;
}

/**
 * SSRF guard for a bare host:port target (e.g. an IMAP server) where there is no
 * URL/scheme. Resolves the hostname and rejects if the literal OR any resolved
 * A/AAAA record falls in a private/reserved range — closing the gap a textual
 * check leaves open (a public name pointing at an internal IP). Async by nature.
 */
export async function assertPublicHost(host: string, context: string): Promise<void> {
  const trimmed = host.trim();
  if (!trimmed || isPrivateHostLiteral(trimmed)) {
    throw new Error(`SSRF blocked: ${context} host targets a private/restricted network range`);
  }
  // If it's already an IP literal, the textual check above is authoritative.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(trimmed) || trimmed.includes(':')) return;

  const { lookup } = await import('node:dns/promises');
  let records: { address: string }[];
  try {
    records = await lookup(trimmed, { all: true });
  } catch {
    throw new Error(`SSRF blocked: ${context} host could not be resolved`);
  }
  for (const { address } of records) {
    if (isPrivateIPv4(address) || isPrivateIPv6(address)) {
      throw new Error(`SSRF blocked: ${context} host resolves to a private/restricted network range`);
    }
  }
}
