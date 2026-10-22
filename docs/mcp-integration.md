# NAVER Maps private remote MCP

## 상태 (2026-10-23)

- 원격 MCP 서버: https://gpt-maps-private.yoonchoi-96.workers.dev/mcp
- 구현: Cloudflare Worker, stateless Streamable HTTP, JSON-RPC 2.0 (`2025-06-18`).
- 독립 서버/유료 API/주기 실행 없음. 기존 NAVER 계정 검증 및 개발자센터 Local Search API 재사용.
- **중요:** ChatGPT Plus 계정에는 사용자 제작 원격 MCP를 ChatGPT 플러그인으로 추가하는 기능이 제공되지 않습니다 (2026-10-23 OpenAI 공식 문서 기준). 따라서 ChatGPT 안의 GPT-6에 직접 연결되었다고 표시하지 않습니다.
- 이 버전은 OAuth 인증 서버를 제공하지 않습니다. Authorization Bearer 헤더를 구성할 수 있는 호환 MCP 클라이언트 전용입니다.

## 네이버 계정 소유자만 접근

1. 개인 지도에서 NAVER 계정 로그인: https://gpt-maps-private.yoonchoi-96.workers.dev/
2. 페이지 오른쪽 `외부 MCP 클라이언트 인증 토큰 발급·복사` 버튼을 본인이 직접 클릭합니다.
3. 12시간 유효한 `Bearer ...` 인증 헤더가 클립보드에 복사됩니다. **토큰을 채팅, 저장소, 노션, 로그에 입력하지 않습니다.**
4. 호환 MCP 클라이언트에 HTTPS 서버 주소 `/mcp`와 HTTP 헤더 `Authorization: Bearer <token>`을 직접 입력합니다.
5. 만료되면 다시 본인 로그인 후 새 토큰을 발급합니다. 긴급 무효화가 필요하면 Cloudflare의 `SESSION_SECRET`을 교체하여 모든 기존 로그인 세션과 MCP 토큰을 함께 무효화할 수 있습니다.
6. MCP 서버는 서명 검증 실패·만료·소유자 계정 ID 변경 시 401을 반환합니다. 허용 계정 ID와 시크릿은 도구 호출 결과에 나타나지 않습니다.

## 도구

| MCP tool | 설명 | 과금 가능성 |
| --- | --- | --- |
| `search_naver_places` | 한국 장소 검색, 주소와 좌표 (최대 5건) | 네이버 Developers 검색 API 쿼터 사용 |
| `create_map_link` | 위경도 중심 개인 지도 URL 생성, 저장은 하지 않음 | 추가 API 호출 없음 |
| `create_naver_driving_link` | 네이버 지도 앱 자동차 길찾기 딥링크 + 웹 검색 링크 | 유료 Directions 호출 없음 |
| `get_naver_maps_status` | 설정·활성 도구 목록 확인 | 추가 API 호출 없음 |

별도 `get_naver_driving_route` 도구는 서버에 `ENABLE_PAID_DIRECTIONS=true`와 `NAVER_MAPS_CLIENT_SECRET`을 모두 설정한 경우에만 목록에 나타납니다. **현재 비활성화** 상태입니다.

## 검색 권한

네이버 [개발자센터](https://developers.naver.com/apps/)의 로그인 앱 `Omari`에 `검색` API 권한이 있어야 실제 지역 검색이 성공합니다. 이 권한이 없으면 도구가 오류를 반환하며 결과를 만들어내지 않습니다.

## 프로토콜 호출 예시

요청 URL: `POST https://gpt-maps-private.yoonchoi-96.workers.dev/mcp`

헤더: `Authorization: Bearer <owner-issued-short-lived-token>`와 `Content-Type: application/json`

JSON body:
```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0"}}}
```

`tools/list` 요청:
```json
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
```

`tools/call` 예:
```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"create_map_link","arguments":{"latitude":37.56668,"longitude":126.97841,"title":"서울 시청"}}}
```

공개된 토큰 없이 `/mcp`에 접근하면 401입니다. 브라우저 주소창에서 GET `/mcp`로 호출하는 방식은 MCP 연결 테스트가 아닙니다.

## 테스트·제약

- GitHub repo: https://github.com/yoonchoi96-jpg/gpt-maps
- 정적 코드 검증 및 Cloudflare 자동 배포는 별도로 확인합니다.
- `npm test` 실행 시 `worker/tests/mcp.test.mjs`와 기존 로그인/Places 테스트를 함께 실행합니다.
- `.github/workflows/mcp-smoke.yml`은 소스 변경 또는 수동 실행에만 반응하며, 주기 반복 실행하지 않습니다.
- Notion 개인 페이지의 임베드는 공개용 지도 위젯이고 OAuth 로그인이 필요한 개인 MCP 서버는 iframe 안에 노출하지 않습니다.
- 서비스 자체의 실제 end-to-end MCP HTTP 호출과 NAVER 지역 검색 권한/쿼터는 실제 인증된 클라이언트로 추가 검증해야 합니다.
- 추후 ChatGPT 직접 연결이 가능해져도 현재의 수동 Bearer 인증 서버로는 충분하지 않을 수 있으며 OAuth 구현 및 ChatGPT 계정 연결 권한이 필요합니다.

관련 문서:
- Cloudflare: https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/
- ChatGPT: https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt
