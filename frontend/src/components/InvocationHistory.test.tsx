import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import InvocationHistory from "./InvocationHistory";

describe("InvocationHistory", () => {
  it("shows the RPC error instead of the empty-history message", () => {
    const html = renderToStaticMarkup(
      createElement(InvocationHistory, {
        items: [],
        derivedFromEvents: true,
        error: "connect ECONNREFUSED 127.0.0.1:8000",
      })
    );

    expect(html).toContain("from the RPC node");
    expect(html).toContain("connect ECONNREFUSED 127.0.0.1:8000");
    expect(html).not.toContain("No recent invocations found");
  });
});
