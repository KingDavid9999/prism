import { Asset } from "@stellar/stellar-sdk";

/**
 * Resolves a raw search query to a Next.js route string, or null when the
 * query matches no known format. The SearchBar and the /search page both call
 * this. The SearchBar runs in the browser and has no network passphrase, so it
 * sends asset queries to /search, where the server passes the configured
 * passphrase and routes them to the asset's contract.
 *
 * Formats recognised:
 *  - Transaction hash: 64 lowercase hex characters
 *  - Contract ID: Soroban strkey — starts with C, 56 base-32 chars total
 *  - Account address: ED25519 strkey — starts with G, 56 base-32 chars total
 *  - Ledger sequence: one or more decimal digits
 *  - Asset (needs networkPassphrase): `native` or `XLM`, or `CODE:ISSUER`,
 *    routed to the asset's Stellar Asset Contract
 */
export function resolveSearchRoute(
  raw: string,
  networkPassphrase?: string
): string | null {
  const q = raw.trim();
  if (!q) return null;

  if (/^[0-9a-fA-F]{64}$/.test(q)) return `/tx/${q}`;
  if (/^C[A-Z2-7]{55}$/.test(q)) return `/contract/${q}`;
  if (/^G[A-Z2-7]{55}$/.test(q)) return `/account/${q}`;
  if (/^\d+$/.test(q)) return `/ledger/${q}`;

  if (networkPassphrase !== undefined) {
    const contractId = assetContractId(q, networkPassphrase);
    if (contractId) return `/contract/${contractId}`;
  }

  return `/search?q=${encodeURIComponent(q)}`;
}

/**
 * The Stellar Asset Contract ID for `native`, `XLM` or `CODE:ISSUER` on the
 * given network, or null when the query isn't a valid asset. Asset codes are
 * case-sensitive, as they are on the network, so `usdc` is not `USDC`.
 */
export function assetContractId(
  raw: string,
  networkPassphrase: string
): string | null {
  const q = raw.trim();
  try {
    if (/^(native|xlm)$/i.test(q)) {
      return Asset.native().contractId(networkPassphrase);
    }
    const parts = q.split(":");
    if (parts.length !== 2 || !parts[1]) return null;
    return new Asset(parts[0], parts[1]).contractId(networkPassphrase);
  } catch {
    // The Asset constructor rejects a bad code or issuer; treat it as no match.
    return null;
  }
}
