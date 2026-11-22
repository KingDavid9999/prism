import { config, configWarnings, rpcNetworkWarnings } from "@/lib/config";

/**
 * Warn when the configured network disagrees with the network the endpoints
 * actually serve. This failure mode is silent and misleading rather than loud:
 * pages render fine with data from one network while simulation signs against
 * another's passphrase, so every number on screen looks plausible.
 *
 * Soroban RPC is checked by asking the node for its network passphrase
 * (getNetwork, cached), so self-hosted nodes on custom domains are covered.
 *
 * Renders nothing on a coherent deployment, which is the common case.
 */
export default async function ConfigWarning() {
  const warnings = [
    ...configWarnings(config),
    ...(await rpcNetworkWarnings(config)),
  ];
  if (warnings.length === 0) return null;

  return (
    <div className="border-b border-prism-red/30 bg-prism-red/10 px-4 py-2">
      <div className="max-w-7xl mx-auto text-xs text-prism-red space-y-1">
        {warnings.map((warning) => (
          <p key={warning}>
            <span className="font-bold">Config mismatch:</span> {warning}
          </p>
        ))}
      </div>
    </div>
  );
}
