/**
 * @file OpenID Connect single sign-on: `GET /auth/providers`, `GET /auth/oidc/login`, `GET /auth/oidc/callback`.
 *
 * Login starts with a browser navigation to `/auth/oidc/login`, which stores state, nonce and a PKCE verifier in
 * an encrypted short-lived cookie and redirects to the provider. The provider redirects back to the callback,
 * which checks that cookie, redeems the code and sets the normal Treemich session cookie. Failures redirect to
 * the web app with a fixed `sso_error` code (never provider text) for the login screen to explain.
 */

import rateLimit from "@fastify/rate-limit";
import type { AuthProviders } from "@treemich/shared";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { clearFlowCookie, readFlowCookie, setFlowCookie } from "../auth/oidc/flowCookie.js";
import { createOpaqueToken } from "../auth/crypto.js";
import { setSessionCookie } from "../auth/request.js";
import { OidcAccountNotFoundError, TreemichConflictError } from "../auth/service.js";
import { getOidcSettings, type OidcSettings } from "../config/env.js";
import { EXPENSIVE_ROUTE_RATE_LIMIT } from "./rate-limit.js";

/** Codes the web login screen maps to messages. */
export type OidcErrorCode = "unavailable" | "expired" | "denied" | "no_account" | "conflict" | "failed";

const redirectWithError = (reply: FastifyReply, settings: OidcSettings, code: OidcErrorCode) => {
  const target = new URL(settings.postLoginUrl);
  target.searchParams.set("sso_error", code);
  return reply.redirect(target.href);
};

export const registerAuthOidcRoutes: FastifyPluginAsync = async (app) => {
  app.get("/auth/providers", async (): Promise<AuthProviders> => {
    const settings = getOidcSettings();
    return {
      passwordLogin: !settings?.oidcOnly,
      oidc: settings ? { label: settings.buttonLabel } : null
    };
  });

  await app.register(async (oidcScope) => {
    await oidcScope.register(rateLimit, EXPENSIVE_ROUTE_RATE_LIMIT);

    oidcScope.get(
      "/auth/oidc/login",
      { config: { rateLimit: EXPENSIVE_ROUTE_RATE_LIMIT } },
      async (request, reply) => {
        const settings = getOidcSettings();
        const provider = app.services.oidcProvider;
        if (!settings || !provider) {
          return reply.code(404).send({ statusCode: 404, error: "SSO is not configured" });
        }

        const checks = {
          state: createOpaqueToken(),
          nonce: createOpaqueToken(),
          codeVerifier: createOpaqueToken()
        };
        let authorizationUrl: URL;
        try {
          authorizationUrl = await provider.authorizationUrl(checks);
        } catch (error) {
          request.log.error({ err: error }, "OIDC discovery or authorization URL failed");
          return redirectWithError(reply, settings, "unavailable");
        }
        setFlowCookie(reply, checks);
        return reply.redirect(authorizationUrl.href);
      }
    );

    oidcScope.get(
      "/auth/oidc/callback",
      { config: { rateLimit: EXPENSIVE_ROUTE_RATE_LIMIT } },
      async (request, reply) => {
        const settings = getOidcSettings();
        const provider = app.services.oidcProvider;
        if (!settings || !provider) {
          return reply.code(404).send({ statusCode: 404, error: "SSO is not configured" });
        }

        const checks = readFlowCookie(request);
        clearFlowCookie(reply);
        // The API sits behind a proxy (`/api` prefix), so rebuild the URL the provider redirected to from the
        // registered redirect URI plus the query exactly as received (`code`, `state`, `iss`, or `error`).
        const callbackUrl = new URL(settings.redirectUri);
        callbackUrl.search = new URL(request.raw.url ?? "", "http://callback.invalid").search;

        if (callbackUrl.searchParams.has("error")) {
          const providerError = callbackUrl.searchParams.get("error");
          request.log.warn({ providerError }, "OIDC provider returned an error");
          return redirectWithError(reply, settings, providerError === "access_denied" ? "denied" : "failed");
        }
        if (!checks) {
          return redirectWithError(reply, settings, "expired");
        }

        let profile;
        try {
          profile = await provider.completeLogin(callbackUrl, checks);
        } catch (error) {
          request.log.warn({ err: error }, "OIDC callback validation failed");
          return redirectWithError(reply, settings, "failed");
        }

        try {
          const result = await app.services.authService.loginWithOidc(profile, {
            autoRegister: settings.autoRegister
          });
          setSessionCookie(reply, result.sessionToken);
          return reply.redirect(settings.postLoginUrl.href);
        } catch (error) {
          if (error instanceof OidcAccountNotFoundError) {
            request.log.info(
              { issuer: profile.issuer, subject: profile.subject },
              "SSO login matched no account"
            );
            return redirectWithError(reply, settings, "no_account");
          }
          if (error instanceof TreemichConflictError) {
            return redirectWithError(reply, settings, "conflict");
          }
          request.log.error({ err: error }, "OIDC sign-in failed");
          return redirectWithError(reply, settings, "failed");
        }
      }
    );
  });
};
