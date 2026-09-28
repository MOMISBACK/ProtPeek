// SPDX-License-Identifier: MPL-2.0
import { defineConfig } from 'wxt';

const STRUCTURE_ORIGINS = [
  'https://models.rcsb.org',
  'https://files.rcsb.org',
  'https://alphafold.ebi.ac.uk',
];

const ARTICLE_HOSTS = ['http://*/*', 'https://*/*'];

const ICONS = {
  16: 'icon-16.png',
  32: 'icon-32.png',
  48: 'icon-48.png',
  96: 'icon-96.png',
  128: 'icon-128.png',
};

export default defineConfig({
  srcDir: 'src',
  manifestVersion: 3,
  targetBrowsers: ['chrome', 'firefox'],
  zip: {
    dotSources: true,
    excludeSources: [
      '.git/**',
      '.wxt/**',
      '.DS_Store',
      'coverage/**',
      'release/*.zip',
    ],
  },
  manifest: ({ browser }) => ({
    name: 'ProtPeek',
    description: 'Peek at protein structures without leaving the article you are reading.',
    homepage_url: 'https://github.com/MOMISBACK/ProtPeek',
    action: {
      default_icon: ICONS,
      default_title: 'Open ProtPeek',
    },
    icons: ICONS,
    permissions: ['scripting', 'contextMenus', 'storage'],
    host_permissions: ARTICLE_HOSTS,
    content_security_policy: {
      extension_pages: `script-src 'self'; object-src 'self'; connect-src ${STRUCTURE_ORIGINS.join(' ')};`,
    },
    ...(browser === 'chrome'
      ? { minimum_chrome_version: '116' }
      : {}),
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              data_collection_permissions: {
                required: ['searchTerms'],
              },
              id: 'protpeek@momisback.github.io',
              strict_min_version: '140.0',
            },
          },
        }
      : {}),
  }),
});
