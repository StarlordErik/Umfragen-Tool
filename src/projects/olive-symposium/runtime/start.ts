import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import { oliveConfig, OliveConfigurationError } from './config.ts';

const readyMessage = z.object({
  event: z.literal('ready'),
  port: z.number().int().min(1).max(65535),
  pid: z.number().int().positive(),
});
const failureMessages: Record<string, string> = {
  'database-missing':
    'Datenbank fehlt. OLIVE_DATABASE_PATH prüfen; es wurde keine Datei angelegt.',
  'startup-failed':
    'Legacy-Initialisierung fehlgeschlagen. Konfiguration und Datenbank prüfen.',
};

/** Starts only this optional project. No legacy failure may stop the platform. */
export function startOliveRuntime(
  root: string,
  env: NodeJS.ProcessEnv,
  onOrigin: (origin: string | undefined) => void,
) {
  let child: ChildProcessWithoutNullStreams | undefined;
  let timeout: NodeJS.Timeout | undefined;
  let stopping = false;
  let failed = false;
  let closed = false;
  const clearOrigin = () => onOrigin(undefined);
  const fail = (message: string) => {
    clearOrigin();
    if (!failed && !stopping) {
      failed = true;
      console.warn(
        `[olive-symposium] Nicht verfügbar: ${message} Die Plattform läuft weiter.`,
      );
    }
  };
  const stop = async () => {
    stopping = true;
    clearOrigin();
    clearTimeout(timeout);
    if (
      !child?.pid ||
      closed ||
      child.exitCode !== null ||
      child.signalCode !== null
    )
      return;
    const running = child;
    await new Promise<void>((resolve) => {
      const force = setTimeout(() => {
        // Also reaches the real interpreter behind a Windows .venv redirector.
        running.stdin.end();
        running.kill('SIGKILL');
      }, 5000);
      running.once('close', () => {
        clearTimeout(force);
        resolve();
      });
      // The control pipe also closes automatically if Node is killed by an IDE.
      running.stdin.write('stop\n');
    });
  };

  try {
    const config = oliveConfig(env);
    clearOrigin();
    if (config.mode === 'disabled') {
      console.info('[olive-symposium] Deaktiviert (OLIVE_ENABLED=false).');
    } else if (config.mode === 'external') {
      onOrigin(config.origin);
      console.info('[olive-symposium] Externe lokale Laufzeit konfiguriert.');
    } else {
      const venv = join(
        root,
        '.venv',
        process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
      );
      const python =
        config.python ??
        (existsSync(venv)
          ? venv
          : process.platform === 'win32'
            ? 'python'
            : 'python3');
      child = spawn(
        python,
        ['-u', join(root, 'src/projects/olive-symposium/runtime/server.py')],
        {
          cwd: root,
          env: {
            ...env,
            OLIVE_ADMIN_PASSWORD: config.password,
            PYTHONUNBUFFERED: '1',
          },
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        },
      );
      child.stdin.on('error', () => {
        /* Already exited; close handles cleanup. */
      });
      // Never forward backend tracebacks/URLs: they can contain local paths or answers.
      child.stderr.resume();
      const lines = createInterface({ input: child.stdout });
      lines.on('line', (line) => {
        if (failed || stopping) return;
        try {
          const value: unknown = JSON.parse(line);
          const ready = readyMessage.safeParse(value);
          if (ready.success) {
            clearTimeout(timeout);
            onOrigin(`http://127.0.0.1:${ready.data.port}`);
            console.info(
              `[olive-symposium] Bereit (PID ${ready.data.pid}, Port ${ready.data.port}).`,
            );
          } else {
            const error = z
              .object({ event: z.literal('error'), reason: z.string() })
              .safeParse(value);
            if (error.success)
              fail(
                failureMessages[error.data.reason] ?? 'Start fehlgeschlagen.',
              );
          }
        } catch {
          fail('Ungültige Startmeldung des Legacy-Prozesses.');
        }
      });
      child.once('error', () => {
        clearTimeout(timeout);
        fail(
          'Python konnte nicht gestartet werden. OLIVE_PYTHON bzw. Python-Installation prüfen.',
        );
      });
      child.once('close', () => {
        closed = true;
        clearTimeout(timeout);
        lines.close();
        fail(
          'Der Legacy-Prozess wurde beendet. Nach der Fehlerbehebung die Anwendung neu starten.',
        );
      });
      timeout = setTimeout(() => {
        fail('Zeitlimit beim Start erreicht.');
        void stop();
      }, config.startupTimeout);
    }
  } catch (error) {
    // Only our validation errors contain guaranteed safe, fixed messages.
    fail(
      error instanceof OliveConfigurationError
        ? error.message
        : 'Laufzeit konnte nicht gestartet werden. OLIVE_PYTHON und Dateipfade prüfen.',
    );
  }
  return { stop };
}
