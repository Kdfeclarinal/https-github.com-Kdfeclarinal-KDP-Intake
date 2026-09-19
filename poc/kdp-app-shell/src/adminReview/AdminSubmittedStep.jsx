import React from 'react';

const h = React.createElement;

const DETAIL_HELP = {
  language: 'Choose the primary language your book is written in.',
  book_title: 'Enter your title as it appears on the book cover. If you add a subtitle, it follows the title on Amazon.',
  series: 'If your book is part of a series (or will eventually be), you can add it now or later.',
  edition_number: 'The edition number tells readers whether the book is an original or updated version.',
  author: 'Enter the primary author or contributor for this book.',
  contributors: "Add up to 9 contributors. They'll display on Amazon using the order you enter below.",
  description: 'Summarize your book. This will be your product description on Amazon, so customers can learn more about your book.',
  primary_marketplace: 'Choose the location where you expect the majority of your book sales.',
  categories: 'Choose up to three categories that describe your book.',
  keywords: 'Choose up to 7 keywords highlighting your book’s unique traits.',
};

const localKey = (item) => String(item?.sectionKey || '').split('.').pop();

function unwrap(value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'sectionKey') && Object.hasOwn(value, 'value')) {
    return value.value;
  }
  return value ?? null;
}

function getStepValue(submittedSteps, item) {
  const step = String(item?.step || '');
  const key = localKey(item);
  const data = submittedSteps?.[step] || {};
  if (Object.hasOwn(data, key)) return data[key];
  return unwrap(item?.snapshot?.value);
}

function ReadOnlyInput({ value = '', ariaLabel }) {
  return h('input', {
    className: 'kdp-input',
    value: value ?? '',
    readOnly: true,
    tabIndex: -1,
    'aria-label': ariaLabel,
  });
}

function ReadOnlySelect({ value = '', ariaLabel }) {
  return h('select', {
    className: 'kdp-select',
    value: String(value ?? ''),
    disabled: true,
    'aria-label': ariaLabel,
  }, h('option', { value: String(value ?? '') }, String(value || 'Not answered')));
}

function Radio({ checked, label }) {
  return h('label', { className: 'kdp-radio' },
    h('input', { type: 'radio', checked: Boolean(checked), readOnly: true, tabIndex: -1 }),
    h('span', null, label)
  );
}

function Checkbox({ checked, label }) {
  return h('label', { className: 'kdp-checkbox-row' },
    h('input', { type: 'checkbox', checked: Boolean(checked), readOnly: true, tabIndex: -1 }),
    h('span', null, label)
  );
}

function Field({ label, value, ariaLabel }) {
  return h('div', { className: 'kdp-field' },
    h('span', { className: 'kdp-label' }, label),
    h(ReadOnlyInput, { value, ariaLabel: ariaLabel || label })
  );
}

