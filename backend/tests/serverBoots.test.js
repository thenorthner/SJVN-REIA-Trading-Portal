import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Does the thing actually start?
//
// Every other test imports the app through vitest, which transforms each module
// on the way in. Plain node does not, and the difference is not academic: three
// route files shipped with the same import line twice, which node rejects
// outright — "Identifier 'clientScope' has already been declared" — while the
// whole suite stayed green. The branch could not boot and 1268 passing tests said
// nothing about it, and `update.sh` runs those tests to decide whether a release
// is safe.
//
// So this test starts a real node process and asks it to load the server the way
// production loads it. It is not the entry point there, so nothing listens on a
// port or schedules a cron job; every module is still parsed and evaluated, which
// is where syntax and module-level errors surface.

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('the server as node loads it', () => {
  it('parses and evaluates every module under plain node', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sjvn-boot-'));
    let out = '';
    try {
      out = execFileSync(
        process.execPath,
        ['--input-type=module', '-e', "await import('./src/server.js'); console.log('LOADED');"],
        {
          cwd: backendRoot,
          encoding: 'utf8',
          timeout: 60000,
          env: {
            ...process.env,
            // Its own throwaway database, so loading the app cannot touch a real one.
            SJVN_DB_PATH: join(dir, 'boot.db'),
            JWT_SECRET: 'test-secret',
            SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '',
            // Node inherits VITEST from this process otherwise, and src/db/index.js
            // reads it to decide whether a test is opening the real database.
            VITEST: '',
          },
        },
      );
    } catch (err) {
      // stderr carries the SyntaxError with the file and line, which is the whole
      // point of this test — put it in the failure rather than an exit code.
      const detail = [err.stdout, err.stderr].filter(Boolean).join('\n').trim();
      throw new Error(`The server does not load under plain node:\n${detail || err.message}`);
    }
    expect(out).toMatch(/LOADED/);
  }, 70000);
});
