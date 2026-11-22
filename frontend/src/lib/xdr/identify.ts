import {
  Address,
  StrKey,
  encodeMuxedAccountToAddress,
  xdr,
} from "@stellar/stellar-sdk";
import { decodeScVal, scValToDisplay } from "./display";
import { decodeInvocation, getResourceUsage, v1Tx } from "./invocation";
import { specTypeToString } from "./spec";

/**
 * XDR types the decoder will try when handed an unlabelled base64 blob, in the
 * order it tries them. ScVal sits last on purpose: it is by far the most
 * permissive type, so anything that also parses as a richer type should be
 * reported as that type instead.
 */
const CANDIDATE_XDR_TYPES = [
  "TransactionEnvelope",
  "TransactionResult",
  "TransactionMeta",
  "LedgerEntry",
  "LedgerKey",
  "ScSpecEntry",
  "ScVal",
] as const;

export type XdrTypeName = (typeof CANDIDATE_XDR_TYPES)[number];

export interface XdrField {
  label: string;
  value: string;
}

export interface XdrDecodeResult {
  type: XdrTypeName;
  fields: XdrField[];
  /**
   * True when the blob is a recognized type but its contents couldn't be
   * summarized, so `fields` is empty and the reader should be told so.
   */
  partial: boolean;
}

/**
 * Recover a base64 blob from a URL query parameter.
 *
 * Query strings decode "+" as a space, and base64 is full of pluses. Links
 * Prism generates are percent-encoded and round-trip exactly, but a
 * hand-assembled URL won't be — and base64 has no legitimate spaces, so any
 * space in a query parameter was a plus.
 */
export function base64FromQueryParam(raw: string): string {
  return raw.replace(/ /g, "+");
}

/** Strip whitespace/newlines that survive a copy-paste out of a terminal or JSON blob. */
export function normalizeBase64(input: string): string {
  return input.replace(/\s+/g, "");
}

/**
 * Identify which XDR type a base64 blob actually is.
 *
 * XDR is not self-describing, so "it parsed" is a weak signal — plenty of blobs
 * parse as several types, producing garbage for all but one. The round-trip
 * check (decode, re-encode, compare bytes) is what makes this trustworthy: a
 * type that consumed every byte and reproduces the input exactly is a real
 * match, not a prefix that happened to parse.
 */
export function identifyXdr(input: string): XdrTypeName | null {
  const base64 = normalizeBase64(input);
  if (!base64) return null;

  for (const name of CANDIDATE_XDR_TYPES) {
    try {
      const type = xdr[name] as unknown as {
        fromXDR(
          data: string,
          format: "base64"
        ): { toXDR(format: "base64"): string };
      };
      if (type.fromXDR(base64, "base64").toXDR("base64") === base64)
        return name;
    } catch {
      // Not this type — keep going.
    }
  }
  return null;
}

function muxedAccountToAddress(account: xdr.MuxedAccount): string {
  try {
    if (account.switch().name === "keyTypeEd25519") {
      return StrKey.encodeEd25519PublicKey(account.ed25519());
    }
    const muxed = account.med25519();
    const base = StrKey.encodeEd25519PublicKey(muxed.ed25519());
    return `${encodeMuxedAccountToAddress(account)} (base ${base}, id ${muxed.id().toString()})`;
  } catch {
    return "(unrepresentable account)";
  }
}

function memoToDisplay(memo: xdr.Memo): string {
  const kind = memo.switch().name.replace(/^memo/, "").toLowerCase();
  try {
    switch (kind) {
      case "none":
        return "none";
      case "text":
        return `text: ${memo.text().toString()}`;
      case "id":
        return `id: ${memo.id().toString()}`;
      case "hash":
        return `hash: ${memo.hash().toString("hex")}`;
      case "return":
        return `return: ${memo.retHash().toString("hex")}`;
      default:
        return kind;
    }
  } catch {
    return kind;
  }
}

