/**
 * @packageDocumentation
 * Unit tests for the photo co-occurrence image limit setting.
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
