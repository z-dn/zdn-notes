import { isIP } from 'net'
import { promises as dns } from 'dns'

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number)
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

const PRIVATE_IPV4_RANGES: Array<[number, number]> = [
  [0x00000000, 0x00ffffff], // 0.0.0.0/8
  [0x0a000000, 0x0affffff], // 10.0.0.0/8
  [0x64400000, 0x647fffff], // 100.64.0.0/10 (CGNAT)
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 (link-local)
  [0xac100000, 0xac1fffff], // 172.16.0.0/12
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16
  [0xe0000000, 0xefffffff], // 224.0.0.0/4 (multicast)
  [0xf0000000, 0xffffffff], // 240.0.0.0/4 (reserved)
]

function isPrivateIPv4(ip: string): boolean {
  if (isIP(ip) !== 4) return false
  const num = ipv4ToInt(ip)
  return PRIVATE_IPV4_RANGES.some(([lo, hi]) => num >= lo && num <= hi)
}

function isPrivateIPv6(ip: string): boolean {
  if (isIP(ip) !== 6) return false
  const lower = ip.toLowerCase()
  if (lower === '::' || lower === '::1') return true
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true // fc00::/7
  if (
    lower.startsWith('fe8') ||
    lower.startsWith('fe9') ||
    lower.startsWith('fea') ||
    lower.startsWith('feb')
  )
    return true // fe80::/10
  if (lower.startsWith('::ffff:')) {
    return isPrivateIPv4(lower.slice('::ffff:'.length))
  }
  return false
}

export function isPrivateHostnameLiteral(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (h.endsWith('.local')) return true
  const ipv = isIP(h)
  if (ipv === 4) return isPrivateIPv4(h)
  if (ipv === 6) return isPrivateIPv6(h)
  return false
}

export async function isPrivateHost(hostname: string): Promise<boolean> {
  if (isPrivateHostnameLiteral(hostname)) return true
  try {
    const addresses = await dns.lookup(hostname, { all: true })
    for (const a of addresses) {
      if (a.family === 4 && isPrivateIPv4(a.address)) return true
      if (a.family === 6 && isPrivateIPv6(a.address)) return true
    }
    return false
  } catch {
    // unresolvable host: let the actual request fail with its own error
    return false
  }
}
