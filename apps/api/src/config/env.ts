/**
 * @packageDocumentation
 * Typed process environment for the API: loads repo-root `.env`, parses with Zod, exposes feature toggles.
 */

import { config } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const resolveEnvFilePath = () => {
  if (process.env.TREEMICH_ENV_FILE) {
    return process.env.TREEMICH_ENV_FILE;
  }

  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(moduleDir, "../../../.env"),
    resolve(moduleDir, "../../../../.env")
  ];
  return candidates.find((candidate) => existsSync(candidate));
};

const envFilePath = resolveEnvFilePath();
config(envFilePath ? { path: envFilePath } : undefined);

const optionalBooleanString = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (value == null || value === "") {
      return false;
    }
    const normalized = value.toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Expected boolean-like value: true/false, 1/0, yes/no, on/off"
    });
    return z.NEVER;
  });

/** Compose files pass unset variables through as "", so treat "" as unset. */
const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);

const optionalUrlString = z.preprocess(emptyToUndefined, z.string().trim().url().optional());

const optionalNonEmptyString = z.preprocess(emptyToUndefined, z.string().trim().min(1).optional());

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().min(1),
    /** Optional Immich provider URL; only required when linking/importing Immich data. */
    IMMICH_BASE_URL: z
      .string()
      .trim()
      .url()
      .optional()
      .or(z.literal("").transform(() => undefined)),
    IMMICH_PEOPLE_PAGE_SIZE: z.coerce.number().int().positive().default(1000),
    IMMICH_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
    IMMICH_HTTP_MAX_RETRIES: z.coerce.number().int().nonnegative().default(2),
    IMMICH_HTTP_RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().default(200),
    /** Most images one photo co-occurrence count reads from Immich, newest first. */
    IMMICH_COOCCURRENCE_MAX_ASSETS: z.coerce.number().int().positive().default(250_000),
    WEB_ORIGIN: z.string().url().optional(),
    TREEMICH_TRUST_PROXY: optionalBooleanString,
    TREEMICH_ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, "TREEMICH_ENCRYPTION_KEY must be a 64-character hex string"),
    TREEMICH_ADMIN_PASSWORD: z.string().min(1).default("treemich-pass!"),
    TREEMICH_SESSION_COOKIE_NAME: z.string().min(1).default("treemich_session"),
    /** Dedicated Guest Session cookie for Focus Shares (never the owner session cookie). */
    TREEMICH_SHARE_SESSION_COOKIE_NAME: z.string().min(1).default("treemich_share_session"),
    /** When false, omit the Secure attribute on session cookies (required when serving over HTTP). */
    TREEMICH_COOKIE_SECURE: z.string().optional(),
    TREEMICH_SESSION_TTL_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(1000 * 60 * 60 * 24 * 30),
    /** Guest Session TTL for Focus Share unlock (default 4 hours). */
    TREEMICH_SHARE_SESSION_TTL_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(1000 * 60 * 60 * 4),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
    RATE_LIMIT_TIME_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    /** Stale GEDCOM import/export jobs may be reclaimed after this age (default: 24 hours). */
    TREEMICH_GEDCOM_JOB_STALE_AFTER_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(24 * 60 * 60 * 1000),
    /** Maximum aggregate rows a synchronous account/GEDCOM export will load into memory. */
    TREEMICH_EXPORT_MAX_ROWS: z.coerce.number().int().positive().default(100_000),
    /** Maximum profiles + relationships load allowed in full tree validation before rejecting request. */
    TREEMICH_TREE_VALIDATION_MAX_ROWS: z.coerce.number().int().positive().default(50_000),
    /** Maximum number of place aggregates returned by `GET /places/map`. */
    TREEMICH_PLACES_MAP_MAX_POINTS: z.coerce.number().int().positive().default(2000),
    /** When "false" / "0" / "no" / "off", `GET /tree/validation` returns empty `findings` (omitted in omitted env). */
    TREEMICH_VALIDATION_ENGINE_ENABLED: z.string().optional(),
    /** When "false" / "0" / "no" / "off", `GET /places/map` returns no place points for map UI. */
    MAP_UI_ENABLED: z.string().optional(),
    /** When "false" / "0" / "no" / "off", skip automatic geocoding for profile birth city/country edits. */
    TREEMICH_PROFILE_PLACE_GEOCODING_ENABLED: z.string().optional(),
    /**
     * When "false" / "0" / "no" / "off", disables Phase 4 family HTTP routes (`/families`, `/people/:id/families`,
     * `/families/:id/life-events`). Default when unset: enabled.
     */
    TREEMICH_FAMILY_MODEL_ENABLED: z.string().optional(),
    /**
     * When "false" / "0" / "no" / "off", skips the **one-time** automatic Phase 4 family backfill on API boot
     * (infer `Family` rows from untagged `PARENT_OF` edges). Default when unset: **enabled** so upgrades
     * populate family units without a manual script.
     */
    TREEMICH_AUTO_PHASE4_FAMILY_BACKFILL: z.string().optional(),
    /**
     * When "false" / "0" / "no" / "off", disables `GET /export/gedcom` (Phase 5a GEDCOM export).
     * Default when unset: enabled.
     */
    TREEMICH_GEDCOM_EXPORT_ENABLED: z.string().optional(),
    /**
     * When "true" / "1" / "yes" / "on", enables `POST /import/gedcom/*` (Phase 5b). Default when unset: **disabled**
     * so imports never run accidentally.
     */
    TREEMICH_GEDCOM_IMPORT_ENABLED: z.string().optional(),
    /** Max UTF-8 byte length for `gedcomUtf8` on import endpoints (default 3_000_000). */
    TREEMICH_GEDCOM_IMPORT_MAX_BYTES: z.coerce.number().int().positive().optional(),
    /** Max physical lines accepted by the GEDCOM parser (default 250_000). */
    TREEMICH_GEDCOM_IMPORT_MAX_LINES: z.coerce.number().int().positive().optional(),
    /** Max line-log entries returned on job GET / stored on create (default 2000). */
    TREEMICH_GEDCOM_IMPORT_MAX_LINE_LOG: z.coerce.number().int().positive().optional(),
    /** Durable local directory for imported evidence media files. */
    TREEMICH_MEDIA_STORAGE_DIR: z.string().min(1).default("data/media"),
    /** Max ZIP upload size for GEDCOM + media archive imports (default 100 MB). */
    TREEMICH_GEDCOM_MEDIA_MAX_BYTES: z.coerce.number().int().positive().optional(),
    /** Max individual media file size accepted from GEDCOM archive imports (default 50 MB). */
    TREEMICH_GEDCOM_MEDIA_MAX_FILE_BYTES: z.coerce.number().int().positive().optional(),
    /**
     * When "false" / "0" / "no" / "off", disables synchronous structured report routes.
     * Default when unset: enabled.
     */
    TREEMICH_REPORTS_ENABLED: z.string().optional(),
    /** Operator report traversal depth cap. Effective cap is bounded by hard safety max. */
    TREEMICH_REPORT_MAX_DEPTH: z.coerce.number().int().positive().optional(),
    /** Max people a single report traversal may include before rejecting. */
    TREEMICH_REPORT_MAX_PEOPLE: z.coerce.number().int().positive().optional(),
    /** Reserved for future server-rendered PDF/export jobs. Default disabled. */
    TREEMICH_REPORT_PDF_ENABLED: z.string().optional(),
    /**
     * OpenID Connect single sign-on. Setting the issuer, client id and client secret together adds a
     * "Sign in with SSO" button. Leave all three unset to keep SSO off.
     */
    TREEMICH_OIDC_ISSUER: optionalUrlString,
    TREEMICH_OIDC_CLIENT_ID: optionalNonEmptyString,
    TREEMICH_OIDC_CLIENT_SECRET: optionalNonEmptyString,
    /** How the client secret is sent to the token endpoint. */
    TREEMICH_OIDC_TOKEN_AUTH_METHOD: z.preprocess(
      emptyToUndefined,
      z.enum(["client_secret_basic", "client_secret_post"]).default("client_secret_basic")
    ),
    /** Callback URL registered with the provider. Default: `${WEB_ORIGIN}/api/auth/oidc/callback`. */
    TREEMICH_OIDC_REDIRECT_URI: optionalUrlString,
    TREEMICH_OIDC_SCOPES: z.preprocess(
      emptyToUndefined,
      z.string().trim().min(1).default("openid profile email")
    ),
    TREEMICH_OIDC_BUTTON_LABEL: z.preprocess(
      emptyToUndefined,
      z.string().trim().min(1).default("Sign in with SSO")
    ),
    /** When true, an SSO login with no matching Treemich account creates one. Default: off (link by email only). */
    TREEMICH_OIDC_AUTO_REGISTER: optionalBooleanString,
    /** When true, email/password and Immich migration sign-in are turned off and SSO is the only way in. */
    TREEMICH_OIDC_ONLY: optionalBooleanString
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === "production" && !value.WEB_ORIGIN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["WEB_ORIGIN"],
        message: "WEB_ORIGIN is required when NODE_ENV=production"
      });
    }

    const oidcParts = [
      value.TREEMICH_OIDC_ISSUER,
      value.TREEMICH_OIDC_CLIENT_ID,
      value.TREEMICH_OIDC_CLIENT_SECRET
    ];
    const oidcConfigured = oidcParts.every(Boolean);
    if (!oidcConfigured && oidcParts.some(Boolean)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["TREEMICH_OIDC_ISSUER"],
        message:
          "TREEMICH_OIDC_ISSUER, TREEMICH_OIDC_CLIENT_ID and TREEMICH_OIDC_CLIENT_SECRET must be set together"
      });
    }
    if (value.TREEMICH_OIDC_ONLY && !oidcConfigured) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["TREEMICH_OIDC_ONLY"],
        message:
          "TREEMICH_OIDC_ONLY needs TREEMICH_OIDC_ISSUER, TREEMICH_OIDC_CLIENT_ID and TREEMICH_OIDC_CLIENT_SECRET"
      });
    }
    if (!oidcConfigured) {
      return;
    }
    if (!value.TREEMICH_OIDC_REDIRECT_URI && !value.WEB_ORIGIN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["TREEMICH_OIDC_REDIRECT_URI"],
        message: "Set TREEMICH_OIDC_REDIRECT_URI or WEB_ORIGIN when OIDC sign-in is enabled"
      });
    }
    if (value.TREEMICH_OIDC_REDIRECT_URI) {
      const redirect = new URL(value.TREEMICH_OIDC_REDIRECT_URI);
      if (redirect.search || redirect.hash) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["TREEMICH_OIDC_REDIRECT_URI"],
          message: "TREEMICH_OIDC_REDIRECT_URI must not contain a query string or fragment"
        });
      }
    }
    if (!value.TREEMICH_OIDC_SCOPES.split(/\s+/).includes("openid")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["TREEMICH_OIDC_SCOPES"],
        message: 'TREEMICH_OIDC_SCOPES must include "openid"'
      });
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

