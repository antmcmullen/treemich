/**
 * @packageDocumentation
 * Integration tests for SSO routes (`/auth/providers`, `/auth/oidc/login`, `/auth/oidc/callback`) and the SSO-only
 * switch on `POST /auth/login`. The OpenID provider is a fake; Prisma is mocked; `AuthService` is real.
 */

import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OidcSettings } from "../config/env.js";
import type { OidcFlowChecks, OidcProfile, OidcProvider } from "../auth/oidc/provider.js";
import type { AppServices } from "../services.js";

const mocks = vi.hoisted(() => ({
  getOidcSettings: vi.fn(),
  oidcIdentityFindUnique: vi.fn(),
  oidcIdentityUpdate: vi.fn(),
  oidcIdentityCreate: vi.fn(),
  treemichUserFindFirst: vi.fn(),
  treemichUserFindMany: vi.fn(),
  treemichUserCount: vi.fn(),
  treemichUserCreate: vi.fn(),
  treemichUserUpdate: vi.fn(),
  treemichSessionCreate: vi.fn()
}));

vi.mock("../db/client.js", () => ({
  prisma: {
    oidcIdentity: {
      findUnique: mocks.oidcIdentityFindUnique,
      update: mocks.oidcIdentityUpdate,
      create: mocks.oidcIdentityCreate
    },
    treemichUser: {
      findFirst: mocks.treemichUserFindFirst,
      findMany: mocks.treemichUserFindMany,
      count: mocks.treemichUserCount,
      create: mocks.treemichUserCreate,
      update: mocks.treemichUserUpdate
    },
    treemichSession: { create: mocks.treemichSessionCreate }
  }
}));

vi.mock("../config/env.js", () => ({
  env: {
    NODE_ENV: "test",
    TREEMICH_SESSION_COOKIE_NAME: "treemich_session",
    TREEMICH_SESSION_TTL_MS: 2_592_000_000,
    TREEMICH_ENCRYPTION_KEY: "a".repeat(64),
    TREEMICH_ADMIN_PASSWORD: "treemich-pass!"
  },
  isCookieSecure: () => false,
  getOidcSettings: mocks.getOidcSettings
}));

vi.mock("../integrations/immich/client.js", () => ({
  ImmichAuthenticationError: class ImmichAuthenticationError extends Error {
    readonly statusCode = 401;
  },
  loginToImmich: vi.fn()
}));

const ISSUER = "https://auth.example";

const settings = (overrides: Partial<OidcSettings> = {}): OidcSettings => ({
  issuer: new URL(ISSUER),
  clientId: "treemich",
  clientSecret: "secret",
  tokenAuthMethod: "client_secret_basic",
  redirectUri: new URL("https://tree.example/api/auth/oidc/callback"),
  postLoginUrl: new URL("https://tree.example/"),
  scopes: "openid profile email",
  buttonLabel: "McMullen login",
  autoRegister: false,
  oidcOnly: false,
  ...overrides
});

const profile = (overrides: Partial<OidcProfile> = {}): OidcProfile => ({
  issuer: ISSUER,
  subject: "sub-1",
  email: "Anth@Example.com",
  emailVerified: true,
  name: "Anth",
  ...overrides
});

const makeUser = (overrides: Record<string, unknown> = {}) => ({
  id: "user-1",
  email: "anth@example.com",
  name: "Anth",
  passwordHash: null,
  isAdmin: false,
  passwordChangeRequired: false,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  ...overrides
});

const fakeProvider = () => {
  const provider = {
    authorizationUrl: vi.fn<OidcProvider["authorizationUrl"]>(async (checks: OidcFlowChecks) => {
      const url = new URL(`${ISSUER}/authorize`);
      url.searchParams.set("state", checks.state);
      return url;
    }),
    completeLogin: vi.fn<OidcProvider["completeLogin"]>(async () => profile())
  };
  return provider satisfies OidcProvider;
};

const setCookies = (header: string | string[] | undefined) =>
  Array.isArray(header) ? header : header ? [header] : [];

const cookiePair = (cookies: string[], name: string) =>
  cookies.find((c) => c.startsWith(`${name}=`))?.split(";")[0];

