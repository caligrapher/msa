// ==UserScript==
// @name         MEXC Face Verify → Phone Link
// @namespace    https://github.com/caligrapher/mexc-face-link
// @version      1.0.0
// @description  Grab the Sumsub face-verification token on MEXC risk control and turn it into a QR / link you can open on your phone.
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
  // Where you host verify.html (GitHub Pages, Netlify, any static host).
  // Token is passed in the URL #hash (not sent to any server).
  const VERIFY_URL = 'https://caligrapher.github.io/mexc-face-link/verify.html';
  // Sumsub access tokens look like _act-... (prod) or _act-sbx-... (sandbox)
  const TOKEN_RE = /_act-(?:sbx-)?[A-Za-z0-9._-]{10,}/;
  // ---------------------------------------------------------------------------

  let lastToken = null;
  let lastIframeSrc = null;

  function seenToken(tok, source) {
    if (!tok || tok === lastToken) return;
    lastToken = tok;
    console.log('[mexc-face-link] token captured via', source, tok);
    showPanel();
  }

  // 1) Wrap snsWebSdk.init — the token is its first argument. Most reliable.
  //    The SDK script assigns window.snsWebSdk; intercept the assignment.
  let _sns;
  try {
    Object.defineProperty(window, 'snsWebSdk', {
      configurable: true,
      get() { return _sns; },
      set(v) {
        _sns = wrapSns(v);
      },
    });
  } catch (e) { /* property may already exist */ }

  function wrapSns(sns) {
    if (!sns || typeof sns.init !== 'function' || sns.__wrapped) return sns;
    const origInit = sns.init.bind(sns);
    sns.init = function (accessToken) {
      seenToken(typeof accessToken === 'string' ? accessToken : null, 'snsWebSdk.init');
      return origInit.apply(this, arguments);
    };
    sns.__wrapped = true;
    return sns;
  }

  // 2) Sniff fetch responses for the token (backup path).
  const origFetch = window.fetch;
  window.fetch = async function () {
    const res = await origFetch.apply(this, arguments);
    try {
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('json') || ct.includes('text')) {
        res.clone().text().then((t) => {
          const m = t.match(TOKEN_RE);
          if (m) seenToken(m[0], 'fetch');
        }).catch(() => {});
      }
    } catch (e) {}
    return res;
  };

  // 3) Sniff XHR responses too.
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function () { return origOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', function () {
      try {
        const t = typeof this.responseText === 'string' ? this.responseText : '';
        const m = t.match(TOKEN_RE);
        if (m) seenToken(m[0], 'xhr');
      } catch (e) {}
    });
    return origSend.apply(this, arguments);
  };

  // 4) Watch for the Sumsub iframe (fallback: raw direct link).
  const mo = new MutationObserver((muts) => {
    for (const mut of muts) {
      for (const node of mut.addedNodes) {
        if (node.nodeType !== 1) continue;
        const ifr = node.tagName === 'IFRAME' ? node : node.querySelector && node.querySelector('iframe');
        if (ifr && ifr.src && /sumsub|idensic/i.test(ifr.src)) {
          lastIframeSrc = ifr.src;
          const m = ifr.src.match(TOKEN_RE);
          if (m) seenToken(m[0], 'iframe');
          else showPanel();
        }
      }
    }
  });
  if (document.documentElement) mo.observe(document.documentElement, { childList: true, subtree: true });

  // ---- UI -------------------------------------------------------------------
  let panel;
  function showPanel() {
    if (!document.body) { document.addEventListener('DOMContentLoaded', showPanel); return; }
    const link = lastToken ? VERIFY_URL + '#token=' + encodeURIComponent(lastToken) : null;

    if (!panel) {
      panel = document.createElement('div');
      panel.style.cssText = [
        'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483647',
        'width:300px', 'padding:16px', 'background:#12161c', 'color:#e6e6e6',
        'font:13px/1.45 system-ui,sans-serif', 'border:1px solid #2a3038',
        'border-radius:12px', 'box-shadow:0 8px 30px rgba(0,0,0,.5)',
      ].join(';');
      document.body.appendChild(panel);
    }

    panel.innerHTML = '';
    const h = el('div', 'MEXC Face Verify → Phone');
    h.style.cssText = 'font-weight:700;margin-bottom:8px;color:#00c6a2';
    panel.appendChild(h);

    if (link) {
      // QR
      const qr = qrcode(0, 'M');
      qr.addData(link);
      qr.make();
      const img = document.createElement('div');
      img.innerHTML = qr.createImgTag(4, 8);
      img.style.cssText = 'background:#fff;padding:8px;border-radius:8px;display:inline-block';
      panel.appendChild(img);

      panel.appendChild(hint('Scan with your phone camera, or:'));

      const a = document.createElement('a');
      a.href = link; a.textContent = 'Open verify link'; a.target = '_blank';
      a.style.cssText = 'display:block;margin:6px 0;color:#4aa8ff;word-break:break-all';
      panel.appendChild(a);

      const copy = btn('Copy link', () => navigator.clipboard.writeText(link));
      panel.appendChild(copy);
      const copyTok = btn('Copy token', () => navigator.clipboard.writeText(lastToken));
      panel.appendChild(copyTok);

      panel.appendChild(hint('Token is short-lived — scan within a couple of minutes.'));
    } else {
      panel.appendChild(hint('Sumsub verification detected but no token captured yet. Start the face check on MEXC; the token appears when the widget loads.'));
    }

    if (lastIframeSrc) {
      const a = document.createElement('a');
      a.href = lastIframeSrc; a.textContent = 'Direct iframe link (experimental)'; a.target = '_blank';
      a.style.cssText = 'display:block;margin-top:8px;font-size:11px;color:#8a94a0;word-break:break-all';
      panel.appendChild(a);
    }

    const x = btn('✕ close', () => panel.remove());
    x.style.marginTop = '10px'; x.style.opacity = '.7';
    panel.appendChild(x);
  }

  function el(tag, text) { const e = document.createElement(tag); if (text) e.textContent = text; return e; }
  function hint(text) { const e = el('div', text); e.style.cssText = 'margin:8px 0;color:#9aa4b0;font-size:12px'; return e; }
  function btn(text, fn) {
    const b = el('button', text);
    b.style.cssText = 'display:inline-block;margin:4px 6px 0 0;padding:6px 10px;background:#1e2530;color:#e6e6e6;border:1px solid #2a3038;border-radius:8px;cursor:pointer;font-size:12px';
    b.onclick = fn;
    return b;
  }
})();
