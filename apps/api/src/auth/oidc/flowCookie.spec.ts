/**
 * @packageDocumentation
 * Unit tests for the encrypted OIDC flow cookie.
 */

import { describe, expect, it } from "vitest";
import { decodeFlowCookie, encodeFlowCookie, OIDC_FLOW_TTL_MS } from "./flowCookie.js";

const checks = { state: "state-1", nonce: "nonce-1", codeVerifier: "verifier-1" };
// readCookie() hands the decoded value to decodeFlowCookie, so tests decode too.
const encode = (now = Date.now()) => decodeURIComponent(encodeFlowCookie(checks, now));

describe("OIDC flow cookie", () => {
  it("round-trips state, nonce and PKCE verifier", () => {
    expect(decodeFlowCookie(encode())).toEqual(checks);
  });

  it("does not expose the values in clear text", () => {
    const raw = encode();
    expect(raw).not.toContain("state-1");
    expect(raw).not.toContain("verifier-1");
  });

  it("rejects a missing, malformed or wrong-version cookie", () => {
    expect(decodeFlowCookie(null)).toBeNull();
    expect(decodeFlowCookie("")).toBeNull();
    expect(decodeFlowCookie("garbage")).toBeNull();
    expect(decodeFlowCookie(encode().replace(/^v1\./, "v2."))).toBeNull();
  });

  it("rejects a tampered cookie", () => {
    const [version, iv, tag, value] = encode().split(".");
    const flipped = value!.startsWith("A") ? `B${value!.slice(1)}` : `A${value!.slice(1)}`;
    expect(decodeFlowCookie([version, iv, tag, flipped].join("."))).toBeNull();
  });

  it("rejects an expired cookie and one dated in the future", () => {
    const now = Date.now();
    expect(decodeFlowCookie(encode(now - OIDC_FLOW_TTL_MS - 1), now)).toBeNull();
    expect(decodeFlowCookie(encode(now + 60_000), now)).toBeNull();
    expect(decodeFlowCookie(encode(now - OIDC_FLOW_TTL_MS + 1_000), now)).toEqual(checks);
  });
});