const buildApp = async (provider: OidcProvider | null) => {
  const { AuthService } = await import("../auth/service.js");
  const app = Fastify({ trustProxy: false });
  app.decorateRequest("auth", null);
  app.decorate("services", {
    authService: new AuthService(),
    oidcProvider: provider
  } as unknown as AppServices);
  await app.register(rateLimit, { max: 300, timeWindow: 60_000 });
  const { registerAuthOidcRoutes } = await import("./auth.oidc.js");
  const { registerAuthLoginRoute } = await import("./auth.login.js");
  await app.register(registerAuthOidcRoutes);
  await app.register(registerAuthLoginRoute);
  return app;
};

/** Starts a login and returns the flow cookie the browser would send back. */
const startLogin = async (app: Awaited<ReturnType<typeof buildApp>>) => {
  const response = await app.inject({ method: "GET", url: "/auth/oidc/login" });
  const flow = cookiePair(setCookies(response.headers["set-cookie"]), "treemich_oidc_flow");
  const state = new URL(String(response.headers.location)).searchParams.get("state") ?? "";
  return { response, flow: flow ?? "", state };
};

describe("SSO routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOidcSettings.mockReturnValue(settings());
    mocks.treemichSessionCreate.mockResolvedValue({ id: "session-1" });
    mocks.oidcIdentityFindUnique.mockResolvedValue(null);
    mocks.oidcIdentityCreate.mockResolvedValue({ id: "identity-1" });
  });

  describe("GET /auth/providers", () => {
    it("reports password-only when SSO is not configured", async () => {
      mocks.getOidcSettings.mockReturnValue(null);
      const app = await buildApp(null);
      const response = await app.inject({ method: "GET", url: "/auth/providers" });
      expect(response.json()).toEqual({ passwordLogin: true, oidc: null });
      await app.close();
    });

    it("reports the SSO button label and SSO-only mode", async () => {
      mocks.getOidcSettings.mockReturnValue(settings({ oidcOnly: true }));
      const app = await buildApp(fakeProvider());
      const response = await app.inject({ method: "GET", url: "/auth/providers" });
      expect(response.json()).toEqual({ passwordLogin: false, oidc: { label: "McMullen login" } });
      await app.close();
    });
  });

  describe("GET /auth/oidc/login", () => {
    it("returns 404 when SSO is not configured", async () => {
      mocks.getOidcSettings.mockReturnValue(null);
      const app = await buildApp(null);
      const response = await app.inject({ method: "GET", url: "/auth/oidc/login" });
      expect(response.statusCode).toBe(404);
      await app.close();
    });

    it("redirects to the provider and sets an HttpOnly, Lax, 10-minute flow cookie", async () => {
      const provider = fakeProvider();
      const app = await buildApp(provider);
      const { response, flow } = await startLogin(app);

      expect(response.statusCode).toBe(302);
      expect(String(response.headers.location)).toMatch(/^https:\/\/auth\.example\/authorize\?state=/);
      const cookie = setCookies(response.headers["set-cookie"]).find((c) =>
        c.startsWith("treemich_oidc_flow=")
      );
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).toContain("Max-Age=600");
      expect(flow.length).toBeGreaterThan("treemich_oidc_flow=".length + 20);

      const checks = provider.authorizationUrl.mock.calls[0]![0];
      expect(new Set([checks.state, checks.nonce, checks.codeVerifier]).size).toBe(3);
      expect(checks.codeVerifier.length).toBeGreaterThanOrEqual(43);
      await app.close();
    });

    it("sends the browser back with sso_error=unavailable when discovery fails", async () => {
      const provider = fakeProvider();
      provider.authorizationUrl.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      const app = await buildApp(provider);
      const response = await app.inject({ method: "GET", url: "/auth/oidc/login" });
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("https://tree.example/?sso_error=unavailable");
      expect(cookiePair(setCookies(response.headers["set-cookie"]), "treemich_oidc_flow")).toBeUndefined();
      await app.close();
    });
  });

  describe("GET /auth/oidc/callback", () => {
    it("signs in a known identity, clears the flow cookie and lands on the web app", async () => {
      const provider = fakeProvider();
      mocks.oidcIdentityFindUnique.mockResolvedValue({ id: "identity-1", user: makeUser() });
      const app = await buildApp(provider);
      const { flow, state } = await startLogin(app);

      const response = await app.inject({
        method: "GET",
        url: `/auth/oidc/callback?code=abc&state=${state}&iss=${encodeURIComponent(ISSUER)}`,
        headers: { cookie: flow }
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("https://tree.example/");
      const cookies = setCookies(response.headers["set-cookie"]);
      expect(cookiePair(cookies, "treemich_session")).toMatch(/^treemich_session=.+/);
      expect(cookies.find((c) => c.startsWith("treemich_oidc_flow="))).toContain("Max-Age=0");

      // The provider sees the public callback URL with the query exactly as received, and the original checks.
      const [callbackUrl, checks] = provider.completeLogin.mock.calls[0]!;
      expect(callbackUrl.href).toBe(
        `https://tree.example/api/auth/oidc/callback?code=abc&state=${state}&iss=${encodeURIComponent(ISSUER)}`
      );
      expect(checks).toEqual(provider.authorizationUrl.mock.calls[0]![0]);
      expect(mocks.oidcIdentityUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "identity-1" } })
      );
      expect(mocks.treemichSessionCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: "user-1" }) })
      );
      await app.close();
    });

    it("links a first SSO login to the account with the same (lowercased) email", async () => {
      mocks.treemichUserFindFirst.mockResolvedValue(makeUser());
      const app = await buildApp(fakeProvider());
      const { flow, state } = await startLogin(app);

      const response = await app.inject({
        method: "GET",
        url: `/auth/oidc/callback?code=abc&state=${state}`,
        headers: { cookie: flow }
      });

      expect(response.headers.location).toBe("https://tree.example/");
      expect(mocks.treemichUserFindFirst).toHaveBeenCalledWith({ where: { email: "anth@example.com" } });
      expect(mocks.oidcIdentityCreate).toHaveBeenCalledWith({
        data: { userId: "user-1", issuer: ISSUER, subject: "sub-1", email: "Anth@Example.com" }
      });
      expect(mocks.treemichUserCreate).not.toHaveBeenCalled();
      await app.close();
    });

    it("sends sso_error=no_account when nothing matches and auto-register is off", async () => {
      mocks.treemichUserFindFirst.mockResolvedValue(null);
      const app = await buildApp(fakeProvider());
      const { flow, state } = await startLogin(app);

      const response = await app.inject({
        method: "GET",
        url: `/auth/oidc/callback?code=abc&state=${state}`,
        headers: { cookie: flow }
      });

      expect(response.headers.location).toBe("https://tree.example/?sso_error=no_account");
      expect(cookiePair(setCookies(response.headers["set-cookie"]), "treemich_session")).toBeUndefined();
      expect(mocks.treemichSessionCreate).not.toHaveBeenCalled();
      await app.close();
    });

    it("never links or registers by an email the provider marks unverified", async () => {
      mocks.getOidcSettings.mockReturnValue(settings({ autoRegister: true }));
      const provider = fakeProvider();
      provider.completeLogin.mockResolvedValueOnce(profile({ emailVerified: false }));
      const app = await buildApp(provider);
      const { flow, state } = await startLogin(app);

      const response = await app.inject({
        method: "GET",
        url: `/auth/oidc/callback?code=abc&state=${state}`,
        headers: { cookie: flow }
      });

      expect(response.headers.location).toBe("https://tree.example/?sso_error=no_account");
      expect(mocks.treemichUserFindFirst).not.toHaveBeenCalled();
      expect(mocks.treemichUserCreate).not.toHaveBeenCalled();
      await app.close();
    });

    it("creates an account when auto-register is on", async () => {
      mocks.getOidcSettings.mockReturnValue(settings({ autoRegister: true }));
      mocks.treemichUserFindFirst.mockResolvedValue(null);
      mocks.treemichUserCreate.mockResolvedValue(makeUser({ id: "user-new" }));
      const app = await buildApp(fakeProvider());
      const { flow, state } = await startLogin(app);

      const response = await app.inject({
        method: "GET",
        url: `/auth/oidc/callback?code=abc&state=${state}`,
        headers: { cookie: flow }
      });

      expect(response.headers.location).toBe("https://tree.example/");
      expect(mocks.treemichUserCreate).toHaveBeenCalledWith({
        data: { email: "anth@example.com", name: "Anth" }
      });
      expect(mocks.oidcIdentityCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: "user-new", subject: "sub-1" })
      });
      await app.close();
    });

    it("sends sso_error=conflict when the matching account is linked to another login at this issuer", async () => {
      mocks.treemichUserFindFirst.mockResolvedValue(makeUser());
      mocks.oidcIdentityFindUnique
        .mockResolvedValueOnce(null) // issuer + subject lookup
        .mockResolvedValueOnce({ id: "identity-other" }); // user + issuer lookup
      const app = await buildApp(fakeProvider());
      const { flow, state } = await startLogin(app);

      const response = await app.inject({
        method: "GET",
        url: `/auth/oidc/callback?code=abc&state=${state}`,
        headers: { cookie: flow }
      });

      expect(response.headers.location).toBe("https://tree.example/?sso_error=conflict");
      expect(mocks.oidcIdentityCreate).not.toHaveBeenCalled();
      await app.close();
    });

    it("sends sso_error=expired without a valid flow cookie and never calls the provider", async () => {
      const provider = fakeProvider();
      const app = await buildApp(provider);
      for (const cookie of [undefined, "treemich_oidc_flow=v1.forged.value.here"]) {
        const response = await app.inject({
          method: "GET",
          url: "/auth/oidc/callback?code=abc&state=xyz",
          headers: cookie ? { cookie } : {}
        });
        expect(response.headers.location).toBe("https://tree.example/?sso_error=expired");
      }
      expect(provider.completeLogin).not.toHaveBeenCalled();
      await app.close();
    });

    it("maps a provider error response to denied or failed", async () => {
      const provider = fakeProvider();
      const app = await buildApp(provider);
      const { flow } = await startLogin(app);
      const denied = await app.inject({
        method: "GET",
        url: "/auth/oidc/callback?error=access_denied&error_description=%3Cscript%3E",
        headers: { cookie: flow }
      });
      expect(denied.headers.location).toBe("https://tree.example/?sso_error=denied");
      const other = await app.inject({ method: "GET", url: "/auth/oidc/callback?error=server_error" });
      expect(other.headers.location).toBe("https://tree.example/?sso_error=failed");
      expect(provider.completeLogin).not.toHaveBeenCalled();
      await app.close();
    });

    it("sends sso_error=failed when the provider rejects the callback", async () => {
      const provider = fakeProvider();
      provider.completeLogin.mockRejectedValueOnce(new Error("state mismatch"));
      const app = await buildApp(provider);
      const { flow, state } = await startLogin(app);

      const response = await app.inject({
        method: "GET",
        url: `/auth/oidc/callback?code=abc&state=${state}`,
        headers: { cookie: flow }
      });

      expect(response.headers.location).toBe("https://tree.example/?sso_error=failed");
      expect(mocks.treemichSessionCreate).not.toHaveBeenCalled();
      await app.close();
    });
  });

  describe("POST /auth/login", () => {
    it("is refused in SSO-only mode", async () => {
      mocks.getOidcSettings.mockReturnValue(settings({ oidcOnly: true }));
      const app = await buildApp(fakeProvider());
      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "anth@example.com", password: "whatever", provider: "treemich" }
      });
      expect(response.statusCode).toBe(403);
      expect(mocks.treemichUserFindMany).not.toHaveBeenCalled();
      await app.close();
    });

    it("does not let a password be set on an SSO account that has none", async () => {
      mocks.getOidcSettings.mockReturnValue(settings());
      mocks.treemichUserFindMany.mockResolvedValue([
        { ...makeUser(), _count: { profiles: 3, oidcIdentities: 1 } }
      ]);
      mocks.treemichUserCount.mockResolvedValue(1);
      const app = await buildApp(fakeProvider());
      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "anth@example.com", password: "attacker-chosen", provider: "treemich" }
      });
      expect(response.statusCode).toBe(401);
      expect(mocks.treemichUserUpdate).not.toHaveBeenCalled();
      expect(mocks.treemichSessionCreate).not.toHaveBeenCalled();
      await app.close();
    });
  });
});
