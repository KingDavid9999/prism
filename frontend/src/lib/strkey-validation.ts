import { StrKey } from "@stellar/stellar-sdk";

/**
 * True for a valid ed25519 account address (G…), checksum included. Checked
 * before any Horizon request, so a malformed ID gets a 404 without a round trip.
 */
export function isAccountId(id: string): boolean {
  return StrKey.isValidEd25519PublicKey(id);
}
