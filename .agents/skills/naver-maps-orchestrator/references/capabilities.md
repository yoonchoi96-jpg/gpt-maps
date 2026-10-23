# Capabilities and invocation contracts

## Current architecture

```text
User → NAVER OAuth login → protected GPT Maps Cloudflare Worker → NAVER Dynamic Map SDK (browser)
                                              ↳ /api/places → NAVER API HUB Local Search
                                              ↳ /api/directions → NAVER Cloud Directions5 (disabled unless opt-in)
Owner → short-lived /api/mcp-token → bearer → /mcp → same server-side search/link tools
Notion → public map-only GitHub Pages embed (no private user records)
```

**The existence of `/mcp` is not proof the current assistant can call it.** Check installed connector/tool availability first. Other built-in map/business tools can be used independently; cite them as that source, not NAVER.

## Public project IDs and URLs

- Public map browser SDK Client ID: `napr2ensb6` (nonsecret).
- Public NAVER Login Developers app Client ID: `EACK4pHdDIF6sAq0Q7Vh` (nonsecret).
- App name in NAVER Developers: `Omari`. Its **검색 / Search** service must be enabled for Local Search to work.
- Protected site: `https://gpt-maps-private.yoonchoi-96.workers.dev/`.
- Remote stateless Streamable HTTP MCP: `https://gpt-maps-private.yoonchoi-96.workers.dev/mcp`.
- GitHub: `https://github.com/yoonchoi96-jpg/gpt-maps`.
- Notion personal map page: `https://app.notion.com/p/401ec954707481b3bc19e6a349f3dd92`.
- Public map-only embed: `https://yoonchoi96-jpg.github.io/gpt-maps/?embed=1`.

## Owner-only MCP tools (as implemented 2026-10-23)

| Tool | Input | Output/limits |
| --- | --- | --- |
| `get_naver_maps_status` | `{}` | Authorized feature status; not a live NAVER test |
| `search_naver_places` | `{query: string}` (length 2–70) | Up to 5 NAVER API HUB Local Search results (name, address, category, lat/lng). Requires HUB credentials, enabled gate and Local Search entitlement |
| `create_map_link` | `{latitude, longitude, zoom?, title?}` | Protected map URL showing coordinate; does **not** persist a place |
| `create_naver_driving_link` | `{start_latitude, start_longitude, destination_latitude, destination_longitude, start_name?, destination_name?}` | NAVER Map mobile app deep link, web-search fallback; no ETA or computed path |
| `get_naver_driving_route` | start/goal longitude and latitude | Not exposed unless **explicitly paid-enabled** and maps secret available; do not silently turn on |

Existing protected website JSON routes: `/api/me`, `/api/features`, `/api/places?q=`, `/api/directions?start=lng,lat&goal=lng,lat`. `GET /api/places` requires a signed browser session; **management Cloudflare MCP cannot simply call it as the owner**.

Search API: `https://naverapihub.apigw.ntruss.com/search/v1/local` via the shared server-side `hubSearch` implementation. Requires both HUB Secrets and `NAVER_API_HUB_ENABLED=true`; never use Login app credentials for place search. Results remain limited to five, in upstream order. Scaled integer `mapx`/`mapy` are normalized to WGS84 degrees; absent/invalid coordinates remain null. This searches public businesses, not personal saved places.

## Auth scheme

- Private website: NAVER OAuth → verify returned app-scoped ID against allowlist → HMAC-signed HttpOnly cookie.
- MCP: short-lived HMAC bearer (12 hours) issued *only* by the owner website to the owner browser. MCP bearer is not OAuth. Tokens may be pasted only into the **trusted MCP client credential setting** by the owner, never in chat or files.
- HTTP: `POST /mcp`, `Content-Type: application/json`, `Authorization: Bearer <token>`; JSON-RPC 2.0, protocol version `2025-06-18`. The bearer is issued by clicking the button in the protected site.
- Owner token refresh requires user action; never log/exfiltrate or request the bearer value in conversation.
- ChatGPT direct custom MCP availability varies by product plan/environment; dynamically inspect supported connectors rather than assuming entitlement. The mere existence of this skill grants no new runtime connector.

