import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configWarnings,
  detectNetworkFromUrl,
  parseNetwork,
  resolveConfig,
  rpcNetworkWarnings,
} from "./config";

describe("parseNetwork", () => {
  it("accepts the documented values", () => {
    expect(parseNetwork("testnet")).toBe("testnet");
    expect(parseNetwork("mainnet")).toBe("mainnet");
    expect(parseNetwork("futurenet")).toBe("futurenet");
  });

  it("accepts the names Stellar tooling uses for mainnet", () => {
    expect(parseNetwork("public")).toBe("mainnet");
    expect(parseNetwork("pubnet")).toBe("mainnet");
  });

  it("is case and whitespace insensitive", () => {
    expect(parseNetwork("  MainNet \n")).toBe("mainnet");
  });

  it("falls back to testnet for missing or unknown values", () => {
    expect(parseNetwork(undefined)).toBe("testnet");
    expect(parseNetwork("")).toBe("testnet");
    expect(parseNetwork("mainet")).toBe("testnet");
  });
});

describe("resolveConfig", () => {
  it("defaults to testnet endpoints with an empty environment", () => {
    const cfg = resolveConfig({});
    expect(cfg.network).toBe("testnet");
    expect(cfg.horizonUrl).toBe("https://horizon-testnet.stellar.org");
    expect(cfg.sorobanRpcUrl).toBe("https://soroban-testnet.stellar.org");
    expect(cfg.siteUrl).toBe("http://localhost:3000");
  });

  it("follows the network when picking endpoint defaults", () => {
    const cfg = resolveConfig({ NEXT_PUBLIC_NETWORK: "mainnet" });
    expect(cfg.horizonUrl).toBe("https://horizon.stellar.org");
    expect(cfg.sorobanRpcUrl).toBe("https://mainnet.sorobanrpc.com");
  });

  it("lets explicit endpoints override the defaults", () => {
    const cfg = resolveConfig({
      NEXT_PUBLIC_NETWORK: "mainnet",
      NEXT_PUBLIC_HORIZON_URL: "https://horizon.example.com",
    });
    expect(cfg.horizonUrl).toBe("https://horizon.example.com");
    expect(cfg.sorobanRpcUrl).toBe("https://mainnet.sorobanrpc.com");
  });

  it("strips trailing slashes so path concatenation can't double up", () => {
    const cfg = resolveConfig({
      NEXT_PUBLIC_HORIZON_URL: "https://horizon.example.com/",
    });
    expect(cfg.horizonUrl).toBe("https://horizon.example.com");
  });

  it("treats an empty string as unset rather than as an endpoint", () => {
    const cfg = resolveConfig({ NEXT_PUBLIC_HORIZON_URL: "" });
    expect(cfg.horizonUrl).toBe("https://horizon-testnet.stellar.org");
  });
});

describe("detectNetworkFromUrl", () => {
  it("recognizes the public endpoints for each network", () => {
    expect(detectNetworkFromUrl("https://horizon-testnet.stellar.org")).toBe(
      "testnet"
    );
    expect(detectNetworkFromUrl("https://soroban-testnet.stellar.org")).toBe(
      "testnet"
    );
    expect(detectNetworkFromUrl("https://horizon.stellar.org")).toBe("mainnet");
    expect(detectNetworkFromUrl("https://mainnet.sorobanrpc.com")).toBe(
      "mainnet"
    );
    expect(detectNetworkFromUrl("https://rpc-futurenet.stellar.org")).toBe(
      "futurenet"
    );
  });

  it("returns null for a self-hosted node with no hint in the hostname", () => {
    expect(detectNetworkFromUrl("https://rpc.internal.example.com")).toBeNull();
  });

  it("returns null rather than throwing on a malformed URL", () => {
    expect(detectNetworkFromUrl("not a url")).toBeNull();
  });
});

describe("configWarnings", () => {
  it("is silent on a coherent deployment", () => {
    expect(
      configWarnings(resolveConfig({ NEXT_PUBLIC_NETWORK: "mainnet" }))
    ).toEqual([]);
    expect(configWarnings(resolveConfig({}))).toEqual([]);
  });

  it("flags an endpoint that disagrees with the configured network", () => {
    const cfg = resolveConfig({
      NEXT_PUBLIC_NETWORK: "mainnet",
      NEXT_PUBLIC_HORIZON_URL: "https://horizon-testnet.stellar.org",
    });
    const warnings = configWarnings(cfg);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Horizon");
    expect(warnings[0]).toContain("testnet");
  });

  it("does not judge the RPC hostname; the RPC is checked by passphrase instead", () => {
    const cfg = resolveConfig({
      NEXT_PUBLIC_NETWORK: "futurenet",
      NEXT_PUBLIC_SOROBAN_RPC_URL: "https://soroban-testnet.stellar.org",
    });
    expect(configWarnings(cfg)).toEqual([]);
  });

  it("stays silent for custom hosts it can't classify", () => {
    const cfg = resolveConfig({
      NEXT_PUBLIC_NETWORK: "mainnet",
      NEXT_PUBLIC_HORIZON_URL: "https://horizon.internal.example.com",
    });
    expect(configWarnings(cfg)).toEqual([]);
  });
});

