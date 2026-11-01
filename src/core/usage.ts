import type { UsageSummary } from "./types.ts";

const fields = ["input", "output", "cacheRead", "cacheWrite", "reasoning", "totalTokens", "costUsd"] as const;

/** No provider accounting is available; this is not a zero-cost response. */
export function emptyUsage(): UsageSummary {
  return {
    input: null, output: null, cacheRead: null, cacheWrite: null, reasoning: null,
    totalTokens: null, costUsd: null, responses: 0, completeness: "unknown",
  };
}

/** Add known subtotals while keeping missing attempts visible in completeness. */
export function combineUsage(items: UsageSummary[]): UsageSummary {
  const result = emptyUsage();
  for (const item of items) {
    result.responses += item.responses;
    for (const field of fields) {
      const value = item[field];
      if (value !== null) result[field] = (result[field] ?? 0) + value;
    }
  }
  if (fields.some((field) => result[field] !== null)) {
    result.completeness = items.every((item) => item.completeness === "known") ? "known" : "partial";
  }
  return result;
}
