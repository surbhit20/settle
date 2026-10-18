// Tests for the pure parts of the Mireye geocode and ORS matrix clients. No network calls.
import { describe, expect, it } from "vitest";
import { addressKey, parseGeocodeResponse } from "@/lib/geocode";
import { buildMatrixRequest, officeKey, parseMatrixResponse } from "@/lib/commute";

describe("addressKey", () => {
  it("trims, lowercases and collapses whitespace", () => {
    expect(addressKey("  1 Market St,   San Francisco ")).toBe("1 market st, san francisco");
  });
});

describe("parseGeocodeResponse", () => {
  const ok = { lat: 37.79, lng: -122.39, accuracy_type: "rooftop", normalized_address: "1 Market St", source: "SF" };

  it("accepts rooftop results", () => {
    expect(parseGeocodeResponse(200, ok)).toMatchObject({ ok: true, lat: 37.79, accuracyType: "rooftop" });
  });

  it("accepts street interpolation", () => {
    expect(parseGeocodeResponse(200, { ...ok, accuracy_type: "range_interpolation" }).ok).toBe(true);
  });

  it("rejects any centroid-grade accuracy even if Mireye returned 200", () => {
    const r = parseGeocodeResponse(200, { ...ok, accuracy_type: "zip_centroid" });
    expect(r).toMatchObject({ ok: false, status: "rejected_accuracy" });
  });

  it("maps Mireye's 404 refusals to friendly results", () => {
    expect(parseGeocodeResponse(404, { detail: { error: "address_too_coarse" } })).toMatchObject({ ok: false, status: "too_coarse" });
    expect(parseGeocodeResponse(404, { detail: { error: "address_not_found" } })).toMatchObject({ ok: false, status: "not_found" });
  });

  it("throws (so nothing is cached) on outages and auth errors", () => {
    expect(() => parseGeocodeResponse(502, { detail: { error: "geocode_upstream_error" } })).toThrow();
    expect(() => parseGeocodeResponse(401, {})).toThrow();
  });
});

describe("ORS matrix", () => {
  const office = { lat: 37.794, lng: -122.395 };
  const areas = [
    { zcta: "94110", lat: 37.75, lng: -122.41 },
    { zcta: "94301", lat: 37.44, lng: -122.15 },
  ];

  it("rounds the office to 3 decimals for the cache key", () => {
    expect(officeKey({ lat: 37.79398, lng: -122.39498 })).toBe("37.794,-122.395");
  });

  it("builds one request: areas are sources, office is the single destination, [lng, lat] order", () => {
    expect(buildMatrixRequest(office, areas)).toEqual({
      locations: [[-122.41, 37.75], [-122.15, 37.44], [-122.395, 37.794]],
      sources: [0, 1],
      destinations: [2],
      metrics: ["duration"],
    });
  });

  it("converts seconds to minutes and keeps unroutable areas as null", () => {
    const m = parseMatrixResponse({ durations: [[900], [null]] }, areas);
    expect(m.get("94110")).toBe(15);
    expect(m.get("94301")).toBeNull();
  });

  it("rejects a response whose size doesn't match the request", () => {
    expect(() => parseMatrixResponse({ durations: [[900]] }, areas)).toThrow();
  });
});
