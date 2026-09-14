const RULES = [
  ['amazon.com', [0.99, 1.99, 2.99, 200], [2.99, 12.99]], ['amazon.in', [49, 69, 99, 10999], [99, 599]],
  ['amazon.co.uk', [0.77, 1.25, 1.49, 150], [1.77, 12.99]], ['amazon.de', [0.89, 1.79, 2.69, 215], [2.69, 12.99]],
  ['amazon.fr', [0.89, 1.79, 2.69, 215], [2.69, 12.99]], ['amazon.es', [0.89, 1.79, 2.69, 215], [2.69, 12.99]],
  ['amazon.it', [0.89, 1.79, 2.69, 215], [2.69, 12.99]], ['amazon.nl', [0.89, 1.79, 2.69, 215], [2.69, 12.99]],
  ['amazon.co.jp', [99, 99, 99, 20000], [250, 1650]], ['amazon.com.br', [1.99, 3.99, 5.99, 400], [5.99, 31.99]],
  ['amazon.ca', [0.99, 1.99, 2.99, 200], [2.99, 12.99]], ['amazon.com.mx', [11.99, 23.99, 34.99, 2500], [34.99, 199.99]],
  ['amazon.com.au', [0.99, 1.99, 3.99, 220], [3.99, 15.99]],
];

const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const positive = (value) => { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : null; };
function limits(rule, plan, fileSizeMB) {
  if (plan === '70') return { min: rule[2][0], max: rule[2][1] };
  const size = positive(fileSizeMB) || 0;
  return { min: size < 3 ? rule[1][0] : size < 10 ? rule[1][1] : rule[1][2], max: rule[1][3] };
}

export function validatePricingContract(stateJson, authoritativePrimaryMarketplace) {
  const errors = {};
  const sections = object(object(stateJson).sections);
  const territories = object(sections.territories);
  const mode = String(territories.territoryMode || territories.territory_mode || '').trim();
  const selected = Array.isArray(territories.selectedTerritories) ? territories.selectedTerritories : [];
  if (!['all_territories', 'individual_territories'].includes(mode)) errors['pricing.territories'] = 'Select territories for your book.';
  else if (mode === 'individual_territories' && selected.length === 0) errors['pricing.territories'] = 'Select at least one territory.';

  const primarySection = object(sections.primary_marketplace);
  const primary = String(primarySection.value || '').trim();
  if (!primary || primary !== authoritativePrimaryMarketplace) errors['pricing.primary_marketplace'] = 'Confirm the primary marketplace from Details.';

  const pricing = object(sections.royalty_and_pricing);
  const plan = String(pricing.royaltyPlan || pricing.royalty_plan || '').trim();
  const rows = Array.isArray(pricing.marketplaces) ? pricing.marketplaces : [];
  if (!['35', '70'].includes(plan)) errors['pricing.royalty_and_pricing'] = 'Choose a valid royalty plan.';
  if (!errors['pricing.royalty_and_pricing']) {
    for (const rule of RULES) {
      const row = rows.find((candidate) => object(candidate).id === rule[0]);
      const price = positive(object(row).listPrice);
      const band = limits(rule, plan, pricing.fileSizeMB ?? pricing.file_size_mb);
      if (price === null || price < band.min || price > band.max) {
        errors['pricing.royalty_and_pricing'] = `Enter a valid ${rule[0]} list price.`;
        break;
      }
    }
  }
  const primaryRow = rows.find((row) => object(row).id === primary);
  if (!errors['pricing.royalty_and_pricing'] && positive(pricing.primaryListPrice ?? pricing.primary_list_price) !== positive(object(primaryRow).listPrice)) {
    errors['pricing.royalty_and_pricing'] = 'Primary list price does not match the primary marketplace row.';
  }
  return errors;
}
