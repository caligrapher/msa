/**
 * Self-hosted Sumsub WebSDK proxy.
 * Serves a launcher page and proxies api.sumsub.com with a spoofed Origin
 * (must match the client's Sumsub allowlist, e.g. mexc.com).
 *
 * Deploy: cd worker && npx wrangler deploy
 */

const DEFAULT_ORIGIN = 'https://www.mexc.com';

const LAUNCHER_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Face verification</title>
<style>
  html,body{margin:0;height:100%;background:#0e1116;color:#e6e6e6;font:15px/1.4 system-ui,sans-serif}
  #msg{padding:20px;text-align:center}
  #sumsub-websdk-container{min-height:100vh}
</style>
</head>
<body>
<div id="msg">Loading verification…</div>
<div id="sumsub-websdk-container"></div>
<script src="https://static.sumsub.com/idensic/static/sns-websdk-builder.js"><\/script>
<script>
(function () {
  function qp(name) {
    var h = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (h.get(name)) return h.get(name);
    return new URLSearchParams(location.search).get(name);
  }
  var msg = document.getElementById('msg');
  var token = qp('token');
  var origin = qp('origin') || '__DEFAULT_ORIGIN__';
  if (!token) {
    msg.innerHTML = 'No token in the link.<br>Get a fresh link from MEXC and try again.';
    return;
  }
  if (typeof snsWebSdk === 'undefined') {
    msg.textContent = 'Could not load the Sumsub SDK. Check your connection and reload.';
    return;
  }
  var apiBase = location.origin + '/api';
  try {
    var sdk = snsWebSdk
      .init(token, function () { return Promise.resolve(token); })
      .withBaseUrl(apiBase)
      .withConf({ lang: 'en', theme: 'dark' })
      .withOptions({ addViewportTag: true, adaptIframeHeight: true })
      .on('idCheck.onError', function (e) {
        console.error('sumsub error', e);
        msg.innerHTML = 'Verification error.<br>Token may have expired — get a new link from MEXC.';
      })
      .build();
    sdk.launch('#sumsub-websdk-container');
    msg.style.display = 'none';
  } catch (e) {
    console.error(e);
    msg.textContent = 'Failed to start: ' + e;
  }
})();
<\/script>
</body>
</html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = env.SPOOF_ORIGIN || DEFAULT_ORIGIN;
    const html = LAUNCHER_HTML.replace('__DEFAULT_ORIGIN__', origin.replace(/\\/g, '\\\\').replace(/'/g, "\\'"));

    if (url.pathname === '/' || url.pathname === '/v') {
      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }

    if (url.pathname.startsWith('/api')) {
      return proxySumsub(request, url, origin);
    }

    return new Response('Not found', { status: 404 });
  },
};

async function proxySumsub(request, url, spoofOrigin) {
  const targetPath = url.pathname.slice('/api'.length) || '/';
  const target = new URL(targetPath + url.search, 'https://api.sumsub.com');

  const headers = new Headers();
  const pass = ['content-type', 'accept', 'accept-language', 'x-access-token', 'authorization'];
  for (const [k, v] of request.headers) {
    const lower = k.toLowerCase();
    if (pass.some((p) => lower === p || lower.startsWith('x-'))) {
      headers.set(k, v);
    }
  }
  headers.set('Origin', spoofOrigin);
  headers.set('Referer', spoofOrigin + '/');

  const init = {
    method: request.method,
    headers,
    redirect: 'manual',
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
  }

  const res = await fetch(target.toString(), init);
  const out = new Headers(res.headers);
  out.set('Access-Control-Allow-Origin', '*');
  out.delete('content-security-policy');

  return new Response(res.body, { status: res.status, headers: out });
}