function DetailsBody({ item, submittedSteps }) {
  const key = localKey(item);
  const details = submittedSteps?.details || {};
  const value = getStepValue(submittedSteps, item);

  if (key === 'language') {
    return h(React.Fragment, null,
      h('p', { className: 'kdp-help' }, DETAIL_HELP.language),
      h(ReadOnlySelect, { value: value || 'Not answered', ariaLabel: 'Language' })
    );
  }

  if (key === 'book_title') {
    return h(React.Fragment, null,
      h('p', { className: 'kdp-help' }, DETAIL_HELP.book_title),
      h(Field, { label: 'Book Title', value: value || '', ariaLabel: 'Book Title' }),
      h(Field, { label: 'Subtitle (Optional)', value: details.subtitle || '', ariaLabel: 'Subtitle' })
    );
  }

  if (key === 'series') {
    return h(React.Fragment, null,
      h('p', { className: 'kdp-help' }, DETAIL_HELP.series),
      h('button', { type: 'button', className: 'kdp-btn kdp-btn--secondary', disabled: true }, 'Add to series')
    );
  }

  if (key === 'edition_number') {
    return h(React.Fragment, null,
      h('p', { className: 'kdp-help' }, DETAIL_HELP.edition_number),
      h(Field, { label: 'Edition Number (Optional)', value: value || '', ariaLabel: 'Edition Number' })
    );
  }

  if (key === 'author') {
    const author = details.author || {};
    return h(React.Fragment, null,
      h('p', { className: 'kdp-help' }, DETAIL_HELP.author),
      h('span', { className: 'kdp-label' }, 'Primary Author or Contributor'),
      h('div', { className: 'kdp-author-name-row' },
        h(ReadOnlyInput, { value: author.firstName || '', ariaLabel: 'Author first name' }),
        h(ReadOnlyInput, { value: author.lastName || '', ariaLabel: 'Author last name' })
      )
    );
  }

  if (key === 'contributors') {
    const contributors = Array.isArray(value) ? value : [];
    return h(React.Fragment, null,
      h('p', { className: 'kdp-help' }, DETAIL_HELP.contributors),
      h('div', { className: 'kdp-contrib-list' },
        (contributors.length ? contributors : [{ role: 'Author', firstName: '', lastName: '' }]).map((person, index) =>
          h('div', { className: 'kdp-contrib-row kdp-contrib-row--single', key: index },
            h(ReadOnlySelect, { value: person.role || 'Author', ariaLabel: `Contributor ${index + 1} role` }),
            h(ReadOnlyInput, { value: person.firstName || '', ariaLabel: `Contributor ${index + 1} first name` }),
            h(ReadOnlyInput, { value: person.lastName || '', ariaLabel: `Contributor ${index + 1} last name` })
          )
        )
      ),
      h('button', { type: 'button', className: 'kdp-btn kdp-btn--secondary', disabled: true }, 'Add Another')
    );
  }

  if (key === 'description') {
    const description = value && typeof value === 'object' ? value : { text: String(value || '') };
    const text = description.text || description.html || '';
    const remaining = Number.isFinite(Number(description.remainingCharacters))
      ? Number(description.remainingCharacters)
      : Math.max(0, 4000 - String(text).length);
    return h(React.Fragment, null,
      h('p', { className: 'kdp-help' }, DETAIL_HELP.description),
      h('div', { className: 'kdp-description-editor kdp-admin-description' },
        h('div', { className: 'kdp-editor-toolbar', 'aria-hidden': 'true' },
          h('span', { className: 'kdp-editor-btn kdp-editor-btn--bold' }, 'B'),
          h('span', { className: 'kdp-editor-btn kdp-editor-btn--italic' }, 'I'),
          h('span', { className: 'kdp-editor-btn kdp-editor-btn--underline' }, 'U'),
          h('span', { className: 'kdp-editor-sep' }),
          h('span', { className: 'kdp-editor-btn' }, '☷'),
          h('span', { className: 'kdp-editor-btn' }, '☰'),
          h('span', { className: 'kdp-editor-sep' }),
          h('span', { className: 'kdp-editor-btn' }, '</>')
        ),
        h('div', { className: 'kdp-editor-surface kdp-admin-editor-surface', role: 'textbox', 'aria-readonly': 'true' }, text),
        h('div', { className: 'kdp-desc-count' }, h('span', { className: 'kdp-desc-count__value' }, remaining), ' characters remaining')
      )
    );
  }

  if (key === 'publishing_rights') {
    const rights = details.publishingRights || { value };
    return h('div', { className: 'kdp-radio-stack' },
      h(Radio, { checked: rights.value === 'copyright_owner' || rights.value === 'copyright', label: 'I own the copyright and I hold the necessary publishing rights' }),
      h(Radio, { checked: rights.value === 'public_domain', label: 'This is a public domain work' })
    );
  }

  if (key === 'primary_audience') {
    const audience = details.primaryAudience || {};
    const adult = audience.adult || '';
    const age = audience.age || {};
    return h(React.Fragment, null,
      h('p', { className: 'kdp-help' }, h('strong', null, 'Sexually Explicit Images or Title')),
      h('p', { className: 'kdp-help' }, 'Does the book’s cover or interior contain sexually explicit images, or does the book’s title contain sexually explicit language?'),
      h('div', { className: 'kdp-radio-row' },
        h(Radio, { checked: adult === 'yes', label: 'Yes' }),
        h(Radio, { checked: adult === 'no', label: 'No' })
      ),
      h('div', { className: 'kdp-gap' }),
      h('span', { className: 'kdp-label' }, 'Reading Age (Optional)'),
      h('div', { className: 'kdp-row kdp-row--two' },
        h(Field, { label: 'Minimum', value: age.min || '', ariaLabel: 'Minimum reading age' }),
        h(Field, { label: 'Maximum', value: age.max || '', ariaLabel: 'Maximum reading age' })
      )
    );
  }

  if (key === 'primary_marketplace') {
    return h(React.Fragment, null,
      h('p', { className: 'kdp-help' }, DETAIL_HELP.primary_marketplace),
      h(ReadOnlySelect, { value: value || 'Not answered', ariaLabel: 'Primary marketplace' })
    );
  }

  if (key === 'categories') {
    const categories = value && typeof value === 'object' ? value : {};
    const selections = Array.isArray(categories.selections) ? categories.selections : [];
    return h(React.Fragment, null,
      h('p', { className: 'kdp-help' }, DETAIL_HELP.categories),
      h('strong', { className: 'kdp-subhead' }, 'Your title’s current categories'),
      h('div', { className: 'kdp-cat-area' },
        selections.length
          ? h('ul', { className: 'kdp-cat-list' }, selections.map((row, index) =>
              h('li', { className: 'kdp-cat-item', key: index }, h('span', null, row.displayPath || row.placement || 'Category'))
            ))
          : h('p', { className: 'kdp-help' }, 'No categories selected.'),
        h('button', { type: 'button', className: 'kdp-btn kdp-btn--secondary', disabled: true }, 'Edit Categories')
      )
    );
  }

  if (key === 'keywords') {
    const keywords = value?.keywords || [];
    const padded = Array.from({ length: 7 }, (_, index) => keywords[index] || '');
    return h(React.Fragment, null,
      h('p', { className: 'kdp-help' }, DETAIL_HELP.keywords),
      h('span', { className: 'kdp-label' }, 'Your Keywords (Optional)'),
      h('div', { className: 'kdp-keyword-grid' }, padded.map((keyword, index) =>
        h(ReadOnlyInput, { key: index, value: keyword, ariaLabel: `Keyword ${index + 1}` })
      ))
    );
  }

  if (key === 'preorder') {
    const preorder = value || {};
    const now = preorder.releaseMode !== 'preorder' && preorder.preorderEnabled !== true;
    return h('div', { className: 'kdp-preorder-group' },
      h('div', { className: `kdp-preorder-option${now ? ' is-selected' : ''}` },
        h(Radio, { checked: now, label: 'I am ready to release my book now' })
      ),
      h('div', { className: `kdp-preorder-option kdp-preorder-option--bottom${!now ? ' is-selected' : ''}` },
        h(Radio, { checked: !now, label: 'Make my Kindle eBook available for Pre-order' })
      ),
      !now && preorder.releaseDateGMT
        ? h('div', { className: 'kdp-preorder-extra-content' }, h(Field, { label: 'Release date', value: preorder.releaseDateGMT }))
        : null
    );
  }

  return h('p', { className: 'kdp-help' }, value == null || value === '' ? 'Not answered' : String(value));
}

