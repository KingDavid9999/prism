import { NextResponse } from "next/server";
import { getContractInfo } from "@/lib/soroban";
import { getIndexedGaps } from "@/lib/indexed-db";
import { rateLimitRequest } from "@/lib/rate-limit";
import { isContractId } from "@/lib/strkey-validation";

export const dynamic = "force-dynamic";

interface Params {
  params: { id: string };
}

export async function GET(req: Request, { params }: Params) {
  const limited = await rateLimitRequest(req, { scope: "contract-info" });
  if (limited) return limited;
  if (!isContractId(params.id))
    return NextResponse.json({ error: "Invalid contract ID" }, { status: 400 });

  const [result, historyGaps] = await Promise.all([
    getContractInfo(params.id),
    getIndexedGaps(),
  ]);
  if (result.status === "missing") {
    return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  }
  if (result.status === "unavailable") {
    return NextResponse.json(
      { error: "Contract lookup unavailable" },
      { status: 502 }
    );
  }
  // Gaps are ledger ranges the indexer skipped for every contract; the UI can flag them.
  return NextResponse.json({ ...result.info, historyGaps });
}
