import { spawn } from 'node:child_process';
import type { IncomingMessage, Server } from 'node:http';
import { networkInterfaces } from 'node:os';

/** Legacy anonymous identity must come from the socket, never browser headers. */
export function setTrustedForwardingHeaders(request: {
  headers: IncomingMessage['headers'];
  socket: Pick<IncomingMessage['socket'], 'remoteAddress'>;
}): void {
  const ip = (request.socket.remoteAddress ?? '127.0.0.1').replace(
    /^::ffff:/,
    '',
  );
  request.headers['x-olive-client-ip'] = ip;
  request.headers['x-forwarded-for'] = ip;
  request.headers['x-forwarded-host'] = request.headers.host;
  request.headers['x-forwarded-proto'] = 'http';
}

export async function listen(
  server: Server,
  hostname: string,
  firstPort: number,
  allowFallback: boolean,
): Promise<number> {
  for (let port = firstPort; port < Math.min(firstPort + 50, 65536); port++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const onListening = () => {
          server.off('error', onError);
          resolve();
        };
        const onError = (error: Error) => {
          server.off('listening', onListening);
          reject(error);
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, hostname);
      });
      return port;
    } catch (error) {
      if (
        !allowFallback ||
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'EADDRINUSE'
      )
        throw new Error(`Der Webserver kann Port ${port} nicht öffnen.`);
    }
  }
  throw new Error('Kein freier Port für den Webserver gefunden.');
}

export function localUrls(hostname: string, port: number): string[] {
  if (hostname === '0.0.0.0' || hostname === '::') {
    const lan = Object.values(networkInterfaces())
      .flat()
      .filter((address) => address?.family === 'IPv4' && !address.internal)
      .map((address) => `http://${address!.address}:${port}/`);
    return [`http://localhost:${port}/`, ...new Set(lan)];
  }
  const host = hostname.includes(':') ? `[${hostname}]` : hostname;
  return [`http://${host}:${port}/`];
}

export function openBrowser(url: string): void {
  const [command, args] =
    process.platform === 'win32'
      ? (['rundll32.exe', ['url.dll,FileProtocolHandler', url]] as const)
      : process.platform === 'darwin'
        ? (['open', [url]] as const)
        : (['xdg-open', [url]] as const);
  const browser = spawn(command, [...args], {
    stdio: 'ignore',
    windowsHide: true,
    detached: true,
  });
  browser.on('error', () =>
    console.warn('Bitte die lokale URL im Browser öffnen.'),
  );
  browser.unref();
}
