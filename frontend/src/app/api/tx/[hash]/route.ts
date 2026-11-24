import { NextResponse } from "next/server";
import { xdr } from "@stellar/stellar-sdk";
import {
  getTransaction,
  isNotFound,
  normalizeTransactionHash,
} from "@/lib/horizon";
import { getInvocationReturnValue } from "@/lib/soroban";
import { decodeInvocation, getResourceUsage } from "@/lib/xdr";
import { rateLimitRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

interface Params {
  params: { hash: string };
}

export async function GET(req: Request, { params }: Params) {
  const limited = await rateLimitRequest(req, { scope: "tx" });
  if (limited) return limited;

  const hash = normalizeTransactionHash(params.hash);
  if (!hash) {
    return NextResponse.json(
      { error: "Invalid transaction hash" },
      { status: 400 }
    );
  }

  let tx;
  try {
    tx = await getTransaction(hash);
  } catch (err) {
    if (isNotFound(err)) {
      return NextResponse.json(
        { error: "Transaction not found" },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { error: "Transaction lookup unavailable" },
      { status: 502 }
    );
  }

  let invocation: ReturnType<typeof decodeInvocation> = null;
  let resources: ReturnType<typeof getResourceUsage> = null;
  try {
    const envelope = xdr.TransactionEnvelope.fromXDR(tx.envelopeXdr, "base64");
    invocation = decodeInvocation(envelope);
    resources = getResourceUsage(envelope, tx.fee);
  } catch {
    // Envelope uses a newer XDR type this SDK version cannot decode.
    // Return the Horizon fields with envelope-derived fields set to null (#26).
  }
  const returnValue = invocation
    ? await getInvocationReturnValue(tx.hash)
    : null;

  return NextResponse.json({ ...tx, invocation, resources, returnValue });
}