## Safe deep links (do not claim live route data)

Private location link example:

`https://gpt-maps-private.yoonchoi-96.workers.dev/?lat=37.56668&lng=126.97841&zoom=15&title=%EC%84%9C%EC%9A%B8%20%EC%8B%9C%EC%B2%AD`

Mobile app driving URL pattern: `nmap://route/car?slat=<lat>&slng=<lng>&sname=<encoded>&dlat=<lat>&dlng=<lng>&dname=<encoded>&appname=<url-encoded-origin>`.

Web search fallback: `https://map.naver.com/p/search/<encoded-place-and-address>`. This is a destination search, not a driving route, not a reservation, and does not prove business availability.

## Available provider fallbacks

- If NAVER MCP is unconnected: use available live web/business/map tools, ideally location-aware, and explicitly identify those sources; verify name/coordinates before writing a map link. Do not cite a NAVER API tool that was not called.
- If Notion connector is connected: query the destination, fetch content/schema, create/update only on request, read back to confirm. `Notion` connector cannot magically authenticate the embedded private map.
- If GitHub/Cloudflare connector is connected: inspect and update source code/config and deployments; verify new deployment version, not runtime map results by inference.
- If no live lookup tools are accessible, avoid fabricated results and clearly mark illustration/demo links.

## Source files

- Worker login/routing: `worker/src/index.js`.
- Owner search + opt-in Directions: `worker/src/places-and-routes.js`.
- MCP: `worker/src/mcp.js`.
- Private UI: `worker/public/index.html`, `worker/public/features.js`, `worker/public/mcp-connect.js`.
- Notion integration summary: `docs/features.md`, `docs/mcp-integration.md`.
- Tests: `worker/tests/auth.test.mjs`, `worker/tests/features.test.mjs`, `worker/tests/mcp.test.mjs`.

## Source references

- NAVER Developers Local Search: https://developers.naver.com/docs/serviceapi/search/local/local.md
- NAVER Maps: https://api.ncloud-docs.com/docs/application-maps-overview
- Codex Agent Skills: https://learn.chatgpt.com/docs/customization/overview
- Agent Skills schema: https://agentskills.io/specification

## NAVER API HUB (2026-10)

The HUB is a DIFFERENT product from the NAVER Developers Login app, and from Naver Maps. See [the HUB setup guide](../../../../docs/naver-api-hub.md).

- Fixed upstream host: `https://naverapihub.apigw.ntruss.com`; server-only headers `X-NCP-APIGW-API-KEY-ID` and `X-NCP-APIGW-API-KEY`. Never expose either credential to browsers/Notion/chat.
- Cloudflare settings: `NAVER_API_HUB_CLIENT_ID`, `NAVER_API_HUB_CLIENT_SECRET` as secret bindings, `NAVER_API_HUB_ENABLED=false` by default. Owner must configure NCP quotas before activation.
- Owner endpoints: `/api/hub/status`, `/api/hub/search?type=news&q=...`, `POST /api/hub/trend`, `POST /api/hub/shopping`.
- New MCP tools: `get_naver_hub_status`, `search_naver_hub`, `get_naver_search_trend`, `get_naver_shopping_insight`. These do not work in a ChatGPT runtime unless connected/authenticated there.
- Search kinds: news, blog, local, cafe, kin, encyclopedia, image, web, errata, adult. NEWS/BLOG etc list results preserve upstream rank and source links; shopping products/book/document searches are retired.
- DataLab search trend returns relative search volume (not raw numbers). Shopping insight returns relative clicks (not prices/sales). These require a permitted API HUB application.
- Legacy search/data APIs new sign-ups blocked since 2026-07-31, legacy end 2027-06-30. NAVER Login separate and unaffected.
