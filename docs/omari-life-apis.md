# Omari · 생활 API 9종 연동

**2026-10-23 구현 상태:** 현재 연결 가능한 `yoonchoi96-jpg/gpt-maps` 저장소의 보호된 Cloudflare Worker에 9개 공급자 그룹, 10개 읽기 작업, 상태 대시보드, MCP 2개 도구를 추가했다. 이는 Omari 전체 저장소를 찾거나 수정했다는 의미가 아니다. 기존 NAVER 지도·로그인·검색 코드는 보존한다. **모든 신규 공급자 호출은 기본 비활성화**이며, 키 발급·활용신청·실제 upstream 성공은 아직 확인되지 않았다.

## 연결 상태 확인

- 개인 웹 UI: `https://gpt-maps-private.yoonchoi-96.workers.dev/` 로그인 후 **Omari · 생활 API 9종** 패널.
- 로그인 필수 GET `/api/life/status`: 각 서비스의 설정 여부·기능 목록. 인증키 값은 반환하지 않는다.
- 로그인 필수 GET `/api/life/query?action=<작업>&...`: 아래에서 정의한 고정 작업만 허용.
- MCP 도구: `get_omari_life_status`, `query_omari_life_api` (기존 `/mcp` bearer/owner 인증 필수). `query_omari_life_api`는 `{action,params}` 형태.
- 신규 호출은 예약 실행·자동 폴링하지 않는다. 모든 HTTP 외부 요청은 소유자가 실제 조회를 요청한 경우에만 발생한다.
- PublicData 인증키를 공유해도 각 API의 **활용신청 및 승인**은 별도로 필요하다.

## 서비스·요청 예시·필요 Secret

| 우선순위 | 서비스 (action) | Secret | 활성화 플래그 | 조회 파라미터 / 주의 |
|---|---|---|---|---|
| P0 | 전국 TAGO 정류장 버스도착 `bus_arrivals` | `DATA_GO_KR_SERVICE_KEY` | `OMARI_LIFE_PUBLIC_ENABLED` | `cityCode`, `nodeId`. 도시별 제공 범위 확인 |
| P0 | 기상청 초단기 실황 `weather_now` | 동일 | 동일 | `baseDate=YYYYMMDD`, `baseTime=HHmm`, `nx`, `ny` (기상청 격자 좌표) |
| P0 | 에어코리아 측정소 `air_quality` | 동일 | 동일 | `stationName` (측정소명) |
| P0 | 한국관광공사 국문 TourAPI `tour_search` | 동일 | 동일 | `keyword` 2~60자 |
| P1 | TAGO 국내선 운항목록 `flight_domestic` | 동일 | 동일 | `departure`, `arrival` (공항코드). **실시간 지연/결항 또는 국제선 조회가 아님** |
| P1 | 한국은행 ECOS `ecos_series` | `ECOS_API_KEY` | `OMARI_LIFE_PUBLIC_ENABLED` | `statCode`, `cycle`, `start`, `end`, 선택 `itemCode` |
| P1 | 국토부 아파트 매매 `apt_sales` | `DATA_GO_KR_SERVICE_KEY` | `OMARI_LIFE_PUBLIC_ENABLED` | `districtCode`(법정동 5자리), `month`(YYYYMM). **XML 원문 일부 반환**, 매매신고·수정 가능 |
| P1 | YouTube 동영상 메타데이터 `youtube_video` | `YOUTUBE_DATA_API_KEY` | `OMARI_YOUTUBE_ENABLED` | `videoId`(11자리), `videos.list` 조회. 검색·업로드·댓글 쓰기 없음 |
| P2 | Google Places 텍스트 검색 `places_text_search` | `GOOGLE_PLACES_API_KEY` | `OMARI_GOOGLE_PLACES_ENABLED` **및** `OMARI_GOOGLE_PLACES_BILLING_APPROVED` | `query` 2~80자, 3건, ID·명칭·주소 필드만. **사용량 과금 API, 사용자가 비용 승인 전 절대 켜지 말 것** |
| P2 | Home Assistant 센서 `ha_sensor` | `HOME_ASSISTANT_TOKEN`, `HOME_ASSISTANT_URL` | `OMARI_HOME_ASSISTANT_ENABLED` | `entityId`가 `sensor.`, `binary_sensor.`, `weather.`인 경우만 읽음. 기기제어 불가 |

### 발급 및 승인

