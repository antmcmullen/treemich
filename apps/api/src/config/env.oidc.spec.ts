/**
 * @packageDocumentation
 * Unit tests for the OpenID Connect env variables and `getOidcSettings()`.
 */

import { describe, expect, it } from "vitest";
import { getOidcSettings, parseEnv } from "./env.js";

const base = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@localhost:5432/treemich_test",
  TREEMICH_ENCRYPTION_KEY: "0".repeat(64),
  WEB_ORIGIN: "https://tree.example"
};

const oidc = {
  TREEMICH_OIDC_ISSUER: "https://auth.example",
  TREEMICH_OIDC_CLIENT_ID: "treemich",
  TREEMICH_OIDC_CLIENT_SECRET: "s3cret"
};

describe("OIDC env", () => {
  it("leaves SSO off when nothing is set, including compose-style empty strings", () => {
    expect(getOidcSettings(parseEnv(base))).toBeNull();
    expect(
      getOidcSettings(
        parseEnv({
          ...base,
          TREEMICH_OIDC_ISSUER: "",
          TREEMICH_OIDC_CLIENT_ID: "",
          TREEMICH_OIDC_CLIENT_SECRET: "",
          TREEMICH_OIDC_TOKEN_AUTH_METHOD: "",
          TREEMICH_OIDC_REDIRECT_URI: "",
          TREEMICH_OIDC_SCOPES: "",
          TREEMICH_OIDC_BUTTON_LABEL: "",
          TREEMICH_OIDC_AUTO_REGISTER: "",
          TREEMICH_OIDC_ONLY: ""
        })
      )
    ).toBeNull();
  });

  it("derives defaults from WEB_ORIGIN", () => {
    const settings = getOidcSettings(parseEnv({ ...base, ...oidc }));
    expect(settings).toMatchObject({
      clientId: "treemich",
      clientSecret: "s3cret",
      tokenAuthMethod: "client_secret_basic",
      scopes: "openid profile email",
      buttonLabel: "Sign in with SSO",
      autoRegister: false,
      oidcOnly: false
    });
    expect(settings?.issuer.href).toBe("https://auth.example/");
    expect(settings?.redirectUri.href).toBe("https://tree.example/api/auth/oidc/callback");
    expect(settings?.postLoginUrl.href).toBe("https://tree.example/");
  });

  it("uses an explicit redirect URI and options", () => {
    const settings = getOidcSettings(
      parseEnv({
        ...base,
        ...oidc,
        TREEMICH_OIDC_REDIRECT_URI: "https://tree.example/custom/callback",
        TREEMICH_OIDC_TOKEN_AUTH_METHOD: "client_secret_post",
        TREEMICH_OIDC_SCOPES: "openid email",
        TREEMICH_OIDC_BUTTON_LABEL: "McMullen login",
        TREEMICH_OIDC_AUTO_REGISTER: "true",
        TREEMICH_OIDC_ONLY: "yes"
      })
    );
    expect(settings).toMatchObject({
      tokenAuthMethod: "client_secret_post",
      scopes: "openid email",
      buttonLabel: "McMullen login",
      autoRegister: true,
      oidcOnly: true
    });
    expect(settings?.redirectUri.href).toBe("https://tree.example/custom/callback");
  });

  it("rejects a partial configuration", () => {
    expect(() => parseEnv({ ...base, TREEMICH_OIDC_ISSUER: "https://auth.example" })).toThrow(
      /must be set together/
    );
  });

  it("rejects TREEMICH_OIDC_ONLY without a provider", () => {
    expect(() => parseEnv({ ...base, TREEMICH_OIDC_ONLY: "true" })).toThrow(/TREEMICH_OIDC_ONLY needs/);
  });

  it("needs WEB_ORIGIN or an explicit redirect URI", () => {
    const noOrigin = { ...base, WEB_ORIGIN: undefined };
    expect(() => parseEnv({ ...noOrigin, ...oidc })).toThrow(/TREEMICH_OIDC_REDIRECT_URI or WEB_ORIGIN/);
    expect(
      getOidcSettings(
        parseEnv({
          ...noOrigin,
          ...oidc,
          TREEMICH_OIDC_REDIRECT_URI: "https://tree.example/api/auth/oidc/callback"
        })
      )?.postLoginUrl.href
    ).toBe("https://tree.example/");
  });

  it("rejects a redirect URI with a query string, and scopes without openid", () => {
    expect(() =>
      parseEnv({ ...base, ...oidc, TREEMICH_OIDC_REDIRECT_URI: "https://tree.example/cb?x=1" })
    ).toThrow(/must not contain a query/);
    expect(() => parseEnv({ ...base, ...oidc, TREEMICH_OIDC_SCOPES: "profile email" })).toThrow(
      /must include/
    );
  });

  it("rejects an unknown token auth method", () => {
    expect(() =>
      parseEnv({ ...base, ...oidc, TREEMICH_OIDC_TOKEN_AUTH_METHOD: "private_key_jwt" })
    ).toThrow();
  });
});
