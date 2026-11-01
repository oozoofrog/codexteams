import assert from "node:assert/strict";
import test from "node:test";
import { combineUsage, emptyUsage } from "../src/core/usage.ts";
import type { UsageSummary } from "../src/core/types.ts";

const known: UsageSummary = {
  input: 10, output: 8, cacheRead: 3, cacheWrite: 2, reasoning: 4,
  totalTokens: 23, costUsd: 0.012, responses: 1, completeness: "known",
};

test("unreported usage remains unknown instead of reporting a free zero-token call", () => {
  assert.deepEqual(emptyUsage(), {
    input: null, output: null, cacheRead: null, cacheWrite: null, reasoning: null,
    totalTokens: null, costUsd: null, responses: 0, completeness: "unknown",
  });
  assert.deepEqual(combineUsage([]), emptyUsage());
});

test("combining finalized usage adds reasoning only to its breakdown, never total tokens", () => {
  assert.deepEqual(combineUsage([known, known]), {
    input: 20, output: 16, cacheRead: 6, cacheWrite: 4, reasoning: 8,
    totalTokens: 46, costUsd: 0.024, responses: 2, completeness: "known",
  });
  assert.equal(known.totalTokens, 23);
});

test("an unreported attempt makes a known subtotal partial without fabricating its usage", () => {
  assert.deepEqual(combineUsage([known, emptyUsage()]), { ...known, completeness: "partial" });
  assert.deepEqual(combineUsage([emptyUsage(), emptyUsage()]), emptyUsage());
});

test("optional reasoning may be unknown even when token totals and estimated cost are known", () => {
  const summary = combineUsage([{ ...known, reasoning: null }, { ...known, reasoning: null }]);
  assert.equal(summary.reasoning, null);
  assert.equal(summary.totalTokens, 46);
  assert.equal(summary.completeness, "known");
});

test("partial fields preserve known subtotals and cannot silently become complete", () => {
  const partial: UsageSummary = {
    ...emptyUsage(), input: 7, output: 2, responses: 1, completeness: "partial",
  };
  assert.deepEqual(combineUsage([known, partial]), {
    ...known, input: 17, output: 10, responses: 2, completeness: "partial",
  });
});
