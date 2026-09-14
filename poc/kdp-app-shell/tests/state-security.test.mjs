import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authoritativeContentState,
  serializeContentExtractedFields,
  serializeOptionalChoice,
  serializePublishingRights,
} from '../src/state/employeeState.js';

const staleState = {
  manuscriptHasFile: true,
  coverHasFile: true,
  aiChoice: '',
};

test('stale manuscript removed by reconciliation is not authoritative', () => {
  const state = authoritativeContentState(staleState, [
    { file_type: 'cover', section_key: 'content.cover' },
  ]);
  assert.equal(state.manuscriptHasFile, false);
  assert.equal(state.coverHasFile, true);
});

test('stale cover removed by reconciliation is not authoritative', () => {
  const state = authoritativeContentState(staleState, [
    { file_type: 'manuscript', section_key: 'content.manuscript' },
  ]);
  assert.equal(state.manuscriptHasFile, true);
  assert.equal(state.coverHasFile, false);
});

test('empty reconciled file set clears both stale upload booleans', () => {
  const state = authoritativeContentState(staleState, []);
  assert.equal(state.manuscriptHasFile, false);
  assert.equal(state.coverHasFile, false);
});

test('fresh verified files remain valid', () => {
  const state = authoritativeContentState({}, [
    { file_type: 'manuscript', section_key: 'content.manuscript' },
    { file_type: 'cover', section_key: 'content.cover' },
  ]);
  assert.equal(state.manuscriptHasFile, true);
  assert.equal(state.coverHasFile, true);
});

test('draft AI and adult choices preserve unanswered', () => {
  assert.equal(serializeOptionalChoice('', ['yes', 'no']), '');
  assert.equal(serializeOptionalChoice(undefined, ['yes', 'no']), '');
});

test('answered optional choices round-trip unchanged', () => {
  assert.equal(serializeOptionalChoice('yes', ['yes', 'no']), 'yes');
  assert.equal(serializeOptionalChoice('no', ['yes', 'no']), 'no');
});

test('publishing rights preserves unanswered and maps known answers only', () => {
  assert.equal(serializePublishingRights(''), '');
  assert.equal(serializePublishingRights('copyright'), 'copyright_owner');
  assert.equal(serializePublishingRights('public_domain'), 'public_domain');
});

test('Content draft extracted fields preserve unanswered choices as null', () => {
  assert.deepEqual(serializeContentExtractedFields({
    drmChoice: '',
    coverOption: '',
    accessibleImages: '',
  }), {
    drm: null,
    cover_option: null,
    accessibility: null,
  });
});

test('complete Content extracted fields use the deployed validation vocabulary', () => {
  assert.deepEqual(serializeContentExtractedFields({
    drmChoice: 'yes',
    coverOption: 'upload',
    accessibleImages: 'all',
  }), {
    drm: 'yes_apply_drm',
    cover_option: 'upload_cover_file',
    accessibility: 'all',
  });

  assert.deepEqual(serializeContentExtractedFields({
    drmChoice: 'no',
    coverOption: 'cover_creator',
    accessibleImages: 'dont_know',
  }), {
    drm: 'no_do_not_apply_drm',
    cover_option: 'cover_creator',
    accessibility: 'dont_know',
  });
});
