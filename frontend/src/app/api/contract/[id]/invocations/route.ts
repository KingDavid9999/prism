import { NextResponse } from "next/server";
import { getInvocationHistoryPage } from "@/lib/soroban";
import { parsePageRequest } from "@/lib/history-cursor";
import { INVOCATION_PAGE_SIZE } from "@/lib/contract-lists";
import { rateLimitRequest } from "@/lib/rate-limit";
import { isContractId } from "@/lib/strkey-validation";

export const dynamic = "force-dynamic";

interface Params {
  params: { id: string };
}

export async function GET(req: Request, { params }: Params) {
  const limited = await rateLimitRequest(req, { scope: "contract-invocations" });
  if (limited) return limited;
  if (!isContractId(params.id))
    return NextResponse.json({ error: "Invalid contract ID" }, { status: 400 });

  const request = parsePageRequest(new URL(req.url), INVOCATION_PAGE_SIZE);
  if (!request)
    return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });

  const { items, nextCursor, error } = await getInvocationHistoryPage(
    params.id,
    request
  );
  if (error) {
    return NextResponse.json(
      { invocations: [], nextCursor: null, error },
      { status: 502 }
    );
  }
  return NextResponse.json({ invocations: items, nextCursor, error: null });
}
