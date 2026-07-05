# MEXC Face Verify → Phone Link

Grab the Sumsub face-verification token when MEXC risk control asks for a liveness/face check on desktop, and turn it into a QR code + link you open on your phone. Do the face check where it's convenient.

MEXC's KYC/liveness runs on Sumsub. The face widget is launched with a short-lived Sumsub **access token**. This tool captures that token in the browser and re-launches the same Sumsub WebSDK on your phone.

## Parts
- `mexc-face-link.user.js` — Tampermonkey userscript. Runs on mexc.com, captures the token, shows a floating panel with QR + link.
- `verify.html` — tiny page you host once. Reads the token from the link `#hash` and runs the Sumsub WebSDK.

## Setup (once)
1. **Host `verify.html`.** Easiest: push it to a GitHub Pages repo, e.g. `https://<you>.github.io/mexc-face-link/verify.html`. Any static host (Netlify, Cloudflare Pages) works.
2. **Edit the userscript.** Open `mexc-face-link.user.js`, set `VERIFY_URL` to your hosted URL.
3. **Install userscript.** Tampermonkey → Create new script → paste → save. (Or drag the `.user.js` file into the Tampermonkey dashboard.)

## Use
1. On desktop, trigger the MEXC risk-control face verification as normal.
2. When the Sumsub widget loads, the panel pops up bottom-right with a QR + link.
3. Scan the QR with your phone (or copy the link). Complete the face check on the phone.

## Notes / limits
- **Token is short-lived.** Sumsub access tokens expire (often a couple of minutes). Scan quickly. If it expired, the phone page says so — just re-trigger on desktop for a fresh token.
- **No refresh on the phone.** The phone can't call MEXC's backend to refresh, so it reuses the one token. Fine for a single liveness pass.
- **Nothing leaves your machine except to Sumsub.** The token travels in the URL `#hash`, which browsers don't send to the hosting server. `verify.html` talks only to Sumsub's own CDN/API.
- **Direct iframe link** (shown in the panel) is a best-effort fallback; the hosted `verify.html` path is the reliable one.
- If capture fails, open DevTools console and look for `[mexc-face-link]` logs; MEXC may have changed field/endpoint names — adjust `TOKEN_RE` or the sniffers.

## Sources
- [MEXC × Sumsub partnership](https://sumsub.com/newsroom/mexc-and-sumsub-partner-to-strengthen-global-compliance-and-combat-emerging-identity-fraud-risks/)
- [Sumsub WebSDK docs](https://docs.sumsub.com/docs/get-started-with-web-sdk)
