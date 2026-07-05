// ==UserScript==
// @name         MEXC Face Verify → Phone Link
// @namespace    https://github.com/caligrapher/msa
// @version      2.0.0
// @description  Capture the Sumsub face-verification hand-off on MEXC risk control and turn it into a QR / link you can open on your phone. Includes a diagnostics dump.
// @author       you
// @match        https://*.mexc.com/*
// @match        https://*.mexc.co/*
// @run-at       document-start
// @grant        none
// @require      https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js
// ==/UserScript==

(function () {
  'use strict';

  // ---- CONFIG ---------------------------------------------------------------
  const VERIFY_URL = 'https://caligrapher.github.io/msa/verify.html';
  const TOKEN_RE = /_act-(?:sbx-)?[A-Za-z0-9._-]{10,}/;
  const SUMSUB_HOST_RE = /sumsub\.com|idensic|in\.sumsub/i;
  // Any URL that looks like a shareable / transfer / hand-off link:
  const SHARE_URL_RE = /https?:\/\/[^\s"'<>]*(?:sumsub\.com|in\.sumsub)[^\s"'<>]*\/(?:l|link|websdk|mobile|handover|transfer)[^\s"'<>]*/i;
  // ---------------------------------------------------------------------------

  let lastToken = null;
  let lastIframeSrc = null;
  let shareLink = null;            // the real device-transfer link, if we spot it
  const diag = [];                 // diagnostics buffer

  function log(kind, data) {
    const rec = { t: new Date().toISOString().slice(11, 23), kind, data };
    diag.push(rec);
    if (diag.length > 400) diag.shift();
    console.log('[mexc-face-link]', kind, data);
  }

  function scanForShare(str, source) {
    if (typeof str !== 'string' || !str) return;
    const m = str.match(SHARE_URL_RE);
    if (m && m[0] !== shareLink) {
      shareLink = m[0];
      log('SHARE_LINK', { source, url: shareLink });
      showPanel();
    }
  }

  function seenToken(tok, source) {
    if (!tok || tok === lastToken) return;
    lastToken = tok;
    log('TOKEN', { source, token: tok });
    showPanel();
  }

  // 1) Wrap snsWebSdk.init and the whole builder chain (captures token + config).
  let _sns;
  try {
    Object.defineProperty(window, 'snsWebSdk', {
      configurable: true,
      get() { return _sns; },
      set(v) { _sns = wrapSns(v); },
    });
  } catch (e) {}

  function wrapBuilder(b) {
    if (!b || b.__wrapped) return b;
    ['withConf', 'withOptions', 'withBaseUrl', 'on'].forEach((m) => {
      if (typeof b[m] === 'function') {
        const orig = b[m].bind(b);
        b[m] = function (arg) {
          if (m !== 'on') log('builder.' + m, safe(arg));
          const r = orig.apply(this, arguments);
          return wrapBuilder(r);
        };
      }
    });
    if (typeof b.build === 'function') {
      const origBuild = b.build.bind(b);
      b.build = function () { log('builder.build', {}); return origBuild.apply(this, arguments); };
    }
    b.__wrapped = true;
    return b;
  }

  function wrapSns(sns) {
    if (!sns || typeof sns.init !== 'function' || sns.__wrapped) return sns;
    const origInit = sns.init.bind(sns);
    sns.init = function (accessToken, refresh) {
      seenToken(typeof accessToken === 'string' ? accessToken : null, 'snsWebSdk.init');
      const builder = origInit.apply(this, arguments);
      return wrapBuilder(builder);
    };
    sns.__wrapped = true;
    return sns;
  }

  // 2) fetch sniffer — log every sumsub call + scan for tokens / share links.
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const res = await origFetch.apply(this, arguments);
    try {
      if (SUMSUB_HOST_RE.test(url)) {
        res.clone().text().then((t) => {
          log('fetch', { url, status: res.status, body: t.slice(0, 800) });
          const m = t.match(TOKEN_RE); if (m) seenToken(m[0], 'fetch');
          scanForShare(t, 'fetch:' + url);
        }).catch(() => {});
      }
    } catch (e) {}
    return res;
  };

  // 3) XHR sniffer.
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) { this.__url = url; return origOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', function () {
      try {
        const url = this.__url || '';
        if (!SUMSUB_HOST_RE.test(url)) return;
        const t = typeof this.responseText === 'string' ? this.responseText : '';
        log('xhr', { url, status: this.status, body: t.slice(0, 800) });
        const m = t.match(TOKEN_RE); if (m) seenToken(m[0], 'xhr');
        scanForShare(t, 'xhr:' + url);
      } catch (e) {}
    });
    return origSend.apply(this, arguments);
  };

  // 4) postMessage sniffer — the WebSDK ↔ iframe handshake carries hand-off info.
  window.addEventListener('message', function (ev) {
    try {
      if (!SUMSUB_HOST_RE.test(String(ev.origin))) return;
      const d = ev.data;
      const s = typeof d === 'string' ? d : JSON.stringify(d);
      log('postMessage', { origin: ev.origin, data: s.slice(0, 800) });
      scanForShare(s, 'postMessage');
      const m = s && s.match(TOKEN_RE); if (m) seenToken(m[0], 'postMessage');
    } catch (e) {}
  }, true);

  // 5) iframe watcher.
  const mo = new MutationObserver((muts) => {
    for (const mut of muts) for (const node of mut.addedNodes) {
      if (node.nodeType !== 1) continue;
      const ifr = node.tagName === 'IFRAME' ? node : node.querySelector && node.querySelector('iframe');
      if (ifr && ifr.src && SUMSUB_HOST_RE.test(ifr.src)) {
        lastIframeSrc = ifr.src;
        log('iframe', { src: ifr.src });
        scanForShare(ifr.src, 'iframe');
        const m = ifr.src.match(TOKEN_RE); if (m) seenToken(m[0], 'iframe');
        else showPanel();
      }
    }
  });
  if (document.documentElement) mo.observe(document.documentElement, { childList: true, subtree: true });

  function safe(o) { try { return JSON.parse(JSON.stringify(o)); } catch (e) { return String(o); } }

  // ---- UI -------------------------------------------------------------------
  let panel;
  function showPanel() {
    if (!document.body) { document.addEventListener('DOMContentLoaded', showPanel); return; }

    // Preferred target: a real Sumsub-generated share/transfer link. Fall back to
    // the raw-token launcher only if we never saw one.
    const primary = shareLink
      || (lastToken ? 'https://api.sumsub.com/idensic/l/#/' + encodeURIComponent(lastToken) : null);
    const fallback = lastToken ? VERIFY_URL + '#token=' + encodeURIComponent(lastToken) : null;

    if (!panel) {
      panel = document.createElement('div');
      panel.style.cssText = [
        'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483647',
        'width:320px', 'max-height:90vh', 'overflow:auto', 'padding:16px',
        'background:#12161c', 'color:#e6e6e6', 'font:13px/1.45 system-ui,sans-serif',
        'border:1px solid #2a3038', 'border-radius:12px', 'box-shadow:0 8px 30px rgba(0,0,0,.5)',
      ].join(';');
      document.body.appendChild(panel);
    }
    panel.innerHTML = '';
    const h = el('div', 'MEXC Face Verify → Phone');
    h.style.cssText = 'font-weight:700;margin-bottom:8px;color:#00c6a2';
    panel.appendChild(h);

    if (shareLink) {
      panel.appendChild(tag('✓ native transfer link found', '#00c6a2'));
    } else if (primary) {
      panel.appendChild(tag('⚠ no native link yet — using raw token (may fail)', '#e0a000'));
    }

    if (primary) {
      const qr = qrcode(0, 'M'); qr.addData(primary); qr.make();
      const img = document.createElement('div');
      img.innerHTML = qr.createImgTag(4, 8);
      img.style.cssText = 'background:#fff;padding:8px;border-radius:8px;display:inline-block';
      panel.appendChild(img);
      panel.appendChild(hint('Scan with your phone camera, or:'));
      const a = el('a', 'Open link'); a.href = primary; a.target = '_blank';
      a.style.cssText = 'display:block;margin:6px 0;color:#4aa8ff;word-break:break-all';
      panel.appendChild(a);
      panel.appendChild(btn('Copy link', () => navigator.clipboard.writeText(primary)));
      if (lastToken) panel.appendChild(btn('Copy token', () => navigator.clipboard.writeText(lastToken)));
      if (fallback) {
        const fb = el('a', 'Fallback (self-hosted)'); fb.href = fallback; fb.target = '_blank';
        fb.style.cssText = 'display:block;margin-top:6px;font-size:11px;color:#8a94a0;word-break:break-all';
        panel.appendChild(fb);
      }
    } else {
      panel.appendChild(hint('Waiting for the Sumsub widget… start the face check on MEXC.'));
    }

    // Diagnostics — the important bit while we get this working.
    const diagBtn = btn('📋 Copy diagnostics (' + diag.length + ')', () => {
      const dump = {
        ua: navigator.userAgent, href: location.href, token: lastToken,
        iframe: lastIframeSrc, shareLink, events: diag,
      };
      navigator.clipboard.writeText(JSON.stringify(dump, null, 2))
        .then(() => diagBtn.textContent = '✓ copied — paste to chat');
    });
    diagBtn.style.cssText += ';margin-top:10px;background:#243b2f;border-color:#2f5a44';
    panel.appendChild(diagBtn);

    const x = btn('✕ close', () => panel.remove());
    x.style.marginTop = '8px'; x.style.opacity = '.7';
    panel.appendChild(x);
  }

  function el(tag, text) { const e = document.createElement(tag); if (text) e.textContent = text; return e; }
  function hint(text) { const e = el('div', text); e.style.cssText = 'margin:8px 0;color:#9aa4b0;font-size:12px'; return e; }
  function tag(text, color) { const e = el('div', text); e.style.cssText = 'margin:4px 0 8px;font-size:12px;color:' + color; return e; }
  function btn(text, fn) {
    const b = el('button', text);
    b.style.cssText = 'display:inline-block;margin:4px 6px 0 0;padding:6px 10px;background:#1e2530;color:#e6e6e6;border:1px solid #2a3038;border-radius:8px;cursor:pointer;font-size:12px';
    b.onclick = fn; return b;
  }

  // Show the panel early so the diagnostics button is available even before a token.
  if (document.readyState !== 'loading') showPanel();
  else document.addEventListener('DOMContentLoaded', showPanel);
})();
