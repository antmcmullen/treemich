/**
 * @packageDocumentation
 * Short-lived, encrypted cookie that carries the OIDC state, nonce and PKCE verifier from
 * `/auth/oidc/login` to `/auth/oidc/callback`, so no server-side storage is needed.
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import { isCookieSecure } from "../../config/env.js";
import { decryptSecret, encryptSecret } from "../crypto.js";
import { readCookie } from "../request.js";
import type { OidcFlowChecks } from "./provider.js";

export const OIDC_FLOW_COOKIE_NAME = "treemich_oidc_flow";

/** How long a user has to finish signing in at the provider. */
export const OIDC_FLOW_TTL_MS = 10 * 60 * 1000;

type FlowPayload = OidcFlowChecks & { createdAt: number };

const cookie = (value: string, maxAgeSeconds: number) => {
  const parts = [
    `${OIDC_FLOW_COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    // Lax: the provider's redirect back to the callback is a top-level GET, so the cookie is sent.
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`
  ];
  if (isCookieSecure()) {
    parts.push("Secure");
  }
  return parts.join("; ");
};

export const encodeFlowCookie = (checks: OidcFlowChecks, now = Date.now()) => {
  const payload: FlowPayload = { ...checks, createdAt: now };
  const sealed = encryptSecret(JSON.stringify(payload));
  return encodeURIComponent(["v1", sealed.iv, sealed.authTag, sealed.encryptedValue].join("."));
};

/** Returns the checks when the cookie decrypts, is well formed and is younger than the TTL; otherwise `null`. */
export const decodeFlowCookie = (raw: string | null, now = Date.now()): OidcFlowChecks | null => {
  if (!raw) {
    return null;
  }
  const [version, iv, authTag, encryptedValue] = raw.split(".");
  if (version !== "v1" || !iv || !authTag || !encryptedValue) {
    return null;
  }
  try {
    const payload = JSON.parse(decryptSecret({ iv, authTag, encryptedValue })) as Partial<FlowPayload>;
    const { state, nonce, codeVerifier, createdAt } = payload;
    if (
      typeof state !== "string" ||
      typeof nonce !== "string" ||
      typeof codeVerifier !== "string" ||
      typeof createdAt !== "number" ||
      now - createdAt > OIDC_FLOW_TTL_MS ||
      createdAt > now
    ) {
      return null;
    }
    return { state, nonce, codeVerifier };
  } catch {
    return null;
  }
};

export const setFlowCookie = (reply: FastifyReply, checks: OidcFlowChecks) => {
  reply.header("Set-Cookie", cookie(encodeFlowCookie(checks), Math.floor(OIDC_FLOW_TTL_MS / 1000)));
};

export const readFlowCookie = (request: FastifyRequest) =>
  decodeFlowCookie(readCookie(request, OIDC_FLOW_COOKIE_NAME));

export const clearFlowCookie = (reply: FastifyReply) => {
  reply.header("Set-Cookie", cookie("", 0));
};
