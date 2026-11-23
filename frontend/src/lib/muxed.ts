/**
 * Muxed (M…) account addresses, parsed without stellar-sdk so the client-side
 * search can use them. An M… address is a G… account plus a 64-bit ID
 * (CAP-27, SEP-23). Both strkeys are base32 of
 * [version byte][payload][CRC16-XModem, little-endian].
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const MUXED_STRKEY = /^M[A-Z2-7]{68}$/;
const VERSION_ED25519 = 6 << 3; // leading "G"
const VERSION_MUXED = 12 << 3; // leading "M"

export interface MuxedAddressParts {
  /** The base G… account that the M… address multiplexes. */
  account: string;
  /** The 64-bit muxed ID, in decimal. */
  id: string;
}

/**
 * Split an M… address into its base G… account and its decimal ID. Returns
 * null unless the input is a well-formed M… strkey with a valid checksum.
 */
export function splitMuxedAddress(address: string): MuxedAddressParts | null {
  if (!MUXED_STRKEY.test(address)) return null;
  const bytes = base32Decode(address);
  // One version byte, a 32-byte ed25519 key, an 8-byte ID and a 2-byte checksum.
  if (!bytes || bytes.length !== 43 || bytes[0] !== VERSION_MUXED) return null;
  // Re-encoding rejects a non-zero padding bit, so only the canonical spelling passes.
  if (base32Encode(bytes) !== address) return null;
  const checksum = bytes[41] | (bytes[42] << 8);
  if (crc16(bytes.subarray(0, 41)) !== checksum) return null;

  let id = BigInt(0);
  for (let i = 33; i < 41; i++) {
    id = (id << BigInt(8)) | BigInt(bytes[i]);
  }
  return { account: encodeEd25519(bytes.subarray(1, 33)), id: id.toString() };
}

/** The G… strkey for a 32-byte ed25519 public key. */
function encodeEd25519(key: Uint8Array): string {
  const payload = new Uint8Array(35);
  payload[0] = VERSION_ED25519;
  payload.set(key, 1);
  const checksum = crc16(payload.subarray(0, 33));
  payload[33] = checksum & 0xff;
  payload[34] = checksum >> 8;
  return base32Encode(payload);
}

function base32Decode(text: string): Uint8Array | null {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < text.length; i++) {
    const index = BASE32_ALPHABET.indexOf(text.charAt(i));
    if (index < 0) return null;
    buffer = ((buffer << 5) | index) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

function base32Encode(bytes: Uint8Array): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < bytes.length; i++) {
    buffer = ((buffer << 8) | bytes[i]) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET.charAt((buffer >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET.charAt((buffer << (5 - bits)) & 31);
  return out;
}

/** CRC16-XModem (polynomial 0x1021, initial value 0), as Stellar strkeys use. */
function crc16(bytes: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc =
        crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}
