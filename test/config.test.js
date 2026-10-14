import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, MAX_STOPS, normalizeConfig, parseStops } from '../src/config.js';
import { LANGUAGES, MESSAGES, effectKey, pickTranslation, t, tAll } from '../src/i18n.js';

test('normalizeConfig returns the defaults when called with no argument', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
});

test('normalizeConfig coerces and bounds the numbers coming from a form', () => {
  const config = normalizeConfig({
    refresh_interval: '120',
    horizon_minutes: '9999',
    delay_threshold: 'x',
  });
  assert.equal(config.refresh_interval, 120);
  assert.equal(config.horizon_minutes, 240, 'capped');
  assert.equal(config.delay_threshold, DEFAULT_CONFIG.delay_threshold, 'not a number');
  assert.equal(normalizeConfig({ refresh_interval: 5 }).refresh_interval, 30, 'floor');
});

test('normalizeConfig trims the key and falls back to a known language', () => {
  assert.equal(normalizeConfig({ api_key: '  abc ' }).api_key, 'abc');
  assert.equal(normalizeConfig({ language: 'nl' }).language, 'fr');
  assert.equal(normalizeConfig({ language: 'de' }).language, 'de');
});

test('parseStops reads stops and optional line filters', () => {
  const { entries, invalid } = parseStops(
    'Cchcen07, CMpa1:M2+m4 ;\nCtrrpla2: 61 82 , bad!stop, X:??',
  );
  assert.deepEqual(entries, [
    { stopId: 'Cchcen07', lines: [], key: 'Cchcen07' },
    { stopId: 'CMpa1', lines: ['M2', 'M4'], key: 'CMpa1__M2-M4' },
    { stopId: 'Ctrrpla2', lines: ['61', '82'], key: 'Ctrrpla2__61-82' },
  ]);
  assert.deepEqual(invalid, ['bad!stop', 'X:??']);
});

test('the device key of an entry does not depend on how the lines are written', () => {
  const [a] = parseStops('CMpa1:M4+M2').entries;
  const [b] = parseStops('CMpa1: m2 | M4 | M2').entries;
  assert.equal(a.key, b.key);
});

test('parseStops drops duplicates and caps the list', () => {
  assert.equal(parseStops('S1, S1, S1').entries.length, 1);
  const many = Array.from({ length: 30 }, (_, i) => `S${i + 10}`).join(',');
  assert.equal(parseStops(many).entries.length, MAX_STOPS);
  assert.deepEqual(parseStops(undefined), { entries: [], invalid: [] });
});

test('every text exists in English, French, German and Spanish', () => {
  assert.deepEqual(Object.keys(MESSAGES).sort(), [...LANGUAGES].sort());
  const keys = Object.keys(MESSAGES.en);
  for (const lang of LANGUAGES) {
    assert.deepEqual(Object.keys(MESSAGES[lang]).sort(), [...keys].sort(), lang);
    for (const key of keys) {
      const rendered = t(lang, key, { n: 2, list: 'x', message: 'm', query: 'q', version: 'v' });
      assert.ok(rendered.length > 0, `${lang}.${key}`);
    }
  }
});

test('texts render their variables and plurals', () => {
  assert.equal(t('fr', 'disruptions_count', { n: 1 }), '1 perturbation');
  assert.equal(t('fr', 'disruptions_count', { n: 3 }), '3 perturbations');
  assert.equal(t('xx', 'now'), 'now', 'unknown language: English');
  assert.deepEqual(Object.keys(tAll('now')), LANGUAGES);
  assert.throws(() => t('en', 'missing_key'), /Missing translation key/);
});

test('alert effects and translations fall back sensibly', () => {
  assert.equal(effectKey(4), 'effect_4');
  assert.equal(effectKey(42), 'effect_other');
  assert.equal(pickTranslation({ fr: 'Travaux', de: 'Bauarbeiten' }, 'de'), 'Bauarbeiten');
  assert.equal(pickTranslation({ fr: 'Travaux' }, 'es'), 'Travaux');
  assert.equal(pickTranslation({ nl: 'Werken' }, 'es'), 'Werken');
  assert.equal(pickTranslation(undefined, 'en'), '');
});
