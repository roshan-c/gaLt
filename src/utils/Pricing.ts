export function getImageCostUSD(size: '1024' | '512' | '256' = '1024', quality: 'low' | 'high' = 'low'): number {
  // Currently we generate 1024x1024, quality low by default.
  if (size === '1024' && quality === 'low') {
    const val = Number(process.env.IMAGE_COST_1024_LOW_USD || '0.04');
    return Number.isFinite(val) ? val : 0.04;
  }
  // Fallback for other sizes/qualities if you add them later
  const fallback = Number(process.env.IMAGE_COST_DEFAULT_USD || '0.04');
  return Number.isFinite(fallback) ? fallback : 0.04;
}

export function getTokenPricingUSDPer1K(): { input: number; output: number } {
  // Optional generic token pricing; if not provided, treat as 0 for dashboard estimates.
  const input = Number(process.env.PRICING_TOKENS_INPUT_PER_1K_USD || '0');
  const output = Number(process.env.PRICING_TOKENS_OUTPUT_PER_1K_USD || '0');
  return {
    input: Number.isFinite(input) ? input : 0,
    output: Number.isFinite(output) ? output : 0,
  };
}

export function getOpenAiPerTokenCostsUSD(): { inputPerToken: number; outputPerToken: number } {
  // Based on your rule: $0.250 per million input tokens, $2 per million output tokens
  // Convert per-million to per-token
  const inputPerToken = (0.250 / 1_000_000);
  const outputPerToken = (2 / 1_000_000);
  return { inputPerToken, outputPerToken };
}