function transactionEnvelopeFields(
  envelope: xdr.TransactionEnvelope
): XdrField[] {
  const fields: XdrField[] = [
    { label: "Envelope type", value: envelope.switch().name },
  ];

  // v0 envelopes carry a bare ed25519 key where v1 carries a muxed account,
  // so the common fields have to be read from whichever shape this is.
  const tx = v1Tx(envelope);
  const v0 = tx ? null : envelope.v0().tx();

  if (tx || v0) {
    const source = tx
      ? muxedAccountToAddress(tx.sourceAccount())
      : StrKey.encodeEd25519PublicKey(v0!.sourceAccountEd25519());
    const body = tx ?? v0!;

    fields.push(
      { label: "Source account", value: source },
      { label: "Fee", value: `${body.fee()} stroops` },
      { label: "Sequence", value: body.seqNum().toString() },
      { label: "Memo", value: memoToDisplay(body.memo()) },
      {
        label: "Operations",
        value: body
          .operations()
          .map((op) => op.body().switch().name)
          .join(", "),
      }
    );
  }

  const invocation = decodeInvocation(envelope);
  if (invocation) {
    fields.push(
      { label: "Contract", value: invocation.contractId },
      { label: "Function", value: invocation.functionName },
      {
        label: "Arguments",
        value: invocation.args.length ? invocation.args.join(", ") : "(none)",
      }
    );
  }

  const resources = getResourceUsage(envelope);
  if (resources) {
    fields.push(
      { label: "Instructions", value: resources.instructions.toLocaleString() },
      {
        label: "Read / write bytes",
        value: `${resources.readBytes} / ${resources.writeBytes}`,
      },
      {
        label: "Resource fee",
        value: `${resources.resourceFeeStroops} stroops`,
      }
    );
  }

  return fields;
}

function transactionResultFields(result: xdr.TransactionResult): XdrField[] {
  const fields: XdrField[] = [
    {
      label: "Fee charged",
      value: `${result.feeCharged().toString()} stroops`,
    },
    { label: "Result", value: result.result().switch().name },
  ];

  try {
    const opResults = result.result().results();
    if (opResults?.length) {
      fields.push({
        label: "Operation results",
        value: opResults.map((op) => op.switch().name).join(", "),
      });
    }
  } catch {
    // Result codes like txBadSeq carry no per-operation results.
  }

  return fields;
}

