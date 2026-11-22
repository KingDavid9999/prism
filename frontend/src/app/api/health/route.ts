import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { isIndexerConfigured, checkDatabaseHealth } from "@/lib/indexed-db";
import { rpc } from "@stellar/stellar-sdk";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const deep = url.searchParams.get("deep") === "1";

  if (!deep) {
    return NextResponse.json({ status: "ok" });
  }

  const dependencies: Record<string, string> = {};
  const failed: string[] = [];

  // Check Horizon
  try {
    const res = await fetch(`${config.horizonUrl}/`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) {
      dependencies.horizon = "ok";
    } else {
      dependencies.horizon = `error: status ${res.status}`;
      failed.push("horizon");
    }
  } catch (err) {
    dependencies.horizon = `error: ${err instanceof Error ? err.message : String(err)}`;
    failed.push("horizon");
  }

  // Check Soroban RPC
  try {
    const server = new rpc.Server(config.sorobanRpcUrl, { timeout: 5_000 });
    const health = await server.getHealth();
    if (health.status === "healthy") {
      dependencies.rpc = "ok";
    } else {
      dependencies.rpc = `error: status ${health.status}`;
      failed.push("rpc");
    }
  } catch (err) {
    dependencies.rpc = `error: ${err instanceof Error ? err.message : String(err)}`;
    failed.push("rpc");
  }

  // Check Indexed Database (if configured)
  if (isIndexerConfigured()) {
    try {
      const dbOk = await checkDatabaseHealth();
      if (dbOk) {
        dependencies.database = "ok";
      } else {
        dependencies.database = "error: connection failed";
        failed.push("database");
      }
    } catch (err) {
      dependencies.database = `error: ${err instanceof Error ? err.message : String(err)}`;
      failed.push("database");
    }
  } else {
    dependencies.database = "skipped";
  }

  if (failed.length > 0) {
    return NextResponse.json(
      {
        status: "error",
        failed,
        dependencies,
      },
      { status: 503 }
    );
  }

  return NextResponse.json({
    status: "ok",
    dependencies,
  });
}
