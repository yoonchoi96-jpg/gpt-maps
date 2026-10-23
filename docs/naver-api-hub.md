# NAVER API HUB integration · Omari

## Current status (2026-10-23)

- Implemented on GitHub, owner-only Cloudflare Worker route and remote MCP tool wrappers.
- **Activation update (2026-10-23):** Both HUB credentials are confirmed as Cloudflare `secret_text`; `NAVER_API_HUB_ENABLED=true` and the Cloudflare deployment is at 100%. The user confirmed NCP usage limits are configured, but their exact quotas were not independently inspected. Live NAVER API HUB upstream search permission/results are **not yet verified**.
- Do not confuse NAVER Developers **Login** Client ID/Secret (`NAVER_LOGIN_*`) with NAVER **API HUB** Client ID/Secret (`NAVER_API_HUB_*`), or NAVER Cloud Maps secret.
- Do not send credentials in ChatGPT, issue trackers, GitHub source, Notion, URL query, or logs. Configure in Cloudflare secrets.

## Migration timeline: significant 2026 change

- 2026-06-25: NAVER API HUB launched in NCP.
- 2026-07-31: New signup for legacy NAVER Developers Search API, Search Trend, Shopping Insight blocked; signup is at NAVER API HUB.
- 2027-06-30: Legacy APIs stop working with old keys; use NAVER API HUB keys.
- 2026-07-31: Legacy Search Shopping, Book, Professional Document APIs ended **without replacements**. The Shopping **Insight trend** API is a DIFFERENT product and remains supported via API HUB.
- Official migration notice: https://developers.naver.com/notice/article/32530
- Retired API notice: https://developers.naver.com/notice/article/32564

## Supported search APIs (10)

| Type | Exact NAVER API HUB endpoint |
|---|---|
| news | GET `/search/v1/news` |
| blog | GET `/search/v1/blog` |
| local | GET `/search/v1/local` |
| cafe | GET `/search/v1/cafearticle` |
| kin | GET `/search/v1/kin` |
| encyclopedia | GET `/search/v1/encyc` |
| image | GET `/search/v1/image` |
| web | GET `/search/v1/webkr` |
| errata | GET `/search/v1/errata` |
| adult | GET `/search/v1/adult` |

Search results are limited to 5 (local) or 10 (others); the service preserves NAVER result rank and source links. These are public indexed results, **not the user's saved NAVER Maps places**. NAVER search providers require source attribution and must not be represented as own content.

## DataLab (3 routes)

- Search keyword trends: POST `/search-trend/v1/search`. Returns **relative normalized** search volume indices (max=100), not absolute search counts.
- Shopping Insight category trends: POST `/shopping/v1/categories`. Returns category click trend indices, not product prices, sales, or revenues.
- Shopping Insight keyword trends: POST `/shopping/v1/category/keywords`. Returns category/keyword click trends, not shopping product search.
- NCP API HUB origin: `https://naverapihub.apigw.ntruss.com`.
- Official overview: https://api.ncloud-docs.com/docs/naver-api-hub-overview
- Trend reference: https://api.ncloud-docs.com/docs/naver-api-hub-search-trend
- Shopping keyword: https://api.ncloud-docs.com/docs/naver-api-hub-shopping-insight-keywords

## Owner-only endpoints (private GPT Maps)

- GET `/api/hub/status`: configuration metadata only; does not test upstream credentials.
- GET `/api/hub/search?type=news&q=...`: search vertical selected by allowlist.
- POST `/api/hub/trend`: JSON (`startDate`, `endDate`, `timeUnit`, `keywordGroups`).
- POST `/api/hub/shopping`: JSON for `kind=categories` or `kind=keywords`.
- These endpoints require the validated owner NAVER session. `/mcp` also exposes corresponding tools, but is reachable only from an authenticated MCP client.
- MCP tools: `get_naver_hub_status`, `search_naver_hub`, `get_naver_search_trend`, `get_naver_shopping_insight`.
- UI: protected GPT Maps sidebar -> `NAVER API HUB · 통합 검색`, DataLab trend/shopping panels. Buttons remain disabled until configured.

## Configuration and activation checklist

1. Open **[NAVER API HUB Application](https://console.ncloud.com/naver-api-hub/application)**, use the existing `Omari` application if applicable, and select the Search and Data Lab APIs that will be used. Verify entitlements in the console.
2. Set hard **daily + monthly usage limits** from Application -> `한도 및 알림` **before** enabling: suggested modest start search 100 calls/day, 1000/month; Search Trend and Shopping Insight each 20 calls/day, 200/month, subject to NCP minimums. Add alerts (70% and 90%) and recipients. This is guidance, not a claim the quotas were configured.
3. Copy the **HUB** Client ID and Client Secret into Cloudflare Worker `gpt-maps-private` -> Settings -> Variables and Secrets; add both as **Secret** bindings:
   - `NAVER_API_HUB_CLIENT_ID` (secret_text)
   - `NAVER_API_HUB_CLIENT_SECRET` (secret_text)
4. **Completed 2026-10-23:** Do not paste credentials into chat or GitHub. `NAVER_API_HUB_ENABLED` was switched to `true` after the owner reported quota setup, and deployed. Restore `false` to disable requests.
5. Open the private map and confirm status is enabled; then manually search a low-volume term once (e.g. `서울시청`). Verify returned `provider=NAVER API HUB` data and actual permissions. One successful status check alone is not an upstream query test.
6. At the first sign of unexpected charges, set the enabled flag to false in GitHub and deploy, then review NCP Usage Statistics and quotas. Revoking HUB key also blocks calls.

## Safety / limitations

- Server calls only a fixed NAVER allowlist; no arbitrary URL proxy or billing-on toggle in the browser.
- Owner session and MCP bearer are checked before forwarding. Post bodies are limited to 7KB; response body length to 450KB; search result count to 10.
- No schedule, batch loop, background polling, or public endpoint. Production quota enforcement is **at NCP**, not Cloudflare Worker; no counter storage/KV was introduced.
- Existing NAVER Login, Maps SDK, private site and Notion public-map embed continue unchanged.
- NAVER Calendar, Cafe posting, user private data are separate OAuth-scoped APIs and require independent permission/consent; not silently enabled.
- NAVER Cloud Maps Geocoding, Reverse Geocoding, Static Map, Directions are a separate credential family and may incur charges; not silently enabled.
- Programmatic tests: `npm test`; production smoke test through authorized browser is pending until credentials and HUB entitlements are actually configured.
