# GPT Maps repository guidance

- For any NAVER Maps, Korean place search, owner-only map, driving-link, Notion map embedding, or Maps MCP work, use the project skill: `.agents/skills/naver-maps-orchestrator/SKILL.md`.
- Read the skill's `references/capabilities.md` for current endpoints and `references/runbook.md` for operations and troubleshooting. Confirm current tool access; a deployed remote MCP is not automatically callable in ChatGPT.
- Preserve the owner-only NAVER OAuth allowlist and MCP bearer checks. Keep private credentials out of GitHub, Notion, client-side code and logs.
- Avoid paid Directions5 calls and unbounded API traffic. Do not enable billable APIs without explicit consent and enforceable budget/rate limits.
- The private Cloudflare Worker and public GitHub Pages Notion map-only widget are different trust boundaries. Do not expose private account data through the public embed.
- Run `npm test` for backend edits. Verify commit, tests, Cloudflare deployment and live API behavior separately; never equate one with all.
- Do not schedule repetitive GitHub Actions or MCP polling without a clear user request.