describe("parseNetwork for local networks", () => {
  it("accepts local and custom", () => {
    expect(parseNetwork("local")).toBe("local");
    expect(parseNetwork("custom")).toBe("local");
  });
});

describe("public network passphrases", () => {
  it("match the ones the Stellar SDK uses", () => {
    expect(
      resolveConfig({ NEXT_PUBLIC_NETWORK: "testnet" }).networkPassphrase
    ).toBe("Test SDF Network ; September 2015");
    expect(
      resolveConfig({ NEXT_PUBLIC_NETWORK: "mainnet" }).networkPassphrase
    ).toBe("Public Global Stellar Network ; September 2015");
    expect(
      resolveConfig({ NEXT_PUBLIC_NETWORK: "futurenet" }).networkPassphrase
    ).toBe("Test SDF Future Network ; October 2022");
  });
});

describe("local network", () => {
  const local = {
    NEXT_PUBLIC_NETWORK: "local",
    NEXT_PUBLIC_NETWORK_PASSPHRASE: "Standalone Network ; February 2017",
    NEXT_PUBLIC_HORIZON_URL: "http://localhost:8000",
    NEXT_PUBLIC_SOROBAN_RPC_URL: "http://localhost:8000/soroban/rpc/",
  };

  it("uses the configured passphrase and endpoints", () => {
    const cfg = resolveConfig(local);
    expect(cfg.network).toBe("local");
    expect(cfg.networkPassphrase).toBe("Standalone Network ; February 2017");
    expect(cfg.horizonUrl).toBe("http://localhost:8000");
    expect(cfg.sorobanRpcUrl).toBe("http://localhost:8000/soroban/rpc");
  });

  it("refuses to start without a passphrase or explicit endpoints", () => {
    expect(() => resolveConfig({ NEXT_PUBLIC_NETWORK: "local" })).toThrow(
      "NEXT_PUBLIC_NETWORK_PASSPHRASE, NEXT_PUBLIC_HORIZON_URL, NEXT_PUBLIC_SOROBAN_RPC_URL"
    );
  });

  it("names only the variables that are missing", () => {
    expect(() =>
      resolveConfig({ ...local, NEXT_PUBLIC_HORIZON_URL: "" })
    ).toThrow(/requires NEXT_PUBLIC_HORIZON_URL /);
  });

  it("is never flagged by hostname checks", () => {
    expect(configWarnings(resolveConfig(local))).toEqual([]);
  });
});

describe("rpcNetworkWarnings", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubRpcPassphrase(passphrase: string) {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: { passphrase, protocolVersion: 21 },
          }),
          {
            status: 200,
          }
        )
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("is silent when the node reports the configured passphrase", async () => {
    stubRpcPassphrase("Public Global Stellar Network ; September 2015");
    const cfg = resolveConfig({
      NEXT_PUBLIC_NETWORK: "mainnet",
      NEXT_PUBLIC_SOROBAN_RPC_URL: "https://rpc-match.example.com",
    });
    expect(await rpcNetworkWarnings(cfg)).toEqual([]);
  });

  it("flags a custom-domain node that serves another network", async () => {
    stubRpcPassphrase("Test SDF Network ; September 2015");
    const cfg = resolveConfig({
      NEXT_PUBLIC_NETWORK: "mainnet",
      NEXT_PUBLIC_SOROBAN_RPC_URL: "https://rpc-mismatch.example.com",
    });
    const warnings = await rpcNetworkWarnings(cfg);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Test SDF Network ; September 2015");
    expect(warnings[0]).toContain("mainnet");
  });

  it("caches a successful lookup per URL", async () => {
    const fetchMock = stubRpcPassphrase(
      "Public Global Stellar Network ; September 2015"
    );
    const cfg = resolveConfig({
      NEXT_PUBLIC_NETWORK: "mainnet",
      NEXT_PUBLIC_SOROBAN_RPC_URL: "https://rpc-cache.example.com",
    });
    await rpcNetworkWarnings(cfg);
    await rpcNetworkWarnings(cfg);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives no warning for an unreachable node, and retries on the next call", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      })
    );
    const cfg = resolveConfig({
      NEXT_PUBLIC_NETWORK: "mainnet",
      NEXT_PUBLIC_SOROBAN_RPC_URL: "https://rpc-down.example.com",
    });
    expect(await rpcNetworkWarnings(cfg)).toEqual([]);

    stubRpcPassphrase("Test SDF Network ; September 2015");
    expect(await rpcNetworkWarnings(cfg)).toHaveLength(1);
  });
});
