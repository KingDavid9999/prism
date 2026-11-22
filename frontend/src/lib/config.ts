// Single source of truth for which Stellar network Prism is pointed at.
//
// These are NEXT_PUBLIC_* vars because they describe the deployment rather
// than a secret, but every current consumer is server-side, where Next reads
// them at runtime — so `docker compose up` can repoint a prebuilt image.

export type StellarNetwork = "testnet" | "mainnet" | "futurenet" | "local";

export const NETWORKS: StellarNetwork[] = [
  "testnet",
  "mainnet",
  "futurenet",
  "local",
];

type PublicNetwork = Exclude<StellarNetwork, "local">;

/** Passphrases for the public networks. `local` takes its passphrase from NEXT_PUBLIC_NETWORK_PASSPHRASE. */
const PUBLIC_PASSPHRASES: Record<PublicNetwork, string> = {
  testnet: "Test SDF Network ; September 2015",
  mainnet: "Public Global Stellar Network ; September 2015",
  futurenet: "Test SDF Future Network ; October 2022",
};

/** Public endpoints for each public network, used when an explicit URL isn't configured. */
const DEFAULT_ENDPOINTS: Record<
  PublicNetwork,
  { horizon: string; rpc: string }
> = {
  testnet: {
    horizon: "https://horizon-testnet.stellar.org",
    rpc: "https://soroban-testnet.stellar.org",
  },
  mainnet: {
    horizon: "https://horizon.stellar.org",
    rpc: "https://mainnet.sorobanrpc.com",
  },
  futurenet: {
    horizon: "https://horizon-futurenet.stellar.org",
    rpc: "https://rpc-futurenet.stellar.org",
  },
};

export interface PrismConfig {
  network: StellarNetwork;
  networkPassphrase: string;
  horizonUrl: string;
  sorobanRpcUrl: string;
  siteUrl: string;
  /** The raw NEXT_PUBLIC_NETWORK value when it was not recognised, otherwise null. */
  unknownNetwork?: string | null;
}

/**
 * Coerce a raw NEXT_PUBLIC_NETWORK value to a known network, defaulting to testnet.
 * `local` (or `custom`) is a private network such as stellar/quickstart; it has
 * no public defaults and must be fully configured by resolveConfig.
 */
export function parseNetwork(raw: string | undefined): StellarNetwork {
  const value = raw?.trim().toLowerCase();
  if (value === "mainnet" || value === "public" || value === "pubnet")
    return "mainnet";
  if (value === "futurenet") return "futurenet";
  if (value === "local" || value === "custom") return "local";
  return "testnet";
}

type EnvLike = Record<string, string | undefined>;

const trimSlashes = (url: string): string => url.replace(/\/+$/, "");

/**
 * Build the effective config from an environment.
 *
 * Endpoint defaults follow the selected network rather than being pinned to
 * testnet, so NEXT_PUBLIC_NETWORK=mainnet on its own gives a coherent
 * deployment instead of mainnet's passphrase over testnet's data.
 *
 * A `local` network throws unless its passphrase and both endpoints are set:
 * there is no sensible default to fall back to, and guessing one would sign
 * transactions for the wrong network.
 */
export function resolveConfig(env: EnvLike): PrismConfig {
  const network = parseNetwork(env.NEXT_PUBLIC_NETWORK);
  const siteUrl = env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

  if (network === "local") {
    const missing: string[] = [];
    const requireEnv = (name: string): string => {
      const value = env[name]?.trim();
      if (!value) missing.push(name);
      return value ?? "";
    };
    const networkPassphrase = requireEnv("NEXT_PUBLIC_NETWORK_PASSPHRASE");
    const horizonUrl = requireEnv("NEXT_PUBLIC_HORIZON_URL");
    const sorobanRpcUrl = requireEnv("NEXT_PUBLIC_SOROBAN_RPC_URL");
    if (missing.length > 0) {
      throw new Error(
        `NEXT_PUBLIC_NETWORK=local requires ${missing.join(", ")} (a local network has no public defaults).`
      );
    }
    return {
      network,
      networkPassphrase,
      horizonUrl: trimSlashes(horizonUrl),
      sorobanRpcUrl: trimSlashes(sorobanRpcUrl),
      siteUrl,
    };
  }

  const defaults = DEFAULT_ENDPOINTS[network];
  return {
    network,
    networkPassphrase: PUBLIC_PASSPHRASES[network],
    horizonUrl: trimSlashes(env.NEXT_PUBLIC_HORIZON_URL || defaults.horizon),
    sorobanRpcUrl: trimSlashes(env.NEXT_PUBLIC_SOROBAN_RPC_URL || defaults.rpc),
    siteUrl,
  };
}

