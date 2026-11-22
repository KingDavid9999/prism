# Prism Indexer

An optional indexer that polls Soroban RPC and persists contract deployments, invocations (including successful return values), storage changes, and events into PostgreSQL. It removes the RPC node's ~24-hour retention limit and enables full storage-key enumeration — neither of which is possible with plain RPC access.

## Quick Start

```bash
cd indexer
npm install

# Set the database connection string
export DATABASE_URL="postgresql://user:password@localhost:5432/prism"
export SOROBAN_RPC_URL="https://soroban-testnet.stellar.org"

# Generate the Prisma client and run migrations
npm run prisma:generate
npm run prisma:migrate

# Start the indexer (watch mode)
npm run dev
```

To index a historical ledger range, run:

```bash
npm run backfill -- --from 1000 --to 2000
```

The backfill uses the same transaction processor as live indexing. Its progress is checkpointed in PostgreSQL after each RPC page, so rerunning the same range resumes safely after an interruption. Inserts are idempotent; a different range cannot replace an incomplete backfill. After a range is complete, a new range may be started. The requested end ledger must be available from the configured RPC node.

Or run everything together with Docker Compose from the repository root:

```bash
docker compose up
```

## Configuration

| Environment Variable                | Default              | Description                                                                                                                             |
| ----------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                      | _(required)_         | PostgreSQL connection string                                                                                                            |
| `SOROBAN_RPC_URL`                   | _(required)_         | Soroban RPC endpoint to poll; no fallback                                                                                               |
| `STORAGE_HISTORY_RETENTION_LEDGERS` | _(unset — disabled)_ | Optional history pruning window; deletes at most 1,000 old rows per poll while preserving the latest record per contract/key/durability |
| `POLL_INTERVAL_MS`                  | `5000`               | Milliseconds between poll cycles                                                                                                        |
| `HEALTH_PORT`                       | `8080`               | Port for the `GET /healthz` endpoint                                                                                                    |
| `HEALTH_MAX_LEDGER_LAG`             | `60`                 | Ledgers behind the network before `/healthz` returns 503                                                                                |
| `INDEXER_START_LEDGER`              | _(latest ledger)_    | First ledger to index on a fresh database; must be inside the RPC node's retention window. Ignored once a cursor exists                 |

## How It Works

1. On first run, the live indexer seeds a cursor (`IndexerCursor`) at the current latest ledger, or just before `INDEXER_START_LEDGER` if set. Live indexing does not backfill automatically; use the `backfill` command below to import an available historical range.
2. Each poll cycle fetches new transactions from the RPC node, processes them in pages of 50, and advances the cursor.
3. Both live indexing and backfill use RPC transaction cursors to safely paginate across pages, including pages that split a ledger.
4. Processing is idempotent — `skipDuplicates` on insert means a crash-before-cursor-advance is safe to replay.

### Cursor Model

The live cursor is a single row (`id = 1`) tracking the last processed ledger and RPC page position. Live indexing remains forward-only; use the backfill command to load historical ranges. Backfill progress is tracked independently in `BackfillCursor`, allowing it to coexist with the live cursor.

## Tables

Prisma creates quoted PascalCase table and column names. In `psql`, preserve that casing by quoting identifiers, for example `SELECT * FROM "IndexerCursor";`. The tables and columns below match `prisma/schema.prisma`.

### `"IndexerCursor"`

Singleton row (`id` defaults to 1) tracking live indexing progress.

| Column             | Type       | Description                                           |
| ------------------ | ---------- | ----------------------------------------------------- |
| `id`               | `Int`      | Singleton primary key (default 1)                     |
| `lastLedger`       | `Int`      | Last processed ledger                                 |
| `paginationCursor` | `String?`  | RPC page position when a ledger has more transactions |
| `updatedAt`        | `DateTime` | Last cursor advance time                              |

### `"IndexerGap"`

One row per ledger range skipped by live indexing because it fell outside the RPC node's retention window.

| Column       | Type       | Description               |
| ------------ | ---------- | ------------------------- |
| `id`         | `String`   | Primary key (cuid)        |
| `fromLedger` | `Int`      | First skipped ledger      |
| `toLedger`   | `Int`      | Last skipped ledger       |
| `reason`     | `String`   | Why the range was skipped |
| `createdAt`  | `DateTime` | When the gap was recorded |

### `"BackfillCursor"`

Singleton row (`id` defaults to 1) tracking the active or most recently completed fixed-range backfill.

| Column             | Type       | Description                                             |
| ------------------ | ---------- | ------------------------------------------------------- |
| `id`               | `Int`      | Singleton primary key (default 1)                       |
| `fromLedger`       | `Int`      | Requested range start                                   |
| `toLedger`         | `Int`      | Requested range end                                     |
| `lastLedger`       | `Int`      | Last processed ledger                                   |
| `paginationCursor` | `String?`  | RPC page position for resuming                          |
| `completed`        | `Boolean`  | Whether the requested range is complete (default false) |
| `updatedAt`        | `DateTime` | Last progress update                                    |

### `"Invocation"`

One row per observed Soroban contract function invocation.

| Column          | Type       | Description                                      |
| --------------- | ---------- | ------------------------------------------------ |
| `id`            | `String`   | Primary key (cuid)                               |
| `txHash`        | `String`   | Transaction hash (unique)                        |
| `ledger`        | `Int`      | Ledger sequence number                           |
| `createdAt`     | `DateTime` | When the invocation was indexed                  |
| `contractId`    | `String`   | Contract address                                 |
| `functionName`  | `String`   | Invoked function name                            |
| `args`          | `Json`     | Decoded arguments                                |
| `successful`    | `Boolean`  | Whether the invocation succeeded                 |
| `sourceAccount` | `String`   | Transaction source account                       |
| `returnValue`   | `String?`  | Decoded return value for a successful invocation |

