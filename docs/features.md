# GPT Maps — 개인 네이버 계정 지도 기능

## 접속
- [내 계정 전용 GPT Maps](https://gpt-maps-private.yoonchoi-96.workers.dev/)
- [개인 비공개 Notion 페이지](https://app.notion.com/p/401ec954707481b3bc19e6a349f3dd92?pvs=204)
- 개인 NAVER OAuth 로그인은 기존에 성공했으며 허용 계정만 Worker에서 접근할 수 있습니다.

## 장소 검색과 핀
- 인증된 소유자의 `GET /api/places?q=`는 공용 `hubSearch` 구현으로 NAVER API HUB 지역 검색을 호출합니다.
- 상류: `https://naverapihub.apigw.ntruss.com/search/v1/local`, 서버 전용 HUB 자격증명 두 개를 사용합니다. 로그인 앱 키로 대체하거나 구형 검색 API로 재시도하지 않습니다.
- `NAVER_API_HUB_ENABLED=true`와 HUB Secret 두 개가 모두 있어야 기능 상태가 활성화됩니다. NCP 앱 이용 한도 설정은 별도로 유지해야 합니다.
- 기존 화면/MCP 응답 `{query, places: [{id, name, category, address, lat, lng}], total}`을 유지합니다. 검색은 명시적 제출당 최대 5건, 순서 유지 및 좌표 변환을 적용합니다.
- HUB 401/403은 키·API 권한 확인을 안내하는 403, 429는 한도 오류로 전달하며 자동 재시도하지 않습니다. 브라우저 세션이 없으면 별도로 401입니다.
- [NAVER API HUB 공식 지역 검색 문서](https://api.ncloud-docs.com/docs/naver-api-hub-search-local)

## 길찾기
- 자동차 길찾기: 공식 네이버 지도 앱 URL Scheme (설치된 앱 필요), 데스크톱은 네이버 지도 웹 검색 버튼.
- 서버 내 Directions5 API 경로선 코드는 준비했지만 기본 비활성화입니다. ENABLE_PAID_DIRECTIONS=true 및 NAVER_MAPS_CLIENT_SECRET이 모두 있어야 호출됩니다.
- 유료 경로 API 사용은 사용자 승인과 과금 방지 장치 구축 전에는 활성화하지 않습니다.
- [공식 Directions5 문서](https://api.ncloud-docs.com/docs/application-maps-directions5)

## Notion
- 별도 비공개 Notion GPT Maps 페이지를 생성했습니다.
- 지도 링크 복사, 선택 장소 Notion 메모 복사, Notion 페이지 열기 기능을 제공합니다.
- **공개 지도 전용 위젯**은 Notion 페이지에 실제 임베드했습니다 (`https://yoonchoi96-jpg.github.io/gpt-maps/?embed=1`). 사용자 전용 OAuth 지도·장소 검색·길찾기는 보호된 Worker에서 사용합니다. 양방향 Notion 자동 저장은 미구현입니다.
- [Notion 공식 임베드 제약](https://www.notion.com/help/embed-and-connect-other-apps)

## 보안·비용
- API 키는 Worker 서버 Secret에만 보관하며 사용자 요청은 본인 NAVER 계정 세션으로 인증됩니다.
- Search는 기존 HUB 활성화 조건과 NCP 쿼터를 사용합니다. 앱 자체 전역 강제 요청 제한은 없으며 이번 수정은 과금·쿼터 설정을 변경하지 않습니다.
- Directions5는 기본 비활성화. Dynamic Map의 사용량 과금 가능성은 NAVER Cloud에서 별도로 확인하세요.
- 로그인했다고 네이버 지도에 저장해 둔 장소가 자동 동기화되는 것은 아닙니다. 공식 API 지원 확인되지 않음.
- 기존 GitHub Pages 페이지는 공개로 남아 있으며 비공개 접근은 Cloudflare Worker 주소에만 적용됩니다.

## 테스트
Node 20+에서 npm test 명령으로 worker/tests/*.test.mjs를 실행할 수 있습니다. 파일 생성만으로 통합 테스트가 성공했다고 단정하지 않습니다.
