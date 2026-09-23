import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

async function freePort() {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return address.port;
}

for (const scenario of [
  {
    name: 'disabled module',
    env: { OLIVE_ENABLED: 'false' },
    status: 'disabled',
  },
  { name: 'missing Python executable', env: {}, status: 'unavailable' },
  {
    name: 'missing admin configuration',
    env: { OLIVE_ADMIN_PASSWORD: '' },
    status: 'unavailable',
  },
  {
    name: 'invalid project configuration',
    env: { OLIVE_ENABLED: 'not-a-boolean' },
    status: 'unavailable',
  },
]) {
  test(
    `Node serves the platform independently: ${scenario.name}`,
    { timeout: 45_000 },
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'platform-node-only-'));
      const database = join(directory, 'untouched.sqlite');
      const sentinel = 'This file must never be opened as a database.';
      await writeFile(database, sentinel);
      const port = await freePort();
      let output = '';
      const child = spawn(
        process.execPath,
        ['scripts/server.ts', '--production'],
        {
          cwd: root,
          env: {
            ...process.env,
            HOST: '127.0.0.1',
            PORT: String(port),
            OLIVE_ENABLED: 'true',
            OLIVE_LEGACY_ORIGIN: '',
            OLIVE_ADMIN_PASSWORD: 'runtime-secret-not-for-logs',
            OLIVE_PYTHON: join(directory, 'python-does-not-exist'),
            OLIVE_DATABASE_PATH: database,
            OLIVE_PINS_PATH: join(directory, 'missing-pins'),
            PLATFORM_PARENT_PIPE: '1',
            ...scenario.env,
          },
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      const exit = once(child, 'exit');
      child.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });
      child.stderr.on('data', (data: Buffer) => {
        output += data.toString();
      });
      const origin = `http://127.0.0.1:${port}`;
      try {
        let ready = false;
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline && !ready) {
          assert.equal(child.exitCode, null, output);
          let response: Response | undefined;
          try {
            response = await fetch(`${origin}/api/health`, {
              signal: AbortSignal.timeout(1000),
            });
          } catch {
            /* Wait for the server to bind. */
          }
          if (response?.ok) {
            assert.deepEqual(await response.json(), { status: 'ok' });
            ready = true;
          } else await response?.body?.cancel();
          if (!ready) await delay(100);
        }
        assert.ok(ready, output);
        const homepage = await fetch(origin);
        assert.equal(homepage.status, 200);
        assert.match(await homepage.text(), /Gemeinsam fragen\./);
        const projectHealth = await fetch(
          `${origin}/api/health/projects/olive-symposium`,
        );
        assert.equal(projectHealth.status, 503);
        assert.equal(projectHealth.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await projectHealth.json(), {
          status: scenario.status,
        });
        const legacy = await fetch(`${origin}/projects/olive-symposium`);
        assert.equal(legacy.status, 503);
        assert.deepEqual(await legacy.json(), {
          ok: false,
          error:
            'Das Projekt ist vorübergehend nicht erreichbar. Bitte erneut versuchen.',
        });
        assert.equal(await readFile(database, 'utf8'), sentinel);
        assert.ok(!output.includes('runtime-secret-not-for-logs'));
        assert.ok(!output.includes(database));
        // Same EOF as a hard-killed Python compatibility launcher, without Python installed.
        child.stdin.end();
        await Promise.race([
          exit,
          delay(12_000, undefined, { ref: false }).then(() => {
            throw new Error('Node did not shut down');
          }),
        ]);
        assert.equal(child.exitCode, 0, output);
        await assert.rejects(
          fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) }),
        );
      } finally {
        if (child.exitCode === null) {
          child.kill('SIGKILL');
          await exit;
        }
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
}
