import { describe, expect, it } from "vitest";
import { DEFAULT_RATING, MAX_RATING, MIN_RATING, RATING_BANDS, bandFor, clampRating } from "./rating";

describe("bandFor", () => {
  it("labels the ends of every band", () => {
    for (const band of RATING_BANDS) {
      expect(bandFor(band.from)).toBe(band);
      expect(bandFor(band.to)).toBe(band);
    }
  });

  it("covers every Rating from 1 to 100 with exactly one band", () => {
    for (let rating = MIN_RATING; rating <= MAX_RATING; rating++) {
      const hits = RATING_BANDS.filter((b) => rating >= b.from && rating <= b.to);
      expect(hits, `rating ${rating}`).toHaveLength(1);
    }
  });

  it("puts the default Rating of 50 in the middle band", () => {
    expect(DEFAULT_RATING).toBe(50);
    expect(bandFor(DEFAULT_RATING)).toBe(RATING_BANDS[2]);
  });
});

describe("clampRating", () => {
  it("keeps a Rating a whole number from 1 to 100", () => {
    expect(clampRating(0)).toBe(1);
    expect(clampRating(-5)).toBe(1);
    expect(clampRating(101)).toBe(100);
    expect(clampRating(62.6)).toBe(63);
    expect(clampRating(Number.NaN)).toBe(DEFAULT_RATING);
  });
});
