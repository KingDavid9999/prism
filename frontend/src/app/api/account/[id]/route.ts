import { NextResponse } from "next/server";
import { getAccount, isNotFound } from "@/lib/horizon";
import { rateLimitRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

interface Params {
  params: { id: string };
}

// A Stellar account address: "G" followed by 55 base32 characters (56 total).
const ACCOUNT_ID = /^G[A-Z2-7]{55}$/;

export async function GET(req: Request, { params }: Params) {
  const limited = await rateLimitRequest(req, { scope: "account" });
  if (limited) return limited;

  if (!ACCOUNT_ID.test(params.id)) {
    return NextResponse.json({ error: "Invalid account ID" }, { status: 400 });
  }

  try {
    const account = await getAccount(params.id);
    return NextResponse.json(account);
  } catch (err) {
    if (isNotFound(err)) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "Horizon request failed" },
      { status: 502 }
    );
  }
}
