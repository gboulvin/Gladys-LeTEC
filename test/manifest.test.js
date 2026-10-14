// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { ACTIONS } from '../src/actions.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { WIDGETS } from '../src/widgets.js';
import { TRIGGERS, SOON_MARKS } from '../src/triggers.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { LANGUAGES } from '../src/i18n.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

/** Every multi-language object of the manifest, with its path. */
function multiLanguageTexts(node, path = '') {
  if (Array.isArray(node)) {
    return node.flatMap((item, index) => multiLanguageTexts(item, `${path}[${index}]`));
  }
  if (node === null || typeof node !== 'object') {
    return [];
  }
  return Object.entries(node).flatMap(([key, value]) =>
    ['label', 'description', 'placeholder'].includes(key) && value && typeof value === 'object'
      ? [[`${path}.${key}`, value]]
      : multiLanguageTexts(value, `${path}.${key}`),
  );
}

test('every manifest text exists in English, French, German and Spanish', () => {
  const texts = multiLanguageTexts(manifest);
  assert.ok(texts.length > 50);
  for (const [path, text] of texts) {
    assert.deepEqual(Object.keys(text).sort(), [...LANGUAGES].sort(), path);
    for (const lang of LANGUAGES) {
      assert.ok(text[lang].trim().length > 0, `${path}.${lang}`);
    }
  }
});

test('the integration is a cloud one: no local connection to prefer', () => {
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.equal(DEFAULT_CONFIG.GLADYS_PREFER_LOCAL, undefined);
});

test('every manifest action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), Object.keys(ACTIONS).sort());
});

test('every scene_actions key has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
});

test('every widgets key has a content handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets).sort(), Object.keys(WIDGETS).sort());
  for (const widget of manifest.widgets) {
    for (const lang of LANGUAGES) {
      const length = widget.label[lang].length;
      assert.ok(length >= 3 && length <= 30, `${widget.key} label.${lang}: 3-30 characters`);
      assert.ok(widget.description[lang].length <= 100, `${widget.key} description.${lang}`);
    }
  }
});

test('every scene trigger fired by the code is declared, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(TRIGGERS).sort());
});

test('the departure_soon marks are the options of its minutes filter', () => {
  const trigger = manifest.scene_triggers.find((entry) => entry.key === TRIGGERS.DEPARTURE_SOON);
  const options = trigger.fields.find((field) => field.key === 'minutes').options;
  assert.deepEqual(
    options.map((option) => option.value),
    SOON_MARKS.map(String),
  );
});

test('capability fields and categories require Gladys >= 5.1.0', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.ok(isAtLeast(minGladysVersion(), [5, 1, 0]), manifest.gladys_version);
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.type === 'section') {
      assert.ok(!(field.key in DEFAULT_CONFIG), `section ${field.key} stores no value`);
      for (const link of field.links ?? []) {
        assert.match(link.url, /^https:\/\//);
      }
      continue;
    }
    assert.ok(field.key in DEFAULT_CONFIG, `${field.key} has a default in the code`);
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, field.key);
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  const dynamic = allFields.filter((field) => field.source !== undefined);
  assert.ok(dynamic.length > 0);
  for (const field of dynamic) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined, field.key);
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`), manifest.docker_image);
  assert.match(manifest.docker_image, /^ghcr\.io\/gboulvin\/letec:/);
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});

test('the user documentation exists in the four languages', async () => {
  for (const lang of LANGUAGES) {
    const { size } = await stat(new URL(`../docs/${lang}.md`, import.meta.url));
    assert.ok(size >= 300, `docs/${lang}.md holds at least 300 characters`);
  }
});
