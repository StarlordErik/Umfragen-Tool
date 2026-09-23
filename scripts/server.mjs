import { createServer } from 'node:http';
import next from 'next';

const hostname = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 8000);
const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
await app.prepare();
const server = createServer((request, response) => {
  request.headers['x-olive-client-ip'] = (
    request.socket.remoteAddress || '127.0.0.1'
  ).replace(/^::ffff:/, '');
  request.headers['x-forwarded-for'] = request.headers['x-olive-client-ip'];
  request.headers['x-forwarded-host'] = request.headers.host;
  request.headers['x-forwarded-proto'] = 'http';
  handle(request, response);
});
server.listen(port, hostname, () =>
  console.log(`Projektraum bereit auf Port ${port}`),
);
server.on('error', (error) => {
  console.error(error.message);
  process.exit(1);
});

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  server.closeAllConnections();
  server.close();
  await app.close();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
// JetBrains can terminate the Python parent directly on Windows.
if (process.env.PLATFORM_PARENT_PID) {
  const parent = Number(process.env.PLATFORM_PARENT_PID);
  setInterval(() => {
    try {
      process.kill(parent, 0);
    } catch {
      void stop();
    }
  }, 1000).unref();
}
