import { NextResponse } from "next/server";
export const dynamic = "force-static";
const document = {
  openapi: "3.0.3",
  info: {
    title: "Prism API",
    version: "1.0.0",
    description: "Read-only Soroban explorer API.",
  },
  paths: {
    "/api/contract/{id}": {
      get: {
        responses: {
          "200": { description: "Contract details" },
          "404": { description: "Not found" },
          "502": { description: "RPC unavailable" },
        },
      },
    },
    "/api/contract/{id}/wasm": {
      get: {
        responses: {
          "200": { description: "Parsed WASM ABI" },
          "400": { description: "Not a WASM contract" },
          "404": { description: "Not found" },
          "502": { description: "WASM unavailable" },
        },
      },
    },
    "/api/contract/{id}/events": {
      get: {
        responses: {
          "200": { description: "Paged events" },
          "400": { description: "Invalid cursor" },
          "502": { description: "RPC unavailable" },
        },
      },
    },
    "/api/contract/{id}/storage": {
      get: {
        responses: {
          "200": { description: "Storage entry" },
          "400": { description: "Invalid key" },
          "404": { description: "Not found" },
        },
      },
    },
    "/api/contract/{id}/storage/full": {
      get: {
        responses: {
          "200": { description: "Indexed storage" },
          "501": { description: "Indexer required" },
        },
      },
    },
    "/api/contract/{id}/simulate": {
      post: {
        responses: {
          "200": { description: "Simulation result" },
          "400": { description: "Invalid request" },
          "502": { description: "Simulation failed" },
        },
      },
    },
  },
} as const;
export function GET() {
  return NextResponse.json(document);
}