/** Summarize a v4 (protocol 23+) meta: return value, events and ledger-entry changes. */
function transactionMetaV4Fields(v4: xdr.TransactionMetaV4): XdrField[] {
  const fields: XdrField[] = [];

  const returnValue = v4.sorobanMeta()?.returnValue();
  if (returnValue) {
    fields.push({ label: "Return value", value: scValToDisplay(returnValue) });
  }

  const operations = v4.operations();
  fields.push({
    label: "Events per operation",
    value: operations.length ? operations.map((op) => op.events().length).join(", ") : "(none)",
  });
  fields.push({ label: "Transaction events", value: String(v4.events().length) });

  const changes = [
    ...v4.txChangesBefore(),
    ...operations.flatMap((op) => op.changes()),
    ...v4.txChangesAfter(),
  ];
  const counts = new Map<string, number>();
  for (const change of changes) {
    const kind = change.switch().name.replace(/^ledgerEntry/, "").toLowerCase();
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  fields.push({
    label: "Ledger entry changes",
    value: counts.size
      ? [...counts].map(([kind, n]) => `${kind} ${n}`).join(", ")
      : "(none)",
  });

  return fields;
}

function transactionMetaFields(meta: xdr.TransactionMeta): XdrField[] {
  const fields: XdrField[] = [
    { label: "Meta version", value: `v${meta.switch()}` },
  ];

  try {
    const soroban = meta.switch() === 3 ? meta.v3().sorobanMeta() : null;
    if (soroban) {
      fields.push({ label: "Events", value: String(soroban.events().length) });
      fields.push({
        label: "Return value",
        value: scValToDisplay(soroban.returnValue()),
      });
    }
  } catch {
    // Non-Soroban transactions carry no Soroban meta.
  }

  if (meta.switch() === 4) {
    try {
      fields.push(...transactionMetaV4Fields(meta.v4()));
    } catch {
      // Leave the version line alone if the v4 body doesn't read cleanly.
    }
  }

  return fields;
}

function ledgerKeyFields(key: xdr.LedgerKey): XdrField[] {
  const kind = key.switch().name;
  const fields: XdrField[] = [{ label: "Key type", value: kind }];

  try {
    if (kind === "contractData") {
      const data = key.contractData();
      fields.push(
        {
          label: "Contract",
          value: Address.fromScAddress(data.contract()).toString(),
        },
        { label: "Durability", value: data.durability().name },
        { label: "Storage key", value: scValToDisplay(data.key()) }
      );
    } else if (kind === "contractCode") {
      fields.push({
        label: "WASM hash",
        value: key.contractCode().hash().toString("hex"),
      });
    } else if (kind === "account") {
      fields.push({
        label: "Account",
        value: StrKey.encodeEd25519PublicKey(
          key.account().accountId().ed25519()
        ),
      });
    }
  } catch {
    // Fall through to just the key type.
  }

  return fields;
}

function ledgerEntryFields(entry: xdr.LedgerEntry): XdrField[] {
  const data = entry.data();
  const kind = data.switch().name;
  const fields: XdrField[] = [
    { label: "Entry type", value: kind },
    {
      label: "Last modified ledger",
      value: String(entry.lastModifiedLedgerSeq()),
    },
  ];

  try {
    if (kind === "contractData") {
      const d = data.contractData();
      fields.push(
        {
          label: "Contract",
          value: Address.fromScAddress(d.contract()).toString(),
        },
        { label: "Durability", value: d.durability().name },
        { label: "Storage key", value: scValToDisplay(d.key()) },
        { label: "Value", value: scValToDisplay(d.val()) }
      );
    } else if (kind === "contractCode") {
      fields.push({
        label: "WASM hash",
        value: data.contractCode().hash().toString("hex"),
      });
    } else if (kind === "ttl") {
      const ttl = data.ttl();
      fields.push(
        { label: "Key hash", value: ttl.keyHash().toString("hex") },
        { label: "Live until ledger", value: String(ttl.liveUntilLedgerSeq()) }
      );
    }
  } catch {
    // Keep the type and ledger lines if the entry body doesn't read cleanly.
  }

  return fields;
}

function specEntryFields(entry: xdr.ScSpecEntry): XdrField[] {
  const kind = entry.switch().name;
  const fields: XdrField[] = [{ label: "Spec entry", value: kind }];
  if (kind === "scSpecEntryFunctionV0") {
    const fn = entry.functionV0();
    fields.push(
      { label: "Function", value: fn.name().toString() },
      {
        label: "Inputs",
        value:
          fn
            .inputs()
            .map(
              (input) =>
                `${input.name().toString()}: ${specTypeToString(input.type())}`
            )
            .join(", ") || "(none)",
      },
      {
        label: "Outputs",
        value: fn.outputs().map(specTypeToString).join(", ") || "(none)",
      }
    );
  }
  return fields;
}

function scValFields(value: xdr.ScVal): XdrField[] {
  const decoded = decodeScVal(value);
  return [
    { label: "ScVal type", value: value.switch().name },
    {
      label: "Value",
      value:
        decoded === undefined
          ? "(unrepresentable value)"
          : JSON.stringify(decoded, null, 2),
    },
  ];
}

function summarize(type: XdrTypeName, base64: string): XdrField[] {
  switch (type) {
    case "TransactionEnvelope":
      return transactionEnvelopeFields(
        xdr.TransactionEnvelope.fromXDR(base64, "base64")
      );
    case "TransactionResult":
      return transactionResultFields(
        xdr.TransactionResult.fromXDR(base64, "base64")
      );
    case "TransactionMeta":
      return transactionMetaFields(
        xdr.TransactionMeta.fromXDR(base64, "base64")
      );
    case "LedgerEntry":
      return ledgerEntryFields(xdr.LedgerEntry.fromXDR(base64, "base64"));
    case "LedgerKey":
      return ledgerKeyFields(xdr.LedgerKey.fromXDR(base64, "base64"));
    case "ScSpecEntry":
      return specEntryFields(xdr.ScSpecEntry.fromXDR(base64, "base64"));
    case "ScVal":
      return scValFields(xdr.ScVal.fromXDR(base64, "base64"));
  }
}

/**
 * Decode an arbitrary base64 XDR blob into a labelled, human-readable summary.
 * Returns null when the input isn't valid XDR of any type Prism understands.
 *
 * This is deliberately a summary of the fields that matter when debugging a
 * Soroban transaction, not an exhaustive dump of every XDR field.
 */
export function decodeAnyXdr(input: string): XdrDecodeResult | null {
  const type = identifyXdr(input);
  if (!type) return null;

  const base64 = normalizeBase64(input);
  try {
    return { type, fields: summarize(type, base64), partial: false };
  } catch {
    // The type round-tripped but a field accessor didn't behave as expected.
    // Report the type we're confident about, flagged so the page can say so.
    return { type, fields: [], partial: true };
  }
}
