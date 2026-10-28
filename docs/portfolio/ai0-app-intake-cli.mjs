#!/usr/bin/env node
/**
 * AI-0 local, read-only product planning CLI, never a release/Store CLI.
 * Usage: node docs/portfolio/ai0-app-intake-cli.mjs --input <file>
 * Optional: --registry <file> (human verification remains required).
 * Supplying a registry does not imply it is verified. The CLI cannot mark it verified.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewStarryAppIntake } from './ai0-app-intake-evidence-gate.mjs';

const rootUrl = new URL('./', import.meta.url);
const parse = (p) => JSON.parse(readFileSync(p, 'utf8'));
const local = (file) => parse(fileURLToPath(new URL(file, rootUrl)));
const args = process.argv.slice(2);
function opt(name) {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1] ?? null;
}
if (args.length < 2 || args.some((v, i) =>
  (i % 2 === 0 && !['--input','--registry'].includes(v)) ||
  (i % 2 === 1 && v.startsWith('--'))) ||
  !opt('--input') || args.length % 2 !== 0) {
  console.error('Usage: node docs/portfolio/ai0-app-intake-cli.mjs --input <local-json-file> [--registry <local-json-file>]');
  process.exitCode = 2;
} else {
  try {
    const intake = parse(resolve(opt('--input')));
    const rawRegistry = opt('--registry') ? parse(resolve(opt('--registry'))) : null;
    const existingApps = Array.isArray(rawRegistry?.existing_apps) ? rawRegistry.existing_apps : null;
    const result = reviewStarryAppIntake({
      intake,
      scorecard: local('starry-app-portfolio-candidates.v0.json'),
      portfolio: local('starry-app-p0-governance.v0.json'),
      existingApps,
      // Registry file is a self-reported source. Only independent human review
      // can establish completeness, so always false here; avoid false confidence.
      registryVerified: false
    });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    // Exit 0 means the read-only review executed, NEVER authorization to develop/release.
    // The checker intentionally cannot return actionable external permissions.
  } catch {
    console.error('INVALID_LOCAL_JSON_OR_UNREADABLE_INPUT; no App review conducted');
    process.exitCode = 2;
  }
}
