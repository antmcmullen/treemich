/**
 * @packageDocumentation
 * OpenID Connect provider client (authorization code flow with PKCE, state and nonce) built on `openid-client`.
 */

import * as client from "openid-client";
import type { OidcSettings } from "../../config/env.js";

/** Per-login values generated at `/auth/oidc/login` and checked at the callback. */
export type OidcFlowChecks = {
  state: string;
  nonce: string;
  codeVerifier: string;
};

/** The identity claims Treemich uses from a verified ID token plus the userinfo response. */
export type OidcProfile = {
  issuer: string;
  subject: string;
  email: string | null;
  /** `null` when the provider does not send `email_verified`. */
  emailVerified: boolean | null;
  name: string | null;
};

export interface OidcProvider {
  /** URL to send the browser to for sign-in at the provider. */
  authorizationUrl(checks: OidcFlowChecks): Promise<URL>;
  /**
   * Validates the callback (state, `iss`), redeems the code (PKCE), verifies the ID token (signature, nonce,
   * audience, expiry) and reads userinfo.
   */
  completeLogin(callbackUrl: URL, checks: OidcFlowChecks): Promise<OidcProfile>;
}

const stringClaim = (value: unknown) =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

/** `openid-client` implementation. Discovery runs on first use and is cached; a failed discovery is retried. */
export class OpenIdClientProvider implements OidcProvider {
  private configuration: Promise<client.Configuration> | undefined;

  constructor(private readonly settings: OidcSettings) {}

  private getConfiguration() {
    this.configuration ??= this.discover().catch((error: unknown) => {
      this.configuration = undefined;
      throw error;
    });
    return this.configuration;
  }

  private discover() {
    const { issuer, clientId, clientSecret, tokenAuthMethod } = this.settings;
    const clientAuth =
      tokenAuthMethod === "client_secret_post"
        ? client.ClientSecretPost(clientSecret)
        : client.ClientSecretBasic(clientSecret);
    return client.discovery(issuer, clientId, undefined, clientAuth, {
      timeout: 10,
      // Plain-http issuers are only accepted for local development and tests.
      execute: issuer.protocol === "http:" ? [client.allowInsecureRequests] : []
    });
  }

  async authorizationUrl(checks: OidcFlowChecks) {
    const config = await this.getConfiguration();
    return client.buildAuthorizationUrl(config, {
      redirect_uri: this.settings.redirectUri.href,
      scope: this.settings.scopes,
      state: checks.state,
      nonce: checks.nonce,
      code_challenge: await client.calculatePKCECodeChallenge(checks.codeVerifier),
      code_challenge_method: "S256"
    });
  }

  async completeLogin(callbackUrl: URL, checks: OidcFlowChecks): Promise<OidcProfile> {
    const config = await this.getConfiguration();
    const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
      expectedState: checks.state,
      expectedNonce: checks.nonce,
      pkceCodeVerifier: checks.codeVerifier,
      idTokenExpected: true
    });
    const idToken = tokens.claims();
    if (!idToken) {
      throw new Error("OIDC provider returned no ID token");
    }

    let claims: Record<string, unknown> = { ...idToken };
    if (config.serverMetadata().userinfo_endpoint) {
      const userInfo = await client.fetchUserInfo(config, tokens.access_token, idToken.sub);
      claims = { ...claims, ...userInfo };
    }

    return {
      issuer: idToken.iss,
      subject: idToken.sub,
      email: stringClaim(claims.email),
      emailVerified: typeof claims.email_verified === "boolean" ? claims.email_verified : null,
      name: stringClaim(claims.name) ?? stringClaim(claims.preferred_username)
    };
  }
}
