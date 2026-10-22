# GPT Maps

## Owner-only NAVER Login (implementation prepared, not deployed)

A separate authenticated Cloudflare Worker has been implemented under worker/src/index.js and worker/public/index.html. This private version verifies the logged-in NAVER account's app-scoped profile ID on the server and denies other accounts.

**Deployment is NOT complete.** The current GitHub Pages website remains public and is NOT protected by NAVER login.

- [Korean step-by-step Cloudflare + NAVER account deployment](docs/deploy-private-login.md)
- [Authentication source](worker/src/index.js)
- [Security regression tests](worker/tests/auth.test.mjs)
- [Worker configuration](wrangler.jsonc)

You must configure an independent NAVER **Login** application, Cloudflare Workers credentials and session secret. The NAVER Maps Client ID does NOT authenticate a NAVER user account.

Protected private views are deliberately not embeddable in Notion yet; cross-site login and iframe authentication require a separate design.


A free GitHub Pages website for a personal NAVER Dynamic Map and future Notion embeds.

## Live site

Target address after activating Pages: https://yoonchoi96-jpg.github.io/gpt-maps/

NOTE: Publishing is not active until GitHub Pages is configured in repository Settings.

## Publish on GitHub Pages

1. Visit **Settings > Pages** in this repository.
2. Set **Build and deployment > Source** to **Deploy from a branch**.
3. Select **main**, directory **/(root)**, then **Save**.
4. After the deployment succeeds, open the live site above.

Site hosting is free on GitHub Free because this repository is public. NAVER Cloud Maps API may charge for excess requests; configure per-API usage limits before sharing.

## Register your NAVER Maps application

1. Open https://console.ncloud.com/maps/application in VPC > Application Services > Maps.
2. Enable **Dynamic Map** for your application.
3. Under **Web service URL**, enter the host without repository path: **https://yoonchoi96-jpg.github.io**
4. Configure conservative use limits and disallow exceeding the caps, where supported.
5. Under **Authentication Info**, confirm that the configured public Client ID is `napr2ensb6` (NOT Client Secret).

NAVER Maps JavaScript API v3 uses the public Client ID in the ncpKeyId parameter. Never enter Client Secret in this website, in GitHub, in a URL, or in Notion.

Official SDK: https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=YOUR_CLIENT_ID

## Use it

1. Open the GitHub Pages URL.
2. The map will auto-load using the preconfigured public Maps Client ID. Manual entry is only needed to switch to a different Client ID.
3. Select a sample location.
4. Click **현재 지도 공유 링크 복사**, or click **Notion 임베드 링크 복사** for the minimal embed layout.
5. In Notion type /embed and paste the generated link.

Default share/embed links do **not** need a key parameter because the site's public Client ID is bundled in index.html. Links only include a key parameter if someone manually overrides the default Client ID. It contains no Client Secret. A public Client ID is inherently exposed on a browser-hosted Dynamic Map; protect it with registered allowed-domain settings and suitable API usage limits.

Supported URL query parameters: lat, lng, zoom, title, key (public Client ID only), embed=1 (compact view).

This static site does not provide nearby search, driving routes, server-side API calls, or ChatGPT MCP endpoints; those require separate implementation.

## Privacy and security

- Static site only: no backend, analytics, account database, or secret storage.
- Do not publish Client Secret, billing keys, or any other server credentials.
- Only the public Client ID is used with NAVER's browser SDK.
- NAVER Maps API usage may incur costs above free quotas.
- Sample marker coordinates are approximate demonstration points.

## Source

Self-contained index.html and README. No build system needed.