/** Parses and validates an environment object (throws on misconfiguration). */
export const parseEnv = (source: NodeJS.ProcessEnv): AppEnv => envSchema.parse(source);

/** Parsed and validated environment (throws at boot on misconfiguration). */
export const env: AppEnv = parseEnv(process.env);

/** Whether to set the Secure flag on session cookies. Defaults to true in production. */
export const isCookieSecure = (cookieSecure?: string, nodeEnv?: string): boolean => {
  const secure = cookieSecure ?? env.TREEMICH_COOKIE_SECURE;
  const envName = nodeEnv ?? env.NODE_ENV;
  if (secure == null || secure === "") {
    return envName === "production";
  }
  return !["0", "false", "no", "off"].includes(secure.toLowerCase());
};

/** Feature flag: whole-tree validation engine (`GET /tree/validation`). */
export const isTreeValidationEngineEnabled = (): boolean => {
  const v = env.TREEMICH_VALIDATION_ENGINE_ENABLED;
  if (v == null || v === "") {
    return true;
  }
  return !["0", "false", "no", "off"].includes(v.toLowerCase());
};

/** Feature flag: geocoded places map feed (`GET /places/map`). */
export const isMapUiEnabled = (): boolean => {
  const v = env.MAP_UI_ENABLED;
  if (v == null || v === "") {
    return true;
  }
  return !["0", "false", "no", "off"].includes(v.toLowerCase());
};

