import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

const TARGET_HOST = '127.0.0.1';
const FRONTEND_PORT = 3001;
const BACKEND_PORT = 3000;
const HTTP_LISTEN_PORT = 80;
const HTTPS_LISTEN_PORT = 443;
const CERT_PATH =
  process.env.TWENTY_LOCALHOST_CERT_PATH ?? './.certs/localhost/localhost.crt';
const KEY_PATH =
  process.env.TWENTY_LOCALHOST_KEY_PATH ?? './.certs/localhost/localhost.key';
const HTTPS_LOCALHOST_URL = 'https://localhost';
const BACKEND_PATH_PREFIXES = [
  '/admin-panel',
  '/auth',
  '/client-config',
  '/file',
  '/graphql',
  '/healthz',
  '/metadata',
  '/public-assets',
  '/rest',
  '/s',
  '/webhooks',
];

const getTargetPort = (requestUrl) => {
  const { pathname } = new URL(requestUrl ?? '/', HTTPS_LOCALHOST_URL);

  return BACKEND_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
    ? BACKEND_PORT
    : FRONTEND_PORT;
};

const injectLocalhostRuntimeConfig = (html) =>
  html.replace(
    /<!-- BEGIN: Twenty Config -->[\s\S]*?<!-- END: Twenty Config -->/,
    `<!-- BEGIN: Twenty Config -->
    <script id="twenty-env-config">
      window._env_ = ${JSON.stringify(
        { REACT_APP_SERVER_BASE_URL: HTTPS_LOCALHOST_URL },
        null,
        2,
      )};
    </script>
    <!-- END: Twenty Config -->`,
  );

const proxyHttpRequest = (clientRequest, clientResponse) => {
  const targetPort = getTargetPort(clientRequest.url);

  const upstreamRequest = http.request(
    {
      hostname: TARGET_HOST,
      port: targetPort,
      path: clientRequest.url,
      method: clientRequest.method,
      headers: {
        ...clientRequest.headers,
        host: clientRequest.headers.host ?? 'localhost',
        'x-forwarded-host': clientRequest.headers.host ?? 'localhost',
        'x-forwarded-proto': 'https',
      },
    },
    (proxyResponse) => {
      const contentType = proxyResponse.headers['content-type'];
      const contentEncoding = proxyResponse.headers['content-encoding'];
      const shouldInjectRuntimeConfig =
        targetPort === FRONTEND_PORT &&
        typeof contentType === 'string' &&
        contentType.includes('text/html') &&
        !contentEncoding;

      if (shouldInjectRuntimeConfig) {
        const chunks = [];

        proxyResponse.on('data', (chunk) => chunks.push(chunk));
        proxyResponse.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          const responseHeaders = { ...proxyResponse.headers };

          delete responseHeaders['content-length'];

          clientResponse.writeHead(
            proxyResponse.statusCode ?? 502,
            responseHeaders,
          );
          clientResponse.end(injectLocalhostRuntimeConfig(body));
        });

        return;
      }

      clientResponse.writeHead(
        proxyResponse.statusCode ?? 502,
        proxyResponse.headers,
      );
      proxyResponse.pipe(clientResponse);
    },
  );

  upstreamRequest.on('error', () => {
    clientResponse.writeHead(502, { 'content-type': 'text/plain' });
    clientResponse.end('Twenty CRM is still starting. Refresh this page in a moment.');
  });

  clientRequest.pipe(upstreamRequest);
};

const proxyUpgradeToFrontend = (request, clientSocket, head) => {
  const upstreamSocket = net.connect(FRONTEND_PORT, TARGET_HOST, () => {
    upstreamSocket.write(
      `${request.method} ${request.url} HTTP/${request.httpVersion}\r\n` +
        Object.entries({
          ...request.headers,
          host: request.headers.host ?? 'localhost',
          'x-forwarded-host': request.headers.host ?? 'localhost',
          'x-forwarded-proto': 'https',
        })
          .map(([key, value]) => `${key}: ${value}`)
          .join('\r\n') +
        '\r\n\r\n',
    );
    upstreamSocket.write(head);
    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);
  });

  upstreamSocket.on('error', () => clientSocket.destroy());
};

const httpsServer = https.createServer(
  {
    cert: fs.readFileSync(CERT_PATH),
    key: fs.readFileSync(KEY_PATH),
  },
  proxyHttpRequest,
);

httpsServer.on('upgrade', proxyUpgradeToFrontend);

const httpRedirectServer = http.createServer((clientRequest, clientResponse) => {
  clientResponse.writeHead(308, {
    location: `https://localhost${clientRequest.url ?? '/'}`,
  });
  clientResponse.end();
});

httpsServer.listen(HTTPS_LISTEN_PORT, '127.0.0.1');
httpRedirectServer.listen(HTTP_LISTEN_PORT, '127.0.0.1');
