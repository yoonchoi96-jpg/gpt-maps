# GPT Maps — 네이버 계정 전용 로그인 배포 안내

> 현재 상태: GitHub 저장소에 인증 서버 코드까지 작성했습니다. 네이버 로그인 OAuth 앱 발급, Cloudflare Worker 배포, 실로그인 검증은 **아직 필요**합니다. 서비스가 배포되거나 본인 로그인에 성공한 것으로 오해하지 마세요.

## 무엇이 달라지나?

- 기존 공개 사이트: https://yoonchoi96-jpg.github.io/gpt-maps/ 는 **여전히 공개**입니다. 지금 단계에서 로그인에 의해 보호되지 않습니다.
- 추가할 비공개 사이트: Cloudflare Workers가 제공하는 실제 URL. 로그인 전에는 지도 HTML/정적 에셋을 제공하지 않습니다.
- 권한 판정 기준: 네이버 *로그인 OAuth 앱*의 회원 프로필 \`response.id\`. 네이버 로그인명·이메일·지도 Client ID가 아닙니다.
- 네이버 지도 저장 장소·즐겨찾기 데이터는 네이버 로그인 API로 제공되지 않으며, 이 기능은 구현 범위에 **포함되지 않습니다**.

## 1. Cloudflare 무료 Worker 생성

1. https://dash.cloudflare.com/ 접속. 무료 계정이 없으면 생성.
2. **Workers & Pages > Create application** 메뉴에서 **GitHub 리포지토리 연결** 선택.
3. 개인 GitHub 계정 권한을 연결하고 저장소 \`yoonchoi96-jpg/gpt-maps\`를 선택.
4. **Worker 이름 \`gpt-maps-private\`** (저장소 최상위 \`wrangler.jsonc\`의 name과 일치해야 함).
5. Build command: 공란. Deploy command: \`npx wrangler deploy\`. Root directory: 저장소 루트 \`/\`. 브랜치: \`main\`.
6. 배포 후 Cloudflare가 표시하는 실제 주소를 확인. 형식:
   \`https://gpt-maps-private.<YOUR_CLOUDFLARE_SUBDOMAIN>.workers.dev\`
   이 주소는 **예시 형식**입니다. 대괄호 부분을 그대로 등록하면 안 됩니다.

첫 배포 시 Worker가 503 \`Setup required\`를 반환해도 정상입니다. 아직 인증용 환경변수가 없기 때문입니다.

Cloudflare 공식 GitHub 연동: https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/
Worker 설정: https://developers.cloudflare.com/workers/ci-cd/builds/configuration/

## 2. NAVER Developers — 별도의 로그인 애플리케이션 등록

[네이버 개발자센터](https://developers.naver.com/apps/#/register)에서 앱을 생성합니다.

- Application name: \`GPT Maps Login\`
- 사용 API: **네이버 로그인**
- 필요한 프로필 동의 항목: 최소화. 회원 식별용 \`response.id\`가 핵심입니다.
- 서비스 환경: **PC 웹**.
- 서비스 URL: 1단계에서 배포된 **실제** Cloudflare Worker URL.
- 네이버 로그인 Callback URL: \`<실제 Worker URL>/auth/callback\`.

예시: \`https://gpt-maps-private.example.workers.dev/auth/callback\`

Callback URL은 정확히 일치해야 합니다. 네이버 클라우드 **Maps Client ID**(\`napr2ensb6\`)와 로그인용 **NAVER Developers Client ID**는 **완전히 별도**입니다.

발급된 로그인용 **Client Secret은 GitHub, ChatGPT 채팅, URL에 넣지 마세요.**

NAVER 공식 로그인 API: https://developers.naver.com/docs/login/api/api.md

## 3. Cloudflare Worker 비밀값 설정

Cloudflare **Workers & Pages > gpt-maps-private > Settings > Variables and Secrets**에서 아래 값을 등록합니다.

| 이름 | 유형 | 값 |
|---|---|---|
| \`APP_ORIGIN\` | Text 또는 Secret | 실제 Worker 주소, 마지막 \`/\` 제외 |
| \`NAVER_LOGIN_CLIENT_ID\` | Secret 권장 | 네이버 개발자센터 로그인 앱 Client ID |
| \`NAVER_LOGIN_CLIENT_SECRET\` | **Secret** | 네이버 개발자센터 로그인 앱 Client Secret |
| \`SESSION_SECRET\` | **Secret** | 암호학적으로 임의 생성한 32바이트 이상의 시크릿 |
| \`ALLOWED_NAVER_USER_ID\` | **첫 로그인 후 추가할 Secret** | 내 네이버 OAuth 프로필 \`response.id\` |

\`SESSION_SECRET\` 생성: Mac 터미널에서 \`openssl rand -hex 32\` 실행 후 **결과를 Cloudflare Secret에만** 등록합니다.

Secret 변경 후 서버 설정이 적용됐는지 Cloudflare 대시보드에서 재확인하세요.

Cloudflare 공식 Secret 가이드: https://developers.cloudflare.com/workers/configuration/secrets/

## 4. 최초 로그인으로 본인 계정 ID 확인

1. \`APP_ORIGIN\` 및 필수 3개 인증 값을 등록하고 브라우저에서 \`<Worker URL>/health\`를 엽니다.
2. \`active:true\`, \`owner_bound:false\`인지 확인합니다.
3. \`<Worker URL>/auth/login\`에 접속하여 **본인의 네이버 계정으로 로그인**합니다.
4. 네이버 인증 후 \`ALLOWED_NAVER_USER_ID\`가 비어 있다면 앱 전용 프로필 고유 ID를 **403 안내 화면**에 보여줍니다. 아직 계정 접근이 허용된 것은 아닙니다.
5. 이 ID가 본인 로그인 과정에서 발급되었는지 확인하고 Cloudflare의 \`ALLOWED_NAVER_USER_ID\` Secret에 붙여 넣습니다. **첫 번째 방문자를 자동 승인하지 않습니다.**
6. 로그인 페이지로 돌아가 다시 로그인합니다.
7. 정상 로그인 시 Worker 루트 \`/\`로 이동하고, **인증된 사용자만** 지도 HTML을 받습니다.
8. 다른 네이버 계정으로 로그인하면 403 /denied가 나오는지 확인합니다.

네이버의 ID는 네이버 계정 ID/이메일이 아니며, 로그인 OAuth 앱별로 달라집니다.
공식 프로필 API: https://developers.naver.com/docs/login/profile/profile.md

## 5. NAVER Cloud Maps — 허용 도메인 추가

네이버 클라우드 Maps Application 관리 화면:
https://console.ncloud.com/maps/application

기존 \`Dynamic Map\` Client ID \`napr2ensb6\`가 허용하는 웹 서비스 URL에 다음 **실제 Worker 원본(origin)**을 추가해야 합니다.

\`https://gpt-maps-private.<YOUR_CLOUDFLARE_SUBDOMAIN>.workers.dev\`

기존 GitHub Pages 웹 URL과 새 Worker URL을 구분하세요. Cloudflare Origin에 권한을 주지 않으면 OAuth 로그인은 성공해도 지도가 인증 오류로 표시될 수 있습니다.

무료 사용량 보호를 위해 지도 호출 한도를 확인하고 초과 사용 비허용을 설정하세요.

## 6. 보호 범위 및 Notion 제약

- Worker에서 제공하는 웹사이트만 로그인 보호를 받습니다. **GitHub Pages 공개 URL은 그대로 공개**입니다.
- 보호된 Worker는 HTML 및 정적 에셋 요청 앞에서 로그인 검사를 수행하며, 세션 쿠키는 HttpOnly, Secure, SameSite=Lax이고 HMAC 서명과 만료 시각을 확인합니다.
- 정적 GitHub Pages를 계정 전용으로 바꾸려면 **기존 공개 사이트를 안내/리다이렉트 페이지로 변경하거나 Pages 자체를 비활성화**해야 합니다. Worker 도메인만 새로 만들었다고 기존 공개 페이지가 사라지지 않습니다.
- 보호된 페이지는 보안상 현재 iframe 삽입을 거부하며, Notion 내 개인 로그인 임베드는 **아직 제공하지 않습니다**. 웹브라우저에서 보호된 지도를 직접 여는 방식이 기본입니다. Notion에서 사용하려면 별도 인증 및 임베드 설계를 해야 합니다.
- 외부 로그인 서비스의 Client Secret, 토큰, 세션키를 지도 URL, 소스 코드, Notion DB, 사용자 채팅에 올리지 마세요.

## 7. 테스트

GitHub 파일이 실제로 배포되었는지 확인하고 다음을 검사합니다.

- [ ] Worker URL의 \`/health\` 응답 (실제 배포 확인)
- [ ] 비로그인으로 \`/\` 접근 시 NAVER 로그인으로 이동
- [ ] 무작위 \`state\`와 CSRF 검증
- [ ] 본인 계정 로그인 시 / 루트 지도 화면이 표시
- [ ] 다른 계정 로그인 시 403 거부
- [ ] \`POST /auth/logout\` 로그아웃으로 세션 종료
- [ ] NAVER Maps 허용 도메인 등록 후 실제 지도가 표시
- [ ] API 과금 한도/예산/알림 정책 확인

테스트 소스: \`worker/tests/auth.test.mjs\`.
개발 환경의 Node.js 20+에서 \`npm test\`로 테스트하세요. **이 리포지토리에 파일을 저장한 것과 테스트 실행 성공은 별개입니다.**

## 배포 전 체크

Cloudflare 계정 및 배포 권한, 네이버 로그인 앱 발급, Cloudflare Secret 등록, 실제 콜백 인증은 이 저장소에 파일을 생성하는 GitHub API만으로 자동 완료할 수 없습니다.
