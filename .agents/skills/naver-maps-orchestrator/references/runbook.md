# Operator runbook: GPT Maps / NAVER MCP

## Request → action examples

| User asks | Steps | Confirm completion by |
| --- | --- | --- |
| "일산에 카페 찾아줘" | Use connected NAVER `search_naver_places` if available; else public location-aware business tool. Rank only grounded results, provide map links | Actual source response and relevant place address/coords |
| "서울 시청 지도에 띄워" | Verify coords, create private map link via MCP or URL-encode URL | Link opens private site for authenticated owner. **Not stored** |
| "일산 → 홍대 자동차 길찾기" | If origin+destination grounded, use `create_naver_driving_link` / NAVER app; for ETA consult an actual route provider (if available) | Distinguish link generation from computed travel time |
| "이 장소 노션에 저장" | Fetch Notion destination and schema, write page/block using connected Notion tool, verify response | Saved Notion page URL / record contents |
| "지도 노션에 임베드" | Use **public map-only** widget; never embed credentials/protected user data | Notion embed block existence. Browser rendering is a separate validation |
| "네이버 즐겨찾기 가져와" | Verify if a current official user-favorites API + authorized tool exists. OAuth login alone is **not** saved-places permission | If absent, state unsupported and offer manual import/existing authorized export |

## Diagnosis tree

1. **No MCP tool available in agent runtime:** Skill cannot create a connection. Use public business/map provider tools, and report NAVER MCP as not attached to this runtime. Don't expose `/api/places` publicly or route around auth.
2. **`/mcp` → HTTP 401:** Missing, invalid, revoked or expired bearer. Authorized owner signs in and mints a new short-lived token; never paste it into chat. Note generic HTTP GET of `/mcp` is not a valid POST JSON-RPC smoke test.
3. **Browser owner login `/denied`:** NAVER app-scoped ID mismatch. Verify only through secure owner-controlled setup; never log user ID or secret into public issues.
4. **NAVER local Search → 403:** Check the `검색` permission on existing NAVER Developers `Omari` app (not the Cloudflare route). Do not claim NAVER data retrieved.
5. **Search → 429:** Respect quota; no retry flood. Prefer public search for general questions; surface partial results with provenance.
6. **Map tiles show auth failure:** Check Maps Dynamic Map entitlement and Web service allowed origins in Naver Cloud, including `gpt-maps-private.yoonchoi-96.workers.dev`; login app and Maps SDK IDs are different.
7. **Notion embed blank:** Confirm embed points to public map-only GitHub Pages URL; map-provider allowed origin may need review. Never disable X-Frame-Options on private owner site solely to make iframe work.
8. **Directions API returns 503:** Expected when `ENABLE_PAID_DIRECTIONS` is unset. Use NAVER app link; don't set paid flag or save secrets to files.
9. **Unknown server status:** Read Cloudflare deployment settings and GitHub latest source, run tests. Don't equate deployed with verified successful upstream calls.

## Cost- and security-aware code change sequence

- Check current repo (`.agents/skills`, `docs`, tests, Worker) before editing. Make the smallest change possible.
- Keep owner-only HMAC session checks before `/api/*`; keep `/mcp` protected by session/bearer verification.
- Never log/pass `SESSION_SECRET`, NAVER secrets, OAuth code, access tokens, bearer tokens or cookies. Never put them in GitHub, Notion, URLs, browser localStorage or telemetry.
- Keep paid Directions5 disabled until the user specifically approves billing and a hard quota/rate-limit mechanism; read-only MCP tools do not mean that API calls are free.
- Tests: `npm test` (Node >=20), includes auth + feature + MCP suites. `.github/workflows/mcp-smoke.yml` should run only on source changes and manual dispatch; don't add hourly/daily GitHub Actions.
- Check git commit SHA; Cloudflare deployment percentage/version/time; test pass/fail separately. For live NAVER result confirmation, actually query through an authenticated client. Do not declare success from syntax-check alone.

## Optional smoke test with a compatible HTTP MCP client

- Owner starts from `https://gpt-maps-private.yoonchoi-96.workers.dev/` and requests a bearer via the user-click button.
- In a trusted terminal/client, store token in an ephemeral environment variable or client credential manager, never as a command-line positional argument, repository file or screenshot.
- Send `POST /mcp` with `Content-Type: application/json` and `Authorization: Bearer <secret>`, JSON body `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}`.
- Follow with `tools/list`; expect four tools while Directions is disabled. A list call is a protocol check, NOT proof that the upstream NAVER Search API has permission.
- `search_naver_places` with query `서울시청` is the optional live query (uses NAVER quota); check returned coordinates and mark the test date. Never leak bearer in stdout/logs.
- For a localhost tester script (if created later), read token via environment (no prompt echo); redact both request headers and response credentials.

## What not to overclaim

- ChatGPT itself is not connected to NAVER simply because this repository's MCP was deployed or a `SKILL.md` was saved.
- Cloudflare management API reads Worker metadata; it does not transmit NAVER OAuth login cookies.
- A Notion embed block being present does not prove its map rendered in the user's Notion app.
- Search results from other map providers are not validated NAVER-specific results.
- A NAVER mobile app deep link does not calculate traffic-aware ETA.