/** Feature flag: Nominatim backfill when profile birth city/country is saved. */
export const isProfilePlaceGeocodingEnabled = (): boolean => {
  const v = env.TREEMICH_PROFILE_PLACE_GEOCODING_ENABLED;
  if (v == null || v === "") {
    return true;
  }
  return !["0", "false", "no", "off"].includes(v.toLowerCase());
};

/** Feature flag: Phase 4 family model HTTP surface. */
export const isFamilyModelEnabled = (): boolean => {
  const v = env.TREEMICH_FAMILY_MODEL_ENABLED;
  if (v == null || v === "") {
    return true;
  }
  return !["0", "false", "no", "off"].includes(v.toLowerCase());
};

/** One-shot automatic family backfill after DB upgrade (see `maybeRunAutomaticPhase4FamilyBackfillOnBoot`). */
export const isAutoPhase4FamilyBackfillEnabled = (): boolean => {
  const v = env.TREEMICH_AUTO_PHASE4_FAMILY_BACKFILL;
  if (v == null || v === "") {
    return true;
  }
  return !["0", "false", "no", "off"].includes(v.toLowerCase());
};

/** Phase 5a: `GET /export/gedcom` (GEDCOM 5.5.1 UTF-8 + optional ZIP xref sidecar). */
export const isGedcomExportEnabled = (): boolean => {
  const v = env.TREEMICH_GEDCOM_EXPORT_ENABLED;
  if (v == null || v === "") {
    return true;
  }
  return !["0", "false", "no", "off"].includes(v.toLowerCase());
};

