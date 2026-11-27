/**
 * @packageDocumentation
 * Unit tests for the Immich photo co-occurrence limit and public address settings.
 */

import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.js";

const base = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@localhost:5432/treemich_test",
  TREEMICH_ENCRYPTION_KEY: "0".repeat(64)
};

describe("IMMICH_COOCCURRENCE_MAX_ASSETS", () => {
  it("defaults to 250,000 images", () => {
    expect(parseEnv(base).IMMICH_COOCCURRENCE_MAX_ASSETS).toBe(250_000);
  });

  it("accepts a positive whole number and rejects zero", () => {
    expect(
      parseEnv({ ...base, IMMICH_COOCCURRENCE_MAX_ASSETS: "60000" }).IMMICH_COOCCURRENCE_MAX_ASSETS
    ).toBe(60_000);
    expect(() => parseEnv({ ...base, IMMICH_COOCCURRENCE_MAX_ASSETS: "0" })).toThrow();
  });
});

describe("IMMICH_PUBLIC_URL", () => {
  it("is unset by default and when compose passes an empty string", () => {
    expect(parseEnv(base).IMMICH_PUBLIC_URL).toBeUndefined();
    expect(parseEnv({ ...base, IMMICH_PUBLIC_URL: "" }).IMMICH_PUBLIC_URL).toBeUndefined();
  });

  it("accepts a URL and rejects anything else", () => {
    expect(parseEnv({ ...base, IMMICH_PUBLIC_URL: "https://photos.example" }).IMMICH_PUBLIC_URL).toBe(
      "https://photos.example"
    );
    expect(() => parseEnv({ ...base, IMMICH_PUBLIC_URL: "photos" })).toThrow();
  });
});
