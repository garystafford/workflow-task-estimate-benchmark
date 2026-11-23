export function pricedUsage(usage) {
  if (!usage) return null;
  const input = usage.input_tokens,
    output = usage.output_tokens,
    cached = usage.input_tokens_details?.cached_tokens ?? 0;
  if (
    ![input, output, cached].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    cached > input ||
    input > 272000
  )
    return null;
  return ((input - cached) * 2 + cached * 0.1 + output * 10) / 1e6;
}
