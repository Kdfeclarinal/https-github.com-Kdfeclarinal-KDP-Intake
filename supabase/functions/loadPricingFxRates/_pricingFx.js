export const SUPPORTED_PRICING_CURRENCIES = ['AUD', 'BRL', 'CAD', 'EUR', 'GBP', 'INR', 'JPY', 'MXN', 'USD'];

export function normalizeFrankfurterRates(rows, base) {
  if (!SUPPORTED_PRICING_CURRENCIES.includes(base) || !Array.isArray(rows)) return null;
  const rates = { [base]: 1 };
  let asOf = null;
  for (const row of rows) {
    if (!row || row.base !== base || !SUPPORTED_PRICING_CURRENCIES.includes(row.quote)) continue;
    const rate = Number(row.rate);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    rates[row.quote] = rate;
    if (typeof row.date === 'string' && (!asOf || row.date > asOf)) asOf = row.date;
  }
  if (SUPPORTED_PRICING_CURRENCIES.some((currency) => rates[currency] == null)) return null;
  return { base, rates, asOf, source: 'Frankfurter / ECB reference rates' };
}

export function frankfurterUrl(base) {
  const quotes = SUPPORTED_PRICING_CURRENCIES.filter((currency) => currency !== base).join(',');
  return `https://api.frankfurter.dev/v2/rates?base=${encodeURIComponent(base)}&quotes=${encodeURIComponent(quotes)}&providers=ECB`;
}
