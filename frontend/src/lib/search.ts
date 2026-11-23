import { splitMuxedAddress } from "./muxed";

/**
 * Resolves a raw search query to a Next.js route string, or null when the
 * query matches no known format. Both the SearchBar and the /search page
 * call this so they always agree on routing.
 *
 * Formats recognised:
 *  - Transaction hash: 64 hex characters, in either case (routed in lowercase)
 *  - Contract ID: Soroban strkey — starts with C, 56 base-32 chars total
 *  - Account address: ED25519 strkey — starts with G, 56 base-32 chars total
 *  - Muxed account address: starts with M, 69 base-32 chars total. Routes to
 *    its base G account, with the muxed ID in `?muxed=`.
 *  - Ledger sequence: one or more decimal digits
 */
export function resolveSearchRoute(raw: string): string | null {
  const q = raw.trim();
  if (!q) return null;

  // Horizon only knows lowercase hashes, so an upper-case paste must be folded.
  if (/^[0-9a-fA-F]{64}$/.test(q)) return `/tx/${q.toLowerCase()}`;
  if (/^C[A-Z2-7]{55}$/.test(q)) return `/contract/${q}`;
  if (/^G[A-Z2-7]{55}$/.test(q)) return `/account/${q}`;
  const muxed = splitMuxedAddress(q);
  if (muxed) return `/account/${muxed.account}?muxed=${muxed.id}`;
  if (/^\d+$/.test(q)) return `/ledger/${q}`;

  return `/search?q=${encodeURIComponent(q)}`;
}
