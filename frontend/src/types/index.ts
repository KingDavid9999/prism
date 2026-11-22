export interface LedgerRecord {
  sequence: number;
  hash: string;
  closedAt: string;
  transactionCount: number;
  operationCount: number;
  baseFee: number;
  successfulTransactionCount: number;
  failedTransactionCount: number;
  protocolVersion: number;
  maxTxSetSize: number;
  txSetOperationCount: number;
}

export interface TransactionRecord {
  hash: string;
  ledger: number;
  createdAt: string;
  sourceAccount: string;
  fee: number;
  operationCount: number;
  successful: boolean;
  memo?: string;
  /** Horizon's memo_type: text, id, hash, return or none. */
  memoType?: string;
  /** On a fee bump transaction, the account that paid the outer (bump) fee. */
  feeAccount?: string;
  /** On a fee bump transaction, the outer envelope and its hash. */
  feeBumpTransaction?: { hash: string };
  /** On a fee bump transaction, the wrapped transaction and its own fee. */
  innerTransaction?: {
    hash: string;
    sourceAccount?: string;
    feeCharged?: number;
  };
  envelopeXdr: string;
  resultXdr: string;
  pagingToken?: string;
}

/** One labelled field of a decoded operation. */
export interface OperationField {
  label: string;
  value: string;
  mono?: boolean;
}

/**
 * A Horizon operation reduced to the fields worth showing. Types Prism knows
 * get their key fields pulled out; everything else is dumped generically and
 * flagged with `raw`.
 */
export interface OperationRecord {
  id: string;
  type: string;
  sourceAccount?: string;
  fields: OperationField[];
  raw: boolean;
}

export interface AccountBalance {
  assetType: string;
  assetCode?: string;
  assetIssuer?: string;
  /** Set only for liquidity pool shares, which have no asset code. */
  liquidityPoolId?: string;
  balance: string;
  limit?: string;
  isAuthorized?: boolean;
  liabilities?: {
    buying?: string;
    selling?: string;
  };
}

export interface Signer {
  key: string;
  weight: number;
}

export interface AccountRecord {
  id: string;
  sequence: string;
  subentryCount: number;
  lastModifiedLedger: number;
  thresholds: { low: number; med: number; high: number };
  flags: {
    authRequired: boolean;
    authRevocable: boolean;
    authImmutable: boolean;
    authClawbackEnabled: boolean;
  };
  balances: AccountBalance[];
  signerCount: number;
  signers?: Signer[];
  homeDomain?: string;
  sponsor?: string;
  numSponsoring?: number;
  numSponsored?: number;
}

export interface ContractEvent {
  id: string;
  contractId: string;
  type: string;
  topic: string[];
  value: string;
  /** ScVal type of each topic and of the value, when the source kept them. */
  topicTypes?: string[];
  valueType?: string;
  txHash: string;
  ledger: number;
  timestamp: string;
}

/** Derived by comparing an entry's TTL with the latest ledger. */
export type StorageEntryState = "live" | "expired" | "archived";

export interface StorageEntry {
  key: string;
  value: string;
  durability: "persistent" | "temporary" | "instance";
  /** ScVal type of the value, when the source kept it. */
  valueType?: string;
  /** Ledger at which this entry's TTL expires, when known. */
  liveUntilLedgerSeq?: number;
  state?: StorageEntryState;
}

export interface ContractInfo {
  executable: "wasm" | "stellar_asset";
  wasmHash?: string;
  liveUntilLedgerSeq?: number;
  lastModifiedLedgerSeq?: number;
  instanceStorage: StorageEntry[];
  assetDetails?: {
    name?: string;
    symbol?: string;
    decimals?: number;
  };
  creator?: string;
  deploymentLedger?: number;
}

export interface ContractFunctionSpec {
  name: string;
  inputs: { name: string; type: string }[];
  outputs: string[];
  doc?: string;
}

export interface ContractEventSpec {
  name: string;
  prefixTopics: string[];
  params: { name: string; type: string; location: "topic" | "data" }[];
  dataFormat: "map" | "vec" | "single-value";
  doc?: string;
}

export type ContractTypeDef =
  | {
      kind: "struct";
      name: string;
      doc?: string;
      fields: { name: string; type: string }[];
    }
  | {
      kind: "union";
      name: string;
      doc?: string;
      cases: { name: string; types: string[] }[];
    }
  | {
      kind: "enum";
      name: string;
      doc?: string;
      cases: { name: string; value: number }[];
    }
  | {
      kind: "error";
      name: string;
      doc?: string;
      cases: { name: string; value: number }[];
    };

export interface ContractWasmInfo {
  size: number;
  functions: ContractFunctionSpec[];
  events: ContractEventSpec[];
  types: ContractTypeDef[];
}

export interface SorobanInvocation {
  contractId: string;
  functionName: string;
  args: string[];
}

/** A contract call taken from one operation of a transaction. */
export interface OperationInvocation extends SorobanInvocation {
  operationIndex: number;
}

/** Who signed an authorization entry: the transaction's source account, or a Soroban address. */
export type AuthorizationCredentials =
  | { kind: "sourceAccount" }
  | {
      kind: "address";
      address: string;
      nonce: string;
      expirationLedger: number;
    }
  | { kind: "other"; type: string };

/** A call in an authorization tree, with the contract-to-contract calls it made. */
export interface AuthorizedInvocationNode {
  label: string;
  subInvocations: AuthorizedInvocationNode[];
}

/** One SorobanAuthorizationEntry: who authorized which call tree. */
export interface AuthorizationEntry {
  credentials: AuthorizationCredentials;
  root: AuthorizedInvocationNode;
}

/** One InvokeHostFunction operation's authorization entries. */
export interface OperationAuthorizations {
  operationIndex: number;
  entries: AuthorizationEntry[];
}

/** One ledger entry touched by a Soroban transaction. */
export interface FootprintEntry {
  access: "read" | "write";
  /** e.g. `CABC… — counter` for storage, or `code a1b2…` for a WASM hash. */
  label: string;
}

export interface ResourceUsage {
  instructions: number;
  readBytes: number;
  writeBytes: number;
  resourceFeeStroops: string;
  footprint: FootprintEntry[];
  /** Set only when the caller supplies Horizon's total fee charged. */
  inclusionFeeStroops?: string;
}

/** Storage access and I/O figures reported by a read-only simulation. */
export interface SimulationFootprint {
  /** Human-readable descriptions of the read-only ledger keys. */
  readOnly: string[];
  /** Human-readable descriptions of the read-write ledger keys. */
  readWrite: string[];
  readBytes: number;
  writeBytes: number;
}

export interface InvocationHistoryItem {
  txHash: string;
  ledger: number;
  timestamp: string;
  functionName?: string;
  args?: string[];
  successful: boolean;
}

export type Network = "testnet" | "mainnet";
