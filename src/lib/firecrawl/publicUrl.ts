import dns from "node:dns/promises";
import net from "node:net";

// Runtime-neutral SSRF guard shared by Next server code and the standalone
// scan worker. Keep client-facing modules behind webFetch's server-only marker.
export async function validatePublicHttpUrl(url: string): Promise<string> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Website URL must use http or https");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Website URL cannot contain credentials");
  }

  const hostname = parsed.hostname
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "metadata.google.internal"
  ) {
    throw new Error("Website URL cannot point to a private host");
  }

  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new Error("Website URL cannot point to a private IP address");
    }
    return parsed.toString();
  }

  const addresses = await dns.lookup(hostname, { all: true, verbatim: false });
  if (addresses.length === 0) throw new Error("Website host could not be resolved");
  if (addresses.some((address) => isBlockedIp(address.address))) {
    throw new Error("Website URL resolves to a private IP address");
  }
  return parsed.toString();
}

function isBlockedIp(address: string): boolean {
  const version = net.isIP(address);
  if (version === 4) return isBlockedIpv4(address);
  if (version === 6) return isBlockedIpv6(address);
  return true;
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  const [a, b] = parts;
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && b === 51 && parts[2] === 100) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 203 && b === 0 && parts[2] === 113) return true;
  if (a >= 224) return true;
  return address === "169.254.169.254";
}

function isBlockedIpv6(address: string): boolean {
  const words = ipv6Words(address);
  if (!words) return true;
  const [first, second] = words;

  if (words.every((word) => word === 0)) return true; // unspecified
  if (words.slice(0, 7).every((word) => word === 0) && words[7] === 1) return true;
  if ((first & 0xfe00) === 0xfc00) return true; // unique-local fc00::/7
  if ((first & 0xff00) === 0xfe00) return true; // link/site-local fe00::/8
  if ((first & 0xff00) === 0xff00) return true; // multicast ff00::/8
  if (first === 0x0100 && words.slice(1, 4).every((word) => word === 0)) return true;
  if (first === 0x2001 && second === 0x0db8) return true; // documentation
  if (first === 0x2001 && second <= 0x01ff) return true; // special-use/tunnel ranges
  if (first === 0x2002) return true; // 6to4 can conceal a private IPv4

  // IPv4-mapped IPv6: apply the complete IPv4 guard to the embedded address.
  if (
    words.slice(0, 5).every((word) => word === 0) &&
    words[5] === 0xffff
  ) {
    const mapped = [
      words[6] >> 8,
      words[6] & 0xff,
      words[7] >> 8,
      words[7] & 0xff,
    ].join(".");
    return isBlockedIpv4(mapped);
  }

  // Reject deprecated IPv4-compatible and any address outside today's global
  // unicast 2000::/3 allocation. This intentionally fails closed for unknown
  // special-use ranges rather than allowing internal reachability.
  if (words.slice(0, 6).every((word) => word === 0)) return true;
  return (first & 0xe000) !== 0x2000;
}

function ipv6Words(address: string): number[] | null {
  const normalized = address.split("%")[0].toLowerCase();
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const parse = (part: string): number | null => {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
    const value = Number.parseInt(part, 16);
    return value >= 0 && value <= 0xffff ? value : null;
  };
  const leftWords = left.map(parse);
  const rightWords = right.map(parse);
  if ([...leftWords, ...rightWords].some((word) => word === null)) return null;
  const missing = 8 - leftWords.length - rightWords.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) {
    return null;
  }
  return [
    ...(leftWords as number[]),
    ...Array.from({ length: missing }, () => 0),
    ...(rightWords as number[]),
  ];
}
