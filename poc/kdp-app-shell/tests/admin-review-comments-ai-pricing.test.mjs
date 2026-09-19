import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const adminPage = readFileSync(new URL('../src/adminReview/AdminReviewPage.jsx', import.meta.url), 'utf8');
const adminSubmitted = readFileSync(new URL('../src/adminReview/AdminSubmittedStep.jsx', import.meta.url), 'utf8');
const contentPage = readFileSync(new URL('../src/content/ContentPage.jsx', import.meta.url), 'utf8');
const pricingPage = readFileSync(new URL('../src/pricing/PricingPage.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/app.css', import.meta.url), 'utf8');

test('comment collapse keeps headers visible and uses icon actions', () => {
  assert.match(adminPage, /commentsCollapsed/);
  assert.match(adminPage, /const expanded = !commentsCollapsed \|\| collapsedExpandedId === comment\.id/);
  assert.doesNotMatch(adminPage, /collapsed \? null : tab === 'comments'/);
  for (const label of ['Reply to comment', 'Edit comment', 'Resolve comment', 'Delete comment']) {
    assert.ok(adminPage.includes(label), `missing accessible icon action: ${label}`);
  }
  assert.match(css, /kdp-review-comment\.is-expanded[\s\S]*0797c9/i);
  assert.match(css, /kdp-review-comment__index[\s\S]*#c8cccc/i);
});

test('Admin Review file controls open exact submitted ReviewStudio URLs', () => {
  assert.match(adminSubmitted, /manuscript\?\.viewUrl/);
  assert.match(adminSubmitted, /cover\?\.viewUrl/);
  assert.match(adminSubmitted, /target: '_blank'/);
  assert.match(adminSubmitted, /noopener noreferrer/);
});

test('employee AI disclosure uses Select defaults and the exact all-None validation message', () => {
  assert.match(contentPage, /h\('option', \{ value: '' \}, 'Select'\)/);
  assert.match(contentPage, /Texts/);
  assert.match(contentPage, /Images/);
  assert.match(contentPage, /Translations/);
  assert.match(contentPage, /Some sections, with minimal or no editing/);
  assert.match(contentPage, /Many AI-generated images, with extensive editing/);
  assert.match(contentPage, /Specify what type of content was AI generated\. If none, select “No”\./);
});

test('pricing UI derives KDP file size from the authoritative manuscript and labels tax uncertainty', () => {
  assert.match(pricingPage, /kdpFileSizeMB\(manuscript\?\.file_size\)/);
  assert.match(pricingPage, /effectiveRoyaltyPlan/);
  assert.match(pricingPage, /Applicable VAT\/tax is customer-jurisdiction dependent and is not guessed here/);
});