### `"Contract"`

One row per observed contract deployment.

| Column             | Type       | Description                                     |
| ------------------ | ---------- | ----------------------------------------------- |
| `contractId`       | `String`   | Deployed contract address (primary key)         |
| `creator`          | `String`   | Transaction source account                      |
| `deploymentLedger` | `Int`      | Ledger sequence of the deployment               |
| `deploymentTxHash` | `String`   | Transaction that deployed the contract (unique) |
| `createdAt`        | `DateTime` | When the deployment was indexed                 |

### `"StorageChange"`

Append-only log of every observed change to a contract storage entry. The "current value" for a key is its most recent non-removed row — this is what makes full key enumeration possible.

| Column         | Type       | Description                                            |
| -------------- | ---------- | ------------------------------------------------------ |
| `id`           | `String`   | Primary key (cuid)                                     |
| `contractId`   | `String`   | Contract address                                       |
| `durability`   | `String`   | `persistent` / `temporary` / `instance`                |
| `keyDisplay`   | `String`   | Human-readable decoded key                             |
| `keyXdr`       | `String`   | Canonical base64 XDR identity of the storage key       |
| `valueDisplay` | `String?`  | Decoded value (null when removed)                      |
| `keyHash`      | `String?`  | SHA-256 of the XDR LedgerKey, used to join TTL records |
| `changeType`   | `String`   | `created` / `updated` / `removed` / `state`            |
| `ledger`       | `Int`      | Ledger sequence number                                 |
| `txHash`       | `String`   | Transaction hash                                       |
| `createdAt`    | `DateTime` | When the change was indexed                            |

### `"TtlChange"`

One row per observed TTL update.

| Column            | Type     | Description                       |
| ----------------- | -------- | --------------------------------- |
| `id`              | `String` | Primary key (cuid)                |
| `keyHash`         | `String` | SHA-256 hash of the XDR LedgerKey |
| `liveUntilLedger` | `Int?`   | Last live ledger, if available    |
| `ledger`          | `Int`    | Ledger sequence number            |
| `txHash`          | `String` | Transaction hash                  |

### `"ContractEventRecord"`

One row per observed contract event.

| Column       | Type       | Description                |
| ------------ | ---------- | -------------------------- |
| `id`         | `String`   | Primary key (cuid)         |
| `eventId`    | `String`   | Unique event identifier    |
| `contractId` | `String`   | Contract address           |
| `type`       | `String`   | Event type                 |
| `topic`      | `Json`     | Event topics               |
| `value`      | `String`   | Decoded event value        |
| `txHash`     | `String`   | Transaction hash           |
| `ledger`     | `Int`      | Ledger sequence number     |
| `createdAt`  | `DateTime` | When the event was indexed |

### `indexer_gaps`

One row per ledger range the live indexer skipped without indexing, because the RPC node's retention window had already passed the cursor. Gaps apply to every contract. The frontend returns them as `historyGaps` from `GET /api/contract/{id}`.

| Column       | Type     | Description               |
| ------------ | -------- | ------------------------- |
| `fromLedger` | `Int`    | First ledger skipped      |
| `toLedger`   | `Int`    | Last ledger skipped       |
| `reason`     | `String` | Why the range was skipped |

## Failure Behaviour

- **Crash before cursor advance**: Safe. The next run reprocesses the same page; `skipDuplicates` prevents double-inserts.
- **RPC unreachable**: The indexer retries with exponential backoff and jitter (1s doubling to a 60s cap) and resets once a poll succeeds. No data is lost — the cursor only advances after successful processing.
- **Database unreachable**: The indexer throws and exits. Restart after the database is available; the cursor is preserved.
- **SIGTERM / SIGINT**: The indexer finishes the page it is processing, saves the cursor, disconnects Prisma, and exits. A second signal exits immediately.

## Health Endpoint

`GET /healthz` on `HEALTH_PORT` returns the indexer's state as JSON:

```json
{
  "healthy": true,
  "cursor": 1234,
  "latestLedger": 1236,
  "lag": 2,
  "lastPollFailed": false
}
```

It returns `200` when the last poll succeeded and `lag` (`latestLedger - cursor`) is at most `HEALTH_MAX_LEDGER_LAG`. Otherwise it returns `503`. The Compose file uses this endpoint for the indexer's healthcheck.

## Retention Gap

Live indexing starts at the ledger current on first launch. Historical data can be loaded separately with the backfill command, subject to the configured RPC node's available history. Data outside the live start point and any completed backfill ranges remains unindexed.

## Running Tests

```bash
cd indexer
npm test
```

Tests cover the XDR decoder (`decode.test.ts`) — the most correctness-critical component, which turns raw transaction envelopes into typed invocation/storage/event records.

## Storage retention and TTL indexing

Set `STORAGE_HISTORY_RETENTION_LEDGERS` to a positive integer to bound historical
storage-change growth. After a completed polling page, the indexer deletes up
to 1,000 rows older than `currentLedger - retention` that have a newer row
for the same contract, durability and key. The newest observation for each key
is retained even when it falls outside the window. Leave the setting unset
to retain all history. Run the Prisma migration before starting the upgraded
indexer.

Contract-data ledger keys are hashed using SHA-256 of their canonical XDR
`LedgerKey`. TTL ledger-entry updates are indexed separately by this hash.
The full-storage endpoint includes `liveUntilLedger` where a matching TTL
change has been observed; `null` means unknown or removed. Historic entries
indexed before this migration have no key hash and cannot be retroactively
joined without reindexing.