/** Phase 5b: GEDCOM import (`POST /import/gedcom/*`). Default **off** when unset. */
export const isGedcomImportEnabled = (): boolean => {
  const v = env.TREEMICH_GEDCOM_IMPORT_ENABLED;
  if (v == null || v === "") {
    return false;
  }
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
};

export const maxGedcomImportBytes = (): number => env.TREEMICH_GEDCOM_IMPORT_MAX_BYTES ?? 3_000_000;

export const maxGedcomImportLineLogEntries = (): number => env.TREEMICH_GEDCOM_IMPORT_MAX_LINE_LOG ?? 2000;

export const maxGedcomImportLines = (): number => env.TREEMICH_GEDCOM_IMPORT_MAX_LINES ?? 250_000;

export const maxGedcomMediaArchiveBytes = (): number => env.TREEMICH_GEDCOM_MEDIA_MAX_BYTES ?? 100_000_000;

export const maxGedcomMediaFileBytes = (): number => env.TREEMICH_GEDCOM_MEDIA_MAX_FILE_BYTES ?? 50_000_000;

export const isReportsEnabled = (): boolean => {
  const v = env.TREEMICH_REPORTS_ENABLED;
  if (v == null || v === "") {
    return true;
  }
  return !["0", "false", "no", "off"].includes(v.toLowerCase());
};

export const reportMaxDepth = (): number => Math.min(env.TREEMICH_REPORT_MAX_DEPTH ?? 6, 10);

export const reportMaxPeople = (): number => env.TREEMICH_REPORT_MAX_PEOPLE ?? 1000;

/** Resolved OpenID Connect sign-in settings, or `null` when SSO is not configured. */
export type OidcSettings = {
  issuer: URL;
  clientId: string;
  clientSecret: string;
  tokenAuthMethod: "client_secret_basic" | "client_secret_post";
  redirectUri: URL;
  /** Where the browser lands after the SSO callback, signed in or with an `sso_error` code. */
  postLoginUrl: URL;
  scopes: string;
  buttonLabel: string;
  autoRegister: boolean;
  oidcOnly: boolean;
};

export const getOidcSettings = (source: AppEnv = env): OidcSettings | null => {
  const issuer = source.TREEMICH_OIDC_ISSUER;
  const clientId = source.TREEMICH_OIDC_CLIENT_ID;
  const clientSecret = source.TREEMICH_OIDC_CLIENT_SECRET;
  if (!issuer || !clientId || !clientSecret) {
    return null;
  }
  const redirectUri = source.TREEMICH_OIDC_REDIRECT_URI
    ? new URL(source.TREEMICH_OIDC_REDIRECT_URI)
    : new URL("/api/auth/oidc/callback", source.WEB_ORIGIN);
  return {
    issuer: new URL(issuer),
    clientId,
    clientSecret,
    tokenAuthMethod: source.TREEMICH_OIDC_TOKEN_AUTH_METHOD,
    redirectUri,
    postLoginUrl: new URL("/", source.WEB_ORIGIN ?? redirectUri),
    scopes: source.TREEMICH_OIDC_SCOPES,
    buttonLabel: source.TREEMICH_OIDC_BUTTON_LABEL,
    autoRegister: source.TREEMICH_OIDC_AUTO_REGISTER,
    oidcOnly: source.TREEMICH_OIDC_ONLY
  };
};

export const isReportPdfEnabled = (): boolean => {
  const v = env.TREEMICH_REPORT_PDF_ENABLED;
  if (v == null || v === "") {
    return false;
  }
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
};