/**
 * Guess which network an endpoint serves from its hostname. Returns null for
 * hosts that carry no hint — self-hosters run their own nodes on arbitrary
 * domains, and a wrong guess there is worse than no guess.
 */
export function detectNetworkFromUrl(url: string): StellarNetwork | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host.includes("futurenet")) return "futurenet";
  if (host.includes("testnet")) return "testnet";
  if (host.includes("mainnet") || host.includes("pubnet")) return "mainnet";
  if (host === "horizon.stellar.org") return "mainnet";
  return null;
}

/**
 * Synchronous hostname check on Horizon. Soroban RPC is checked by passphrase
 * instead (see rpcNetworkWarnings), since self-hosted nodes rarely carry a
 * network name in their hostname. A local network has no public hostnames to
 * compare against, so it is never flagged here.
 */
export function configWarnings(cfg: PrismConfig): string[] {
  if (cfg.network === "local") return [];
  const detected = detectNetworkFromUrl(cfg.horizonUrl);
  if (detected && detected !== cfg.network) {
    return [
      `Horizon endpoint (${cfg.horizonUrl}) looks like ${detected}, but NEXT_PUBLIC_NETWORK is set to ${cfg.network}.`,
    ];
  }
  return [];
}

/**
 * Compare a passphrase reported by an RPC node with the configured one.
 * Returns a warning, or null when they match. A mismatch is quietly
 * destructive: contract simulation is signed with the configured passphrase
 * while the data on screen comes from whatever the node actually serves.
 */
export function passphraseWarning(
  cfg: PrismConfig,
  reported: string
): string | null {
  if (reported === cfg.networkPassphrase) return null;
  return (
    `Soroban RPC (${cfg.sorobanRpcUrl}) reports network passphrase "${reported}", ` +
    `but NEXT_PUBLIC_NETWORK is set to ${cfg.network} ("${cfg.networkPassphrase}").`
  );
}

const rpcPassphraseCache = new Map<string, Promise<string>>();

/**
 * The passphrase a Soroban RPC node reports from its getNetwork method, cached
 * per URL. A failed lookup is evicted so the next call retries it.
 */
export function getRpcPassphrase(rpcUrl: string): Promise<string> {
  const cached = rpcPassphraseCache.get(rpcUrl);
  if (cached) return cached;

  const pending = fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getNetwork" }),
    signal: AbortSignal.timeout(5_000),
  }).then(async (res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { result?: { passphrase?: unknown } };
    const passphrase = body.result?.passphrase;
    if (typeof passphrase !== "string")
      throw new Error("getNetwork returned no passphrase");
    return passphrase;
  });

  rpcPassphraseCache.set(rpcUrl, pending);
  pending.catch(() => rpcPassphraseCache.delete(rpcUrl));
  return pending;
}

/**
 * Warnings from comparing the RPC node's network passphrase with the configured
 * one. An unreachable node yields no warning: the RPC being down is a separate
 * problem, and a banner claiming a mismatch that was never observed would mislead.
 */
export async function rpcNetworkWarnings(cfg: PrismConfig): Promise<string[]> {
  let reported: string;
  try {
    reported = await getRpcPassphrase(cfg.sorobanRpcUrl);
  } catch {
    return [];
  }
  const warning = passphraseWarning(cfg, reported);
  return warning ? [warning] : [];
}

export const config: PrismConfig = resolveConfig(process.env);
