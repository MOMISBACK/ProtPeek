// SPDX-License-Identifier: MPL-2.0
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT_DIR = resolve(import.meta.dirname, '..');
const PACKAGE_VERSION = JSON.parse(
  readFileSync(resolve(ROOT_DIR, 'package.json'), 'utf8'),
).version;
const STRICT_CSP =
  "script-src 'self'; object-src 'self'; connect-src https://models.rcsb.org https://files.rcsb.org https://alphafold.ebi.ac.uk;";
const ARTICLE_HOST_PERMISSIONS = ['http://*/*', 'https://*/*'];
const ICONS = {
  16: 'icon-16.png',
  32: 'icon-32.png',
  48: 'icon-48.png',
  96: 'icon-96.png',
  128: 'icon-128.png',
};

const TARGETS = [
  {
    name: 'Chrome',
    manifestPath: '.output/chrome-mv3/manifest.json',
    permissions: [
      'contextMenus',
      'scripting',
      'sidePanel',
      'storage',
    ],
    panelKey: 'side_panel',
    panel: { default_path: 'sidepanel.html' },
    forbiddenPanelKey: 'sidebar_action',
  },
  {
    name: 'Firefox',
    manifestPath: '.output/firefox-mv3/manifest.json',
    permissions: ['contextMenus', 'scripting', 'storage'],
    panelKey: 'sidebar_action',
    panel: {
      default_panel: 'sidepanel.html',
      default_title: 'ProtPeek',
      open_at_install: false,
    },
    forbiddenPanelKey: 'side_panel',
  },
];

const issues = [];

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function checkEqual(target, label, actual, expected) {
  if (stableJson(actual) !== stableJson(expected)) {
    issues.push(
      `${target}: ${label} must be ${stableJson(expected)}, received ${stableJson(actual)}`,
    );
  }
}

function checkExactStringSet(target, label, actual, expected) {
  if (!Array.isArray(actual) || actual.some((value) => typeof value !== 'string')) {
    issues.push(`${target}: ${label} must be an array of strings`);
    return;
  }

  checkEqual(target, label, [...actual].sort(), [...expected].sort());
}

function findString(value, expected, path = 'manifest') {
  if (value === expected) return path;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const match = findString(item, expected, `${path}[${index}]`);
      if (match !== null) return match;
    }
  } else if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value).sort()) {
      const match = findString(value[key], expected, `${path}.${key}`);
      if (match !== null) return match;
    }
  }
  return null;
}

function readManifest(target) {
  const absolutePath = resolve(ROOT_DIR, target.manifestPath);
  try {
    const manifest = JSON.parse(readFileSync(absolutePath, 'utf8'));
    if (
      typeof manifest !== 'object' ||
      manifest === null ||
      Array.isArray(manifest)
    ) {
      issues.push(`${target.name}: ${target.manifestPath} must contain an object`);
      return null;
    }
    return manifest;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    issues.push(`${target.name}: cannot read ${target.manifestPath}: ${reason}`);
    return null;
  }
}

for (const target of TARGETS) {
  const manifest = readManifest(target);
  if (manifest === null) continue;

  checkEqual(target.name, 'manifest_version', manifest.manifest_version, 3);
  checkEqual(target.name, 'version', manifest.version, PACKAGE_VERSION);
  checkExactStringSet(
    target.name,
    'permissions',
    manifest.permissions,
    target.permissions,
  );
  checkExactStringSet(
    target.name,
    'host_permissions',
    manifest.host_permissions,
    ARTICLE_HOST_PERMISSIONS,
  );
  checkEqual(
    target.name,
    'content_security_policy',
    manifest.content_security_policy,
    { extension_pages: STRICT_CSP },
  );
  checkEqual(target.name, 'icons', manifest.icons, ICONS);
  checkEqual(target.name, 'action', manifest.action, {
    default_icon: ICONS,
    default_title: 'Open ProtPeek',
  });
  checkEqual(target.name, target.panelKey, manifest[target.panelKey], target.panel);

  if (target.name === 'Chrome') {
    checkEqual(
      target.name,
      'minimum_chrome_version',
      manifest.minimum_chrome_version,
      '116',
    );
    checkEqual(target.name, 'background', manifest.background, {
      service_worker: 'background.js',
    });
  } else {
    checkEqual(target.name, 'background', manifest.background, {
      scripts: ['background.js'],
    });
    checkEqual(
      target.name,
      'browser_specific_settings.gecko',
      manifest.browser_specific_settings?.gecko,
      {
        data_collection_permissions: { required: ['searchTerms'] },
        id: 'protpeek@momisback.github.io',
        strict_min_version: '140.0',
      },
    );
  }

  if (Object.hasOwn(manifest, target.forbiddenPanelKey)) {
    issues.push(`${target.name}: unexpected ${target.forbiddenPanelKey} entry`);
  }
  if (Object.hasOwn(manifest, 'optional_permissions')) {
    issues.push(`${target.name}: optional_permissions must be absent`);
  }
  if (Object.hasOwn(manifest, 'optional_host_permissions')) {
    issues.push(`${target.name}: optional_host_permissions must be absent`);
  }

  const allUrlsPath = findString(manifest, '<all_urls>');
  if (allUrlsPath !== null) {
    issues.push(`${target.name}: forbidden <all_urls> found at ${allUrlsPath}`);
  }
}

if (issues.length > 0) {
  process.stderr.write(
    `Build verification failed:\n${issues.map((issue) => `- ${issue}`).join('\n')}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write('Verified Chrome and Firefox MV3 manifests.\n');
}
