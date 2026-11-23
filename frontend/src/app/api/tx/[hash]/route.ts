import { NextResponse } from "next/server";
import { xdr } from "@stellar/stellar-sdk";
import { getTransaction } from "@/lib/horizon";
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

  let tx;
  try {
    tx = await getTransaction(params.hash);
  } catch {
    return NextResponse.json(
      { error: "Transaction not found" },
      { status: 404 }
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