function ContentBody({ item, submittedSteps, files = [] }) {
  const key = localKey(item);
  const content = submittedSteps?.content || {};
  const value = getStepValue(submittedSteps, item);

  if (key === 'manuscript') {
    const file = files.find((entry) => entry.fileType === 'manuscript');
    return h(React.Fragment, null,
      h('p', { className: 'kdp-help' }, 'Upload and review your manuscript file.'),
      h('div', { className: 'kdp-admin-file-row' },
        h('span', { className: 'kdp-has-file' }, file?.fileName || (value?.uploaded ? 'Manuscript uploaded' : 'No manuscript uploaded'))
      ),
      h('div', { className: 'kdp-gap' }),
      h('span', { className: 'kdp-label' }, 'Digital Rights Management (DRM)'),
      h('div', { className: 'kdp-radio-stack' },
        h(Radio, { checked: value?.drm === 'yes', label: 'Yes, apply DRM' }),
        h(Radio, { checked: value?.drm === 'no', label: 'No, do not apply DRM' })
      )
    );
  }

  if (key === 'cover') {
    const file = files.find((entry) => entry.fileType === 'cover');
    return h(React.Fragment, null,
      h('p', { className: 'kdp-help' }, 'Use a cover you created or uploaded for this Kindle eBook.'),
      h('div', { className: 'kdp-admin-file-row' },
        h('span', { className: 'kdp-has-file' }, file?.fileName || (value?.uploaded ? 'Cover uploaded' : 'No cover uploaded'))
      )
    );
  }

  if (key === 'ai_generated_content') {
    const raw = content.aiGenerated ?? value ?? '';
    const ai = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : { answer: raw };
    const answer = ai.answer || '';
    const labels = {
      none: 'None',
      some_minimal: 'Some sections, with minimal or no editing',
      some_extensive: 'Some sections, with extensive editing',
      entire_minimal: 'Entire work, with minimal or no editing',
      entire_extensive: 'Entire work, with extensive editing',
      few_minimal: 'One or a few AI-generated images, with minimal or no editing',
      few_extensive: 'One or a few AI-generated images, with extensive editing',
      many_minimal: 'Many AI-generated images, with minimal or no editing',
      many_extensive: 'Many AI-generated images, with extensive editing',
    };
    return h(React.Fragment, null,
      h('p', { className: 'kdp-help' }, 'Tell us whether AI-generated content is included in the book.'),
      h('div', { className: 'kdp-radio-row' },
        h(Radio, { checked: answer === 'yes', label: 'Yes' }),
        h(Radio, { checked: answer === 'no', label: 'No' })
      ),
      answer === 'yes'
        ? h('div', { className: 'kdp-ai-detail-grid kdp-ai-detail-grid--readonly' },
            h(Field, { label: 'Texts', value: labels[ai.texts] || 'Not answered' }),
            h(Field, { label: 'Images', value: labels[ai.images] || 'Not answered' }),
            h(Field, { label: 'Translations', value: labels[ai.translations] || 'Not answered' })
          )
        : null
    );
  }

  if (key === 'preview') {
    const manuscript = files.find((entry) => entry.fileType === 'manuscript');
    const cover = files.find((entry) => entry.fileType === 'cover');
    return h(React.Fragment, null,
      h('p', { className: 'kdp-help' }, 'Review the uploaded manuscript and cover before continuing.'),
      h('div', { className: 'kdp-review-actions' },
        manuscript?.viewUrl
          ? h('a', { className: 'kdp-btn kdp-btn--primary', href: manuscript.viewUrl, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Open submitted manuscript in ReviewStudio' }, 'View Manuscript')
          : h('button', { type: 'button', className: 'kdp-btn kdp-btn--primary', disabled: true }, 'Manuscript unavailable'),
        cover?.viewUrl
          ? h('a', { className: 'kdp-btn kdp-btn--primary', href: cover.viewUrl, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Open submitted cover in ReviewStudio' }, 'View Cover')
          : h('button', { type: 'button', className: 'kdp-btn kdp-btn--primary', disabled: true }, 'Cover unavailable')
      ),
      h('div', { className: 'kdp-info-box' }, h('div', { className: 'kdp-info-box__msg' }, 'Uploaded files were captured with this submitted review snapshot.'))
    );
  }

  if (key === 'isbn') {
    const isbn = value || {};
    return h(React.Fragment, null,
      h('p', { className: 'kdp-help' }, 'ISBN is optional for Kindle eBooks.'),
      h(Field, { label: 'ISBN (Optional)', value: isbn.isbn || '' }),
      h(Field, { label: 'Publisher (Optional)', value: isbn.publisher || '' })
    );
  }

  if (key === 'accessibility_features') {
    const accessibility = content.accessibility || value || '';
    return h(React.Fragment, null,
      h('p', { className: 'kdp-help' }, 'Describe the accessibility of images in this eBook.'),
      h('div', { className: 'kdp-radio-stack' },
        h(Radio, { checked: accessibility === 'all', label: 'All images are accessible' }),
        h(Radio, { checked: accessibility === 'some', label: 'Some images are accessible' }),
        h(Radio, { checked: accessibility === 'none', label: 'No images are accessible' })
      )
    );
  }

  return h('p', { className: 'kdp-help' }, value == null || value === '' ? 'Not answered' : String(value));
}

function PricingBody({ item, submittedSteps }) {
  const key = localKey(item);
  const pricing = submittedSteps?.pricing || {};
  const value = getStepValue(submittedSteps, item);

  if (key === 'kdp_select_enrollment') {
    const enrolled = Boolean(pricing.kdpSelect?.enrolled ?? value?.enrolled);
    return h(React.Fragment, null,
      h('p', { className: 'kdp-help' }, h('strong', null, 'Reach more readers. Maximize your sales potential.'), ' (Optional)'),
      h('p', { className: 'kdp-help' }, 'KDP Select is a free, 90-day program offered to Kindle eBooks.'),
      h(Checkbox, { checked: enrolled, label: 'Enroll my book in KDP Select' })
    );
  }

  if (key === 'territories') {
    const territories = value || {};
    const all = territories.territoryMode === 'all_territories' || territories.worldwideRights === true;
    return h(React.Fragment, null,
      h('p', { className: 'kdp-help' }, 'Select the territories where you have rights to sell this book.'),
      h('div', { className: 'kdp-choice-box' },
        h('label', { className: 'kdp-choice-row' }, h(Radio, { checked: all, label: 'All territories (worldwide rights)' })),
        h('div', { className: 'kdp-choice-divider' }),
        h('label', { className: 'kdp-choice-row' }, h(Radio, { checked: !all, label: 'Individual territories' }))
      ),
      !all && Array.isArray(territories.selectedTerritories) && territories.selectedTerritories.length
        ? h('p', { className: 'kdp-territory-summary' }, territories.selectedTerritories.join(', '))
        : null
    );
  }

  if (key === 'primary_marketplace') {
    const marketplace = value?.value || value || pricing.primaryMarketplace || '';
    return h(React.Fragment, null,
      h('p', { className: 'kdp-help' }, 'Pricing below is based on the primary marketplace selected on the Details tab.'),
      h(ReadOnlySelect, { value: marketplace || 'Not answered', ariaLabel: 'Primary marketplace from Details' })
    );
  }

  if (key === 'royalty_distribution') {
    const royalty = pricing.royalty || value || {};
    const marketplaces = Array.isArray(royalty.marketplaces) ? royalty.marketplaces : [];
    return h(React.Fragment, null,
      h('p', { className: 'kdp-help' }, h('strong', null, 'Select a royalty plan and set your Kindle eBook list prices below.')),
      h('div', { className: 'kdp-royalty-options' },
        h(Radio, { checked: String(royalty.royaltyPlan) === '35', label: '35% royalty' }),
        h(Radio, { checked: String(royalty.royaltyPlan) === '70', label: '70% royalty' })
      ),
      h('div', { className: 'kdp-price-table kdp-admin-price-table', role: 'table', 'aria-label': 'Submitted marketplace pricing' },
        h('div', { className: 'kdp-price-head', role: 'row' },
          ['Marketplace', 'List price', 'Delivery', 'Rate', 'Estimated royalty'].map((label) => h('div', { role: 'columnheader', key: label }, label))
        ),
        marketplaces.map((market, index) =>
          h('div', { className: `kdp-price-row${market.id === royalty.primaryMarketplace ? ' is-primary' : ''}${index % 2 ? ' is-alt' : ''}`, role: 'row', key: market.id || index },
            h('div', { className: 'kdp-price-market', role: 'cell', 'data-label': 'Marketplace' }, h('strong', null, market.marketplace || market.id || 'Marketplace')),
            h('div', { role: 'cell', 'data-label': 'List price' }, `${market.listPrice ?? '—'} ${market.currency || ''}`),
            h('div', { role: 'cell', 'data-label': 'Delivery' }, market.delivery == null ? '—' : String(market.delivery)),
            h('div', { role: 'cell', 'data-label': 'Rate' }, market.rate == null ? '—' : String(market.rate)),
            h('div', { role: 'cell', 'data-label': 'Estimated royalty' }, market.royalty == null ? '—' : `${market.royalty} ${market.currency || ''}`)
          )
        )
      ),
      royalty.fxSource ? h('p', { className: 'kdp-help kdp-fx-status' }, `Converted prices are estimates using ${royalty.fxSource}${royalty.fxAsOf ? ` dated ${royalty.fxAsOf}` : ''}.`) : null
    );
  }

  return h('p', { className: 'kdp-help' }, value == null || value === '' ? 'Not answered' : String(value));
}

export function SubmittedSectionBody({ item, submittedSteps, files }) {
  if (item?.step === 'details') return h(DetailsBody, { item, submittedSteps });
  if (item?.step === 'content') return h(ContentBody, { item, submittedSteps, files });
  if (item?.step === 'pricing') return h(PricingBody, { item, submittedSteps });
  return h('p', { className: 'kdp-help' }, 'Submitted value unavailable.');
}

export function PricingTermsReadOnly() {
  return h('section', { className: 'kdp-section kdp-admin-review-terms' },
    h('div', { className: 'kdp-section-label' }, h('span', null, 'Terms & Conditions')),
    h('div', { className: 'kdp-section-content' },
      h('p', { className: 'kdp-help' }, 'It can take up to 72 hours for a title to be available for purchase on Amazon.'),
      h('p', { className: 'kdp-help kdp-terms-confirmation' }, 'The employee submitted this intake under the KDP Terms and Conditions acknowledgement.')
    )
  );
}
