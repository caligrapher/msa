# MEXC Face Verify → Phone Link

Grab the Sumsub face-verification token when MEXC risk control asks for a liveness/face check on desktop, and turn it into a QR code + link you open on your phone. Do the face check where it's convenient.

MEXC's KYC/liveness runs on Sumsub. The face widget is launched with a short-lived Sumsub **access token**. This tool captures that token in the browser and re-launches the same Sumsub WebSDK on your phone.

## Parts
- `mexc-face-link.user.js` — Tampermonkey userscript. Captures the token, shows a panel with **one-click phone link** + QR.
- `verify.html` — static fallback launcher (no origin spoof).
- `worker/` — Cloudflare Worker proxy. Spoofs `Origin: mexc.com` so the SDK works from any IP/device.

## Setup (once)

### 1. Deploy the proxy (recommended)
```bash
cd worker
npm i -g wrangler   # or: npx wrangler login
wrangler deploy
```
Copy the `*.workers.dev` URL (e.g. `https://sumsub-proxy.xxx.workers.dev/v`).

Optional: set `SPOOF_ORIGIN` in `wrangler.toml` if not `https://www.mexc.com`.

### 2. Configure the userscript
Open `mexc-face-link.user.js`, set:
```js
const PROXY_URL = 'https://sumsub-proxy.xxx.workers.dev/v';
const SPOOF_ORIGIN = 'mexc.com';
```

### 3. Install userscript
Tampermonkey → Create new script → paste → save.

## Use
1. On desktop, trigger MEXC face verification as normal.
2. When the Sumsub widget loads, click **📱 Phone link (copy + open)** — one button, link copied + opened.
3. Scan the QR or open the link on your phone. Complete the face check.

The desktop iframe is blanked after capture so the token isn't consumed twice.

## Notes / limits
- **Token is short-lived.** Sumsub access tokens expire (often ~2 min). Click fast.
- **Self-hosted only.** You run the proxy on your Cloudflare account — no third-party TG bot needed.
- **Origin must match allowlist.** `SPOOF_ORIGIN` must be the exact domain MEXC registered with Sumsub (e.g. `mexc.com`).
- **Nothing leaves your machine except to Sumsub** (via your proxy). Token travels in URL `#hash` (not sent to server logs).
- If capture fails, open DevTools → `[mexc-face-link]` logs.

## Sources
- [MEXC × Sumsub partnership](https://sumsub.com/newsroom/mexc-and-sumsub-partner-to-strengthen-global-compliance-and-combat-emerging-identity-fraud-risks/)
- [Sumsub WebSDK docs](https://docs.sumsub.com/docs/get-started-with-web-sdk)
