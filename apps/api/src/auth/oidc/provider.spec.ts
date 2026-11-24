/**
 * @packageDocumentation
 * Runs `OpenIdClientProvider` against an in-process OpenID provider (discovery, JWKS, token, userinfo) so the
 * state, nonce, PKCE, `iss` and ID-token signature checks are exercised for real, not mocked.
 */

import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OidcSettings } from "../../config/env.js";
import { OpenIdClientProvider } from "./provider.js";

const CLIENT_ID = "treemich";
const CLIENT_SECRET = "test-secret";
const REDIRECT_URI = "https://tree.example/api/auth/oidc/callback";

const b64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

const signJwt = (key: KeyObject, payload: Record<string, unknown>) => {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "k1" }));
  const body = b64url(JSON.stringify(payload));
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${body}`), key);
  return `${header}.${body}.${b64url(signature)}`;
};

type PendingCode = { challenge: string; nonce: string; redirectUri: string };

/** Minimal OpenID provider. `overrides` lets a test break one thing at a time. */
const fakeIdp = () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const codes = new Map<string, PendingCode>();
  const overrides: { idTokenNonce?: string; userInfo?: Record<string, unknown>; tokenStatus?: number } = {};
  let issuer = "";

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", issuer);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === "/.well-known/openid-configuration") {
      return json(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        userinfo_endpoint: `${issuer}/userinfo`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["client_secret_basic"],
        authorization_response_iss_parameter_supported: true
      });
    }
    if (url.pathname === "/jwks") {
      return json(200, {
        keys: [{ ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" }]
      });
    }
    if (url.pathname === "/userinfo") {
      if (req.headers.authorization !== "Bearer access-1") {
        return json(401, { error: "invalid_token" });
      }
      return json(
        200,
        overrides.userInfo ?? {
          sub: "user-sub-1",
          email: "Anth@Example.com",
          email_verified: true,
          name: "Anth"
        }
      );
    }
    if (url.pathname === "/token" && req.method === "POST") {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        const form = new URLSearchParams(raw);
        // RFC 6749 2.3.1: id and secret are form-urlencoded before base64.
        const basic = Buffer.from(
          (req.headers.authorization ?? "").replace(/^Basic /, ""),
          "base64"
        ).toString();
        const [id, secret] = basic.split(":").map((part) => decodeURIComponent(part.replace(/\+/g, " ")));
        if (id !== CLIENT_ID || secret !== CLIENT_SECRET) {
          return json(401, { error: "invalid_client" });
        }
        const pending = codes.get(form.get("code") ?? "");
        const verifier = form.get("code_verifier") ?? "";
        if (
          !pending ||
          form.get("redirect_uri") !== pending.redirectUri ||
          b64url(createHash("sha256").update(verifier).digest()) !== pending.challenge
        ) {
          return json(400, { error: "invalid_grant" });
        }
        if (overrides.tokenStatus) {
          return json(overrides.tokenStatus, { error: "server_error" });
        }
        const now = Math.floor(Date.now() / 1000);
        return json(200, {
          access_token: "access-1",
          token_type: "Bearer",
          expires_in: 300,
          id_token: signJwt(privateKey, {
            iss: issuer,
            sub: "user-sub-1",
            aud: CLIENT_ID,
            iat: now,
            exp: now + 300,
            nonce: overrides.idTokenNonce ?? pending.nonce
          })
        });
      });
      return;
    }
    json(404, { error: "not_found" });
  });

  return {
    server,
    codes,
    overrides,
    start: async () => {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      return issuer;
    },
    stop: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
};

describe("OpenIdClientProvider", () => {
  const idp = fakeIdp();
  let issuer = "";
  let provider: OpenIdClientProvider;
  const checks = { state: "state-abc", nonce: "nonce-abc", codeVerifier: "v".repeat(43) };

  /** Simulates the user signing in at the provider: returns the URL the browser is sent back to. */
  const signInAtProvider = async (overrideState?: string) => {
    const authorize = await provider.authorizationUrl(checks);
    const code = `code-${Math.random().toString(36).slice(2)}`;
    idp.codes.set(code, {
      challenge: authorize.searchParams.get("code_challenge") ?? "",
      nonce: authorize.searchParams.get("nonce") ?? "",
      redirectUri: authorize.searchParams.get("redirect_uri") ?? ""
    });
    const callback = new URL(REDIRECT_URI);
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", overrideState ?? authorize.searchParams.get("state") ?? "");
    callback.searchParams.set("iss", issuer);
    return callback;
  };

  beforeAll(async () => {
    issuer = await idp.start();
  });

  afterAll(async () => {
    await idp.stop();
  });

  beforeEach(() => {
    idp.overrides.idTokenNonce = undefined;
    idp.overrides.userInfo = undefined;
    idp.overrides.tokenStatus = undefined;
    const settings: OidcSettings = {
      issuer: new URL(issuer),
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      tokenAuthMethod: "client_secret_basic",
      redirectUri: new URL(REDIRECT_URI),
      postLoginUrl: new URL("https://tree.example/"),
      scopes: "openid profile email",
      buttonLabel: "SSO",
      autoRegister: false,
      oidcOnly: false
    };
    provider = new OpenIdClientProvider(settings);
  });

  it("builds an authorization URL with PKCE S256, state, nonce and the registered redirect URI", async () => {
    const url = await provider.authorizationUrl(checks);
    expect(url.origin + url.pathname).toBe(`${issuer}/authorize`);
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("scope")).toBe("openid profile email");
    expect(url.searchParams.get("state")).toBe(checks.state);
    expect(url.searchParams.get("nonce")).toBe(checks.nonce);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(
      b64url(createHash("sha256").update(checks.codeVerifier).digest())
    );
  });

  it("completes a login and merges userinfo claims", async () => {
    const profile = await provider.completeLogin(await signInAtProvider(), checks);
    expect(profile).toEqual({
      issuer,
      subject: "user-sub-1",
      email: "Anth@Example.com",
      emailVerified: true,
      name: "Anth"
    });
  });

  it("falls back to preferred_username and reports a missing email_verified as null", async () => {
    idp.overrides.userInfo = { sub: "user-sub-1", email: "a@example.com", preferred_username: "anth" };
    const profile = await provider.completeLogin(await signInAtProvider(), checks);
    expect(profile.name).toBe("anth");
    expect(profile.emailVerified).toBeNull();
  });

  it("rejects a callback whose state does not match", async () => {
    await expect(
      provider.completeLogin(await signInAtProvider("someone-elses-state"), checks)
    ).rejects.toThrow();
  });

  it("rejects an ID token with the wrong nonce", async () => {
    idp.overrides.idTokenNonce = "replayed-nonce";
    await expect(provider.completeLogin(await signInAtProvider(), checks)).rejects.toThrow();
  });

  it("rejects a callback when the PKCE verifier does not match", async () => {
    const callback = await signInAtProvider();
    await expect(
      provider.completeLogin(callback, { ...checks, codeVerifier: "w".repeat(43) })
    ).rejects.toThrow();
  });

  it("rejects userinfo for a different subject", async () => {
    idp.overrides.userInfo = { sub: "someone-else", email: "x@example.com", email_verified: true };
    await expect(provider.completeLogin(await signInAtProvider(), checks)).rejects.toThrow();
  });

  it("surfaces token endpoint errors", async () => {
    idp.overrides.tokenStatus = 500;
    await expect(provider.completeLogin(await signInAtProvider(), checks)).rejects.toThrow();
  });

  it("retries discovery after a failure instead of caching it", async () => {
    const broken = new OpenIdClientProvider({
      issuer: new URL("http://127.0.0.1:1"),
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      tokenAuthMethod: "client_secret_basic",
      redirectUri: new URL(REDIRECT_URI),
      postLoginUrl: new URL("https://tree.example/"),
      scopes: "openid",
      buttonLabel: "SSO",
      autoRegister: false,
      oidcOnly: false
    });
    await expect(broken.authorizationUrl(checks)).rejects.toThrow();
    await expect(broken.authorizationUrl(checks)).rejects.toThrow();
  });
});
