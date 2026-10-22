# NAVER 개인 계정 연결 설계 (Owner-only login)

이 문서는 **미구현 상태의 연동 준비 가이드**입니다. 현재 지도 사이트는 공개 GitHub Pages이며, NAVER 계정 로그인과 사용자별 데이터 연동 기능은 아직 연결되지 않았습니다.

## 구분

- NAVER Cloud Maps Client ID: 지도 렌더링용 식별자. 사용자 로그인 권한이 아님.
- NAVER Developers Login Client ID: 별도 OAuth 앱의 공개 식별자.
- NAVER Developers Login Client Secret: **비밀키**, 서버측 Secret에만 보관.
- NAVER 로그인 고유 사용자 ID (`response.id`): ID/이메일/닉네임이 아닌 공식 고유 사용자 식별값.
- 네이버 지도 '저장한 장소'는 공개된 로그인 OAuth API로 조회할 수 있는 항목에 포함되어 있지 않음. 로그인만 구현해도 지도 즐겨찾기는 동기화되지 않음.

## 사용자 준비

1. https://developers.naver.com/apps/#/register 에서 별도 앱 이름 **GPT Maps Login** 등록.
2. 사용 API로 **네이버 로그인** 선택, 필요한 최소 프로필 동의 항목만 요청.
3. 서비스 환경 **PC 웹** 등록: `https://yoonchoi96-jpg.github.io/gpt-maps/`
4. **Callback URL**은 인증 백엔드가 실제 배포된 뒤, 해당 백엔드의 정확한 HTTPS URL로 등록. 임의의 URL이나 작동하지 않는 정적 파일을 설정하지 말 것.
5. Login Client ID만 연동 코드 설정에 사용; **Client Secret은 GitHub나 채팅에 절대 입력하지 말 것.**

## 원격 인증 백엔드 필수

GitHub Pages는 정적 공개 호스팅이므로 **진정한 본인 전용 비공개 지도**를 제공하지 않습니다. 프런트엔드 JavaScript로 '허용 계정 ID'를 비교하는 방식은 우회할 수 있어 사용 금지.

추천 방향: 무료 한도 내에서 Cloudflare Worker(별도 계정 필요) 또는 전용 HTTPS 서버리스 백엔드 구축. 인증 비밀 정보는 서버측 Secret 설정.

보안 흐름:

1. 서버가 `state` 와 OAuth/OIDC 코드 챌린지 등 필요한 검증값을 생성.
2. 공식 네이버 인증 페이지로 리다이렉트.
3. 서버에서 NAVER Callback 처리, state 검증, 인증 코드를 access token으로 교환.
4. 서버에서 공식 NAVER 프로필 endpoint를 호출해 `response.id` 확인.
5. 최초 계정 바인딩은 운영자가 본인 계정임을 별도 검증한 뒤 **서버측 ALLOWED_NAVER_USER_ID**로 고정. 먼저 로그인하는 아무나 자동 등록하지 말 것.
6. 등록된 ID와 불일치하면 403 반환.
7. 등록된 ID인 경우 Secure, HttpOnly, SameSite 세션 쿠키 발급. 토큰은 브라우저 URL, GitHub, Notion 공유 URL에 노출 금지.
8. 공개적으로 사이트 자체를 제한해야 한다면 정적 페이지도 인증 프록시 뒤에서 제공해야 함. 사용자별 개인 데이터만 보호할 경우 공개 정적 페이지 + 인증 전용 API로 분리 가능.
9. Notion embed는 제3자 쿠키 차단, iframe 로그인/헤더 제한이 있을 수 있어 로그인 후 실제 임베드가 작동하는지 별도 테스트 필요.

Cloudflare Workers 무료 계층: https://developers.cloudflare.com/workers/platform/limits/
Secret 관리: https://developers.cloudflare.com/workers/configuration/secrets/
NAVER Login 개발가이드: https://developers.naver.com/docs/login/devguide/devguide.md
NAVER Login API: https://developers.naver.com/docs/login/api/api.md
NAVER 프로필 API: https://developers.naver.com/docs/login/profile/profile.md
GitHub Pages 공개성: https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site

## 현재 상태

- ✅ GitHub Pages NAVER 지도: 공개, Client ID 자동 로딩
- ⏳ NAVER Developers Login 앱 등록: 필요
- ⏳ 서버 OAuth callback, 본인 확인, 세션 제어: 미구현
- ⏳ 계정 인증 완료 및 비공개 접근 테스트: 미구현
- ❌ NAVER 지도 내 저장 장소 자동 동기화: 공식 공개 API 미확인
