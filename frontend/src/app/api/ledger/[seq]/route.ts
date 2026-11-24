import { NextResponse } from "next/server";
import { getLedger, isNotFound } from "@/lib/horizon";
import { rateLimitRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

interface Params {
  params: { seq: string };
}

export async function GET(req: Request, { params }: Params) {
  const limited = await rateLimitRequest(req, { scope: "ledger" });
  if (limited) return limited;

  if (!/^\d+$/.test(params.seq)) {
    return NextResponse.json(
      { error: "Invalid ledger sequence" },
      { status: 400 }
    );
  }
  const seq = parseInt(params.seq, 10);
  if (seq > 4_294_967_295) {
    return NextResponse.json(
      { error: "Invalid ledger sequence" },
      { status: 400 }
    );
  }

  try {
    const ledger = await getLedger(seq);
    return NextResponse.json(ledger);
  } catch (err) {
    if (isNotFound(err)) {
      return NextResponse.json({ error: "Ledger not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "Ledger lookup unavailable" },
      { status: 502 }
    );
  }
}
