-- Add opIndex to Invocation
ALTER TABLE "Invocation" ADD COLUMN "opIndex" INTEGER NOT NULL DEFAULT 0;

-- Drop old unique constraint and add new one
ALTER TABLE "Invocation" DROP CONSTRAINT "Invocation_txHash_key";
ALTER TABLE "Invocation" ADD CONSTRAINT "Invocation_txHash_opIndex_key" UNIQUE("txHash", "opIndex");

-- Add opIndex to StorageChange
ALTER TABLE "StorageChange" ADD COLUMN "opIndex" INTEGER NOT NULL DEFAULT 0;

-- Drop old unique constraint and add new one
ALTER TABLE "StorageChange" DROP CONSTRAINT "StorageChange_txHash_contractId_keyXdr_durability_changeType_key";
ALTER TABLE "StorageChange" ADD CONSTRAINT "StorageChange_txHash_contractId_keyXdr_durability_changeType_opIndex_key" UNIQUE("txHash", "contractId", "keyXdr", "durability", "changeType", "opIndex");
