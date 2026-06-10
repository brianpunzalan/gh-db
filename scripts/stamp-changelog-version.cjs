#!/usr/bin/env node
'use strict';

/**
 * Replaces the "[Unreleased]" placeholder in the root CHANGELOG.md with the
 * actual version produced by `changeset version`.
 *
 * Single-package adaptation: the version is read from the repository-root
 * package.json.
 */

const fs = require('fs');

function findPackageVersion() {
  const pkgJsonPath = 'package.json';
  if (!fs.existsSync(pkgJsonPath)) return null;

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    if (!pkg.private && pkg.version) return pkg.version;
  } catch {
    // fall through
  }

  return null;
}

const version = findPackageVersion();
if (!version) {
  console.log('No package version found — CHANGELOG.md left unchanged');
  process.exit(0);
}

const changelogPath = 'CHANGELOG.md';
if (!fs.existsSync(changelogPath)) {
  console.log('CHANGELOG.md not found — nothing to stamp');
  process.exit(0);
}

const content = fs.readFileSync(changelogPath, 'utf8');
const stamped = content.replace(/\[Unreleased\]/g, `[${version}]`);
fs.writeFileSync(changelogPath, stamped);

console.log(`CHANGELOG.md stamped with version ${version}`);
