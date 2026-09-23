#!/usr/bin/env node
/**
 * Render the PXIL probe report from a capture taken on the whitelisted server.
 *
 *   node backend/scripts/pxilAnalyse.js pxil-capture-2026-09-23T...json
 *
 * The capture comes from tools/pxil-probe/pxil-probe.mjs, which is the only
 * thing that can talk to PXIL — their APIs answer one whitelisted public IP and
 * 403 everyone else. This script needs no network and no credentials: it replays
 * the recorded bodies through the same renderer a live run uses, so the
 * analysis can be corrected and re-run here as often as needed without booking
 * another session on the server.
 *
 * Read-only. Nothing is written, nothing is persisted.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderProbeReport } from '../src/services/pxilProbeReport.js';

const [, , file] = process.argv;
if (!file) {
  console.error('Usage: node backend/scripts/pxilAnalyse.js <capture.json>');
  console.error('');
  console.error('The capture is produced on the whitelisted server by:');
  console.error('  node tools/pxil-probe/pxil-probe.mjs [fromdate] [todate]');
  process.exit(1);
}

let capture;
try {
  capture = JSON.parse(readFileSync(resolve(file), 'utf8'));
} catch (err) {
  console.error(`Could not read ${file}: ${err.message}`);
  process.exit(1);
}

if (capture.tool !== 'pxil-probe' || !capture.attempts) {
  console.error(`${file} is not a pxil-probe capture (expected tool "pxil-probe" and an "attempts" object).`);
  process.exit(1);
}

renderProbeReport({ meta: capture.meta || {}, attempts: capture.attempts });
