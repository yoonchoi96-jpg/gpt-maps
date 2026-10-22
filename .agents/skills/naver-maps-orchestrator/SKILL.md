---
name: naver-maps-orchestrator
description: "Use for Korean place discovery, NAVER Maps search, private GPT Maps links, location pins, navigation links, routes, Notion place notes, or NAVER Maps API/MCP troubleshooting for the GPT Maps project. Prefer authenticated NAVER read-only tools when truly connected, otherwise use available public map/business data without claiming NAVER API access. Keep owner OAuth and paid Directions disabled by default."
---

# NAVER Maps · GPT Maps orchestration skill

Use this skill for Korean map/place requests, '네이버 지도에서 찾아줘', map links, Notion map records, NAVER API/MCP work, or instructions to use the existing private GPT Maps. Treat the user's current request as the task; this skill neither grants tool permissions nor runs unattended.

## Fixed project surfaces

- Private owner-only map: `https://gpt-maps-private.yoonchoi-96.workers.dev/`
- Remote MCP endpoint: `https://gpt-maps-private.yoonchoi-96.workers.dev/mcp`
- Repo: `yoonchoi96-jpg/gpt-maps` (GitHub); Worker: `gpt-maps-private` (Cloudflare).
- Notion project page: `https://app.notion.com/p/401ec954707481b3bc19e6a349f3dd92`.
- Public *map-only* Notion widget: `https://yoonchoi96-jpg.github.io/gpt-maps/?embed=1`. It does not contain private places or session data.
- Detailed tool/auth reference: [references/capabilities.md](references/capabilities.md). Operational checks: [references/runbook.md](references/runbook.md).

## Always start with a capability check

1. Determine what tools this execution context **actually** exposes, not what the repository implements. A deployed MCP server is not the same as an installed, authenticated MCP tool in this conversation.
2. If `get_naver_maps_status` is genuinely callable through an authenticated MCP connection, call it for feature availability; use `search_naver_places`, `create_map_link`, or `create_naver_driving_link` only when exposed and callable.
3. If there is no NAVER MCP tool, use other **actually available** public web/business/map/location tools to answer place questions, and label results by their real source. For a map link, construct a private GPT Maps URL from *verified* coordinates and URL-encode parameters. Constructing a link does not read NAVER data or save a pin.
4. A GitHub or Cloudflare **management** connector can inspect/deploy application code; it does not automatically expose the private `/api/places` endpoint or grant access to the user's NAVER session. Do not pretend to proxy through management tools.
5. If user requests private NAVER data or real NAVER API response and no authenticated read path exists, explain what is unavailable and present any independently obtained public results separately. Never replace absent API results with invented results.

## Choose the smallest useful workflow

### A. Find and compare places

- Resolve area and constraints from the user. For 'near me', use available location-aware business search rather than guessing a neighborhood or accessing a precise address without need.
- If authenticated NAVER search is available, call `search_naver_places` with a 2–70-character query and treat up to five returned items as candidates, not a complete census. Verify user constraints (hours, category, suitability) with current sources where possible.
- Show name, address, grounded coordinates where supplied, and the exact source. Do not invent ratings, schedules, menus, prices or business availability.
- For multiple places, render a map when the host supports one and coordinate locators are verified. Create private map links for a selected place using verified coordinates.

### B. Make map links or choose route

- `create_map_link` or the private URL builder only changes map view. Never claim the place is permanently stored.
- `create_naver_driving_link` returns a mobile NAVER Map app deep-link plus web place-search fallback. It does **not** calculate a route, distance, traffic, ETA, or tolls.
- Request real route metrics only from an actually available route provider. NAVER Directions5 is intentionally disabled unless the user separately approved potential charges **and** an enforceable quota plan. Do not toggle it merely to complete a request.
- For Notion, use the public map-only widget for embedding; private OAuth-protected features should open in the owner-only web app.

### C. Preserve a place in Notion

- If the user explicitly asks to save/update, use a connected Notion write tool when actually available. Read the target page/database and schema before editing; preserve unrelated content and verify the saved result.
- Suggested record fields: place name, road address, category, verified latitude/longitude, source link, private GPT Maps URL, search timestamp, short notes. Mark unknown data as unknown.
- The existing private website supports **copy to Notion**, not proven automatic two-way sync. Do not claim a Notion entry was written when only a copy link was generated.

### D. Debug or extend GPT Maps

- Read repository code/config first and check Cloudflare deployment metadata. Prefer a minimal, tested change over speculative API substitutions.
- Only declare completion for a specific layer: committed, deployed, authorization checked, or actual end-to-end NAVER response independently verified. Keep these separate.
- Preserve NAVER owner allowlist, HttpOnly login session, MCP short-lived bearer gate, no-store headers and fail-closed API permissions.
- Add/update tests and document operational changes. Do not create frequent scheduled CI jobs; changes/manual dispatch only.

## Security, cost, and truthfulness boundaries

- NEVER request, display, log, commit, copy into Notion, or paste into chat: NAVER login Client Secret, NAVER Maps Secret, SESSION_SECRET, session cookies, OAuth callback code, or MCP bearer token. Browser token controls are owner-initiated. Public Client IDs and nonsecret URL schemes are fine.
- Do not open a public unauthenticated API passthrough or attach authorization secrets to GitHub Pages, browser localStorage, URL query strings, or shared Notion blocks.
- `NAVER_LOGIN_CLIENT_SECRET` authenticates the **login/search app**; it is not the paid Directions Maps secret. Search requires the NAVER Developers app's `검색` API permission.
- Maps Dynamic Map and server-side search may have usage limits/costs. Maintain no-extra-paid-calls policy; Directions5 stays off absent explicit authorization and billing safeguards.
- When access is missing, say 'not connected here' instead of 'API unavailable globally'. Avoid invented NAVER search results, real-time traffic/ETA, permissions, or successful writes.

## Response contract

Answer the user's immediate map task first. State which source was actually queried, what was verified, and what remains unverified. Provide working map/Notion links if relevant. Offer next steps only for real missing authorization, billing constraints, or required user decisions.