1. [공공데이터포털](https://www.data.go.kr/)에서 가입·인증키 발급 후 각각 활용 신청:
   - [TAGO 버스도착정보](https://www.data.go.kr/data/15098530/openapi.do)
   - [기상청 단기예보](https://www.data.go.kr/data/15084084/openapi.do)
   - [에어코리아 대기오염정보](https://www.data.go.kr/data/15073861/openapi.do)
   - [TourAPI 국문 관광정보](https://www.data.go.kr/data/15101578/openapi.do)
   - [TAGO 국내항공운항정보](https://www.data.go.kr/data/15098526/openapi.do)
   - [국토부 아파트 매매 실거래가](https://www.data.go.kr/data/15126469/openapi.do)
2. [한국은행 ECOS](https://ecos.bok.or.kr/api/)에서 통계표·코드 확인 및 별도 키 신청.
3. [Google Cloud API Library](https://console.cloud.google.com/apis/library)에서 YouTube Data API v3 활성화, API 키 제한 및 **할당량 축소**. `videos.list`만 구현, `search.list`는 호출하지 않는다.
4. [Google Places API (New)](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing/)는 별도 과금·결제 설정 필요. 현재 **비활성화**. 가격은 필드 마스크와 SKU에 따라 달라지며, 단순 사용량 알림은 지출 차단 수단이 아니다. 사용자 명시 승인과 실제 할당량 상한 확인 전 플래그를 켜지 않는다.
5. [Home Assistant REST API](https://developers.home-assistant.io/docs/api/rest/)의 Long-Lived Access Token 사용. 인터넷에서 접근 가능한 **본인 관리 HTTPS** 주소가 있어야 한다. Cloudflare Worker는 LAN의 `192.168.x.x`나 `.local`에 직접 접속하지 못한다. 공개 프록시를 설치하거나 포트 개방을 자동 수행하지 않는다. OAuth/HA 토큰을 채팅에 넣지 않는다.

### Cloudflare Secret 설정

Worker `gpt-maps-private`의 **Variables and Secrets**에 필요한 값만 `Secret` 유형으로 저장:

```text
DATA_GO_KR_SERVICE_KEY
ECOS_API_KEY
YOUTUBE_DATA_API_KEY
GOOGLE_PLACES_API_KEY
HOME_ASSISTANT_URL
HOME_ASSISTANT_TOKEN
```

모든 신규 기능의 기본 플래그는 `wrangler.jsonc`에서 `false`이다:

```text
OMARI_LIFE_PUBLIC_ENABLED=false
OMARI_YOUTUBE_ENABLED=false
OMARI_GOOGLE_PLACES_ENABLED=false
OMARI_GOOGLE_PLACES_BILLING_APPROVED=false
OMARI_HOME_ASSISTANT_ENABLED=false
```

PublicData 키 등록과 개별 API 승인·사용량 제한을 확인한 뒤에만 `OMARI_LIFE_PUBLIC_ENABLED`를 켜고 단일 요청으로 실사용 검증한다. **한 공급자 인증 오류는 다른 공급자 연결 성공을 뜻하지 않는다.** `OMARI_GOOGLE_PLACES_BILLING_APPROVED`는 이번 작업에서 켜지 않는다. `HOME_ASSISTANT_URL`은 HTTPS 도메인만 지원하며 내부 IP나 localhost를 허용하지 않는다.

### 보안/과금/기술적 한계

- 웹 API는 기존 NAVER 로그인 세션 소유자만 접근. MCP는 기존 12시간 Bearer 또는 소유자 세션 필요. 외부 공개 프록시·임의 URL fetch 없음.
- 외부 URL은 고정된 공식 제공기관으로 제한. `redirect:"manual"`, 7초 타임아웃, 120KB 응답 제한, 목록 최대 10건. Home Assistant는 센서 값과 이름/단위만 전달한다.
- 공공데이터 XML을 JSON으로 오인하지 않는다. `apt_sales`는 현재 최대 12KB XML 일부를 반환하며, 완전한 구조화 분석은 후속 개발 대상.
- Google Places 결과에는 ID·표시명·주소만 요청해 필드 마스크 비용을 낮춘다. 이 또한 **유료 호출**이므로 승인 전 금지.
- YouTube Data API는 할당량이 있으며 호출당 소모량은 API별로 다르다. 현재 `videos.list`는 1 단위.
- `lifeStatus`는 인증키 바인딩과 플래그만 검증. 외부 API 응답, 활용승인, 데이터 최신성, 정확성은 실제 조회 전까지 미확인.
- 특정 기관 API가 변경되거나 데이터포털에서 별도 승인받아야 할 경우 403/502로 처리하며, 호출량을 자동 재시도해 늘리지 않는다.
- `npm test`로 단위 테스트. GitHub Actions는 소스 변경 때만 실행하며 정기 호출 없음.
- 실제 사용 전에 Cloudflare 배포와 테스트 결과를 확인하고, 실패한 API의 호출을 반복하지 않는다.

## 실제 이용 순서

1. 먼저 **공공데이터포털 인증키 + API별 승인** → Cloudflare Secret 등록.
2. ECOS·YouTube 별도 키 등록 및 제한 설정.
3. 승인된 무료 조회만 단계적으로 켜고, 개별 API 실제 응답 확인.
4. Home Assistant는 HTTPS 연결과 토큰 보호를 별도 검증.
5. Google Places는 비용과 상한을 명시적으로 승인받기 전까지 **계속 비활성화**.

**Omari 본체 별도 저장소/러너에 이식하려면 해당 저장소 연결 권한이 필요하다.** 현재 구현은 접근 가능한 GPT Maps Cloudflare Worker + MCP에 포함된 모듈이다.
