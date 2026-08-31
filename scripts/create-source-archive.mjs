// SPDX-License-Identifier: MPL-2.0
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT_DIR = resolve(import.meta.dirname, '..');
const OUTPUT_DIR = resolve(ROOT_DIR, '.output');
const packageJson = JSON.parse(
  readFileSync(resolve(ROOT_DIR, 'package.json'), 'utf8'),
);

if (typeof packageJson.name !== 'string' || packageJson.name.length === 0) {
  throw new Error('package.json must contain a non-empty name');
}

if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
  throw new Error('package.json must contain a non-empty version');
}

const runGit = (args) => {
  const result = spawnSync('git', args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new Error(`git ${args[0]} failed${detail ? `: ${detail}` : ''}`);
  }

  return result.stdout;
};

const status = runGit(['status', '--porcelain=v1', '--untracked-files=all']);
if (status.trim().length > 0) {
  throw new Error(
    'Refusing to create a source release from a dirty working tree. Commit the exact release sources first.',
  );
}

mkdirSync(OUTPUT_DIR, { recursive: true });

const archivePath = resolve(
  OUTPUT_DIR,
  `${packageJson.name}-${packageJson.version}-sources.zip`,
);
runGit(['archive', '--format=zip', `--output=${archivePath}`, 'HEAD']);

const size = statSync(archivePath).size;
if (size === 0) {
  throw new Error(`Source archive is empty: ${archivePath}`);
}

process.stdout.write(
  `Created ${packageJson.name}-${packageJson.version}-sources.zip from the clean HEAD commit (${size} bytes)\n`,
);
