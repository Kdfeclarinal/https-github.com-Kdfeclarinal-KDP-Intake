import test from 'node:test';
import assert from 'node:assert/strict';
import { frankfurterUrl, normalizeFrankfurterRates, SUPPORTED_PRICING_CURRENCIES } from '../../../supabase/functions/loadPricingFxRates/_pricingFx.js';

test('FX normalization accepts only a complete positive server response', () => {
  const rows = SUPPORTED_PRICING_CURRENCIES.filter((quote) => quote !== 'USD').map((quote, index) => ({ base: 'USD', quote, rate: index + 0.5, date: '2026-09-08' }));
  const result = normalizeFrankfurterRates(rows, 'USD');
  assert.equal(result.rates.USD, 1);
  assert.equal(result.source, 'Frankfurter / ECB reference rates');
  assert.equal(normalizeFrankfurterRates(rows.slice(1), 'USD'), null);
  assert.equal(normalizeFrankfurterRates([{ base: 'USD', quote: 'EUR', rate: -1 }], 'USD'), null);
});

test('FX provider request is server-oriented and requests every target currency', () => {
  const url = frankfurterUrl('USD');
  assert.match(url, /^https:\/\/api\.frankfurter\.dev\/v2\/rates\?/);
  assert.match(url, /providers=ECB/);
});
