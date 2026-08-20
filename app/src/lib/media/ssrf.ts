import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class UnsafeImageUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeImageUrlError";
  }
}

function isPrivateIPv4(ip: string): boolean {
  const octets = ip.split(".").map(Number);
  if (octets.length !== 4 || octets.some((o) => Number.isNaN(o))) return true; // malformed -> treat as unsafe
  const [a, b] = octets as [number, number, number, number];
  if (a === 127) return true; // loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // link-local / cloud metadata (169.254.169.254)
  if (a === 0) return true; // 0.0.0.0/8
  return false;
}

/**
 * IPv4-mapped/-compatible IPv6 addresses (e.g. `::ffff:127.0.0.1`,
 * `::ffff:7f00:1`) embed a real IPv4 address that dual-stack sockets treat
 * as that IPv4 address on the wire — so a mapped-loopback address actually
 * connects to loopback despite "looking like" a distinct IPv6 address.
 * Extracts the embedded IPv4 (dotted or hex-group form) so it gets the same
 * private-range check as a literal IPv4 address.
 */
function extractIPv4MappedAddress(normalized: string): string | null {
  const dotted = normalized.match(/^::(ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return dotted[2]!;

  const hexGroups = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexGroups) {
    const hi = parseInt(hexGroups[1]!, 16);
    const lo = parseInt(hexGroups[2]!, 16);
    return [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff].join(".");
  }

  return null;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1") return true; // loopback
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // fc00::/7 unique local
  if (normalized.startsWith("fe80")) return true; // link-local

  const mappedV4 = extractIPv4MappedAddress(normalized);
  if (mappedV4) return isPrivateIPv4(mappedV4);

  return false;
}

function isPrivateIp(ip: string): boolean {
  return isIP(ip) === 6 ? isPrivateIPv6(ip) : isPrivateIPv4(ip);
}

/**
 * Validates a remote image URL before it is ever fetched (Technical Plan
 * §15). Rejects non-http(s) schemes, and resolves the hostname to reject
 * loopback/private/link-local/cloud-metadata IP ranges — the standard SSRF
 * surface for a server-side "download this URL" feature.
 */
export async function assertSafeImageUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeImageUrlError(`Not a valid URL: ${rawUrl}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeImageUrlError(`Unsupported URL scheme: ${url.protocol}`);
  }

  // url.hostname keeps IPv6 literals bracketed, e.g. "[::1]" — strip for isIP/lookup checks.
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new UnsafeImageUrlError(`Refusing to fetch localhost URL: ${rawUrl}`);
  }

  // If the hostname is already a literal IP, check it directly.
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new UnsafeImageUrlError(`Refusing to fetch private/loopback IP: ${hostname}`);
    }
    return url;
  }

  const records = await lookup(hostname, { all: true });
  if (records.length === 0) {
    throw new UnsafeImageUrlError(`Could not resolve hostname: ${hostname}`);
  }
  for (const record of records) {
    if (isPrivateIp(record.address)) {
      throw new UnsafeImageUrlError(
        `Refusing to fetch ${hostname}: resolves to private/loopback IP ${record.address}`
      );
    }
  }

  return url;
}
