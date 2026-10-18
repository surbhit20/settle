import { describe, expect, it } from "vitest";
import { getDatabaseUrl } from "@/lib/db";

describe("getDatabaseUrl", () => {
  it("returns DATABASE_URL when set", () => {
    expect(getDatabaseUrl({ DATABASE_URL: "postgres://x" })).toBe("postgres://x");
  });

  it("throws a helpful error when DATABASE_URL is missing", () => {
    expect(() => getDatabaseUrl({})).toThrow(/DATABASE_URL is not set/);
  });
});
