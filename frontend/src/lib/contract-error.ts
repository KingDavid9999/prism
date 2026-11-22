// Turning a contract's numeric error code into the name it has in source.
//
// Deliberately free of runtime imports: the invoke tool is a client component,
// and this works on strings the server already produced, so there's no reason
// to pull stellar-sdk into the browser bundle. The type import is erased at
// compile time.
import type { ContractTypeDef } from "@/types";
import type { xdr } from "@stellar/stellar-sdk";

/**
 * A contract error as the host reports it, e.g. "Error(Contract, #3)" inside a
 * longer HostError message. Codes from other error types (Storage, Budget,
 * WasmVm) are the host's own and have nothing to do with the contract's enum,
 * so only Contract codes are matched.
 */
const CONTRACT_ERROR_CODE = /Error\(Contract,\s*#(\d+)\)/;

/**
 * Name the contract error in a failed simulation's message, using the error
 * enum from the contract's own ABI.
 *
 * Returns null when there's no contract code in the message, when the contract
 * declares no error enum, or when it declares one that doesn't cover this code
 * — all of which happen, and inventing a name for an unknown code would be
 * worse than showing the number.
 */
export function describeContractError(
  message: string,
  types: ContractTypeDef[]
): { name: string; code: number; doc?: string } | null {
  const match = CONTRACT_ERROR_CODE.exec(message);
  if (!match) return null;

  const code = Number(match[1]);
  for (const def of types) {
    if (def.kind !== "error") continue;
    const found = def.cases.find((c) => c.value === code);
    if (found)
      return { name: `${def.name}::${found.name}`, code, doc: def.doc };
  }
  return null;
}

/**
 * Render a host error from a diagnostic event the way Stellar tooling does:
 * `Error(Contract, #3)` for a contract's own error, or e.g.
 * `Error(Budget, ExceededLimit)` for one raised by the host. Takes the
 * already-decoded ScError, so this module still needs no runtime SDK import.
 */
export function formatHostError(error: xdr.ScError): string {
  const kind = error.switch().name;
  if (kind === "sceContract")
    return `Error(Contract, #${error.contractCode()})`;
  return `Error(${kind.replace(/^sce/, "")}, ${error.code().name.replace(/^scec/, "")})`;
}
