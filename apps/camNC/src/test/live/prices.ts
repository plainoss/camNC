/** USD per million tokens. gpt-5.4-mini: published list price (2026-11). gemini-3.5-flash: a conservative estimate. */
export const kLivePrices: Record<string, { input: number; cached: number; output: number }> = {
  'gpt-5.4-mini': { input: 0.75, cached: 0.075, output: 4.5 },
  'gemini-3.5-flash': { input: 1.5, cached: 0.15, output: 9 },
};

/** Models without a listed price are booked at this deliberately high rate. */
export const livePrice = (model: string) => kLivePrices[model] ?? { input: 2, cached: 2, output: 12 };
