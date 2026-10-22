import { featureRequest } from "./places-and-routes.js";
/**
 * GPT Maps - NAVER owner-only login gateway.
 * Deployed as a Cloudflare Worker WITH worker/public static assets.
 * Fail-closed: all assets pass through this Worker before being served.
 * NEVER publish NAVER_LOGIN_CLIENT_SECRET or SESSION_SECRET.
 */
const STATE_COOKIE = "__Host-gptmaps_oauth";
const SESSION_COOKIE = "__Host-gptmaps_session";
const STATE_TTL = 600;
const SESSION_TTL = 86400; // 24 hours

function headers(extra = {}) {
  return {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "frame-ancestors 'none'",
    ...extra,
  };
}
function reply(text, code = 200) {
  return new Response(text, {
    status: code,
    headers: headers({"Content-Type": "text/plain; charset=utf-8"}),
  });
}
function json(value, code = 200) {
  return new Response(JSON.stringify(value), {
    status: code,
    headers: headers({"Content-Type": "application/json; charset=utf-8"}),
  });
}
function redirect(path, cookies = []) {
  const h = new Headers(headers({Location: path}));
  for (const c of cookies) h.append("Set-Cookie", c);
  return new Response(null, {status: 303, headers: h});
}
function cookie(value, data, maxAge) {
  return value + "=" + encodeURIComponent(data)
    + "; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=" + maxAge;
}
function cookieValue(request, key) {
  const values = (request.headers.get("Cookie") || "").split(";");
  for (const part of values) {
    const i = part.indexOf("=");
    if (i < 0 || part.slice(0,i).trim() !== key) continue;
    try { return decodeURIComponent(part.slice(i+1).trim()); } catch { return null; }
  }
  return null;
}
function base64url(data) {
  let s = ""; for (const byte of data) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function fromBase64url(str) {
  if (!/^[A-Za-z0-9_-]+$/.test(str)) throw new Error("invalid encoding");
  const s = atob(str.replace(/-/g,"+").replace(/_/g,"/"));
  return Uint8Array.from(s, (x) => x.charCodeAt(0));
}
function randomState() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}
async function hmacKey(env) {
  return crypto.subtle.importKey("raw",
    new TextEncoder().encode(env.SESSION_SECRET),
    {name:"HMAC", hash:"SHA-256"}, false, ["sign", "verify"]);
}
async function createSession(id, env) {
  const payload = {
    sub: id, exp: Math.floor(Date.now()/1000) + SESSION_TTL, v: 1,
  };
  const body = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env), new TextEncoder().encode(body));
  return body + "." + base64url(new Uint8Array(sig));
}
async function authorized(request, env) {
  if (!env.SESSION_SECRET || !env.ALLOWED_NAVER_USER_ID) return false;
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token || token.length > 4096) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  try {
    const valid = await crypto.subtle.verify("HMAC", await hmacKey(env),
      fromBase64url(parts[1]), new TextEncoder().encode(parts[0]));
    if (!valid) return false;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(parts[0])));
    return payload.v === 1
      && typeof payload.exp === "number"
      && payload.exp > Math.floor(Date.now()/1000)
      && payload.sub === env.ALLOWED_NAVER_USER_ID;
  } catch {return false;}
}
function cleanText(s) {
  return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
}
function deniedOwnerPage(id, expireState) {
  // Show only the current authenticated user's app-scoped NAVER ID to that
  // same user; do not disclose the allowlisted account ID or secrets.
  const safe = cleanText(id);
  const html = '<!doctype html><html lang="ko"><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>GPT Maps - 계정 불일치</title>'
    + '<body style="font:16px system-ui;margin:40px auto;padding:0 20px;max-width:650px;line-height:1.7;background:#101e28;color:#f2f5f6">'
    + '<h1>네이버 계정이 일치하지 않습니다</h1>'
    + '<p>네이버 로그인과 프로필 조회는 성공했습니다. '
    + '다만 현재 로그인한 계정의 고유 ID와 Cloudflare에 등록된 허용 ID가 정확히 일치하지 않습니다.</p>'
    + '<p>현재 로그인한 네이버 계정의 앱 고유 ID:</p>'
    + '<p style="padding:12px;background:#263744;border-radius:8px;overflow-wrap:anywhere"><code>'
    + safe + '</code></p>'
    + '<p>현재 ID와 최초 본인 인증 화면의 ID를 비교하세요. '
    + '다른 계정이라면 네이버에서 올바른 계정으로 로그인하고, '
    + '같은 계정이라면 Cloudflare의 ALLOWED_NAVER_USER_ID를 수정해야 합니다.</p>'
    + '<p><a style="color:#88e8cb" href="/auth/login">다른 계정으로 로그인</a></p>'
    + '<p style="font-size:14px;color:#a0b6c2">허용 계정 ID와 Client Secret은 이 화면에 표시되지 않습니다.</p>'
    + '</body></html>';
  const response = new Response(html,{status:403,headers:headers({
    "Content-Type":"text/html; charset=utf-8",
  })});
  response.headers.append("Set-Cookie",expireState);
  return response;
}
function pendingOwnerPage(id) {
  const safe = cleanText(id);
  const html = '<!doctype html><html lang="ko"><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>GPT Maps - 계정 확인</title>'
    + '<body style="font:16px system-ui;margin:40px auto;padding:0 20px;max-width:650px;line-height:1.7;background:#101e28;color:#f2f5f6">'
    + '<h1>네이버 계정 인증 성공</h1>'
    + '<p>보호된 지도를 열려면 Cloudflare Worker의 <code>ALLOWED_NAVER_USER_ID</code> 비밀값에 '
    + '아래 네이버 프로필 고유 ID를 직접 설정해야 합니다.</p>'
    + '<p style="padding:12px;background:#263744;border-radius:8px;overflow-wrap:anywhere"><code>' + safe + '</code></p>'
    + '<p>이 값은 네이버 로그인 ID나 이메일이 아니며, 앱마다 다르게 발급되는 식별자입니다.'
    + ' 타인이 아닌 본인 계정인지 확인한 뒤 등록하세요. 자동 승인되지는 않습니다.</p>'
    + '<p><a style="color:#88e8cb" href="/auth/login">다시 로그인</a></p></body></html>';
  return new Response(html, {status: 403, headers: headers({"Content-Type":"text/html; charset=utf-8"})});
}
async function diagnoseNaverNetwork() {
  // Temporary diagnostic endpoint: NEVER sends Client Secret, user codes,
  // session cookies or access tokens. Fixed allowlisted domains only.
  const checks = [
    {name:"naver_login_token_get",url:"https://nid.naver.com/oauth2.0/token",method:"GET"},
    {name:"naver_login_token_post",url:"https://nid.naver.com/oauth2.0/token",method:"POST"},
    {name:"naver_profile_get",url:"https://openapi.naver.com/v1/nid/me",method:"GET"},
  ];
  const results = [];
  for(const check of checks) {
    try {
      const options = {
        method:check.method,redirect:"manual",signal:AbortSignal.timeout(5000),
      };
      if (check.method === "POST") {
        options.headers = {"Content-Type":"application/x-www-form-urlencoded"};
        options.body = "grant_type=diagnostic_invalid";
      }
      const response = await fetch(check.url,options);
      results.push({
        name:check.name,
        connected:true,
        http_status:response.status,
        redirected:response.status>=300 && response.status<400,
        // Response bodies and Location URLs are intentionally not exposed.
      });
    } catch(error) {
      const message = String(error?.message||"");
      results.push({
        name:check.name,
        connected:false,
        error_type:error?.name === "TimeoutError"?"timeout":
          error?.name === "TypeError"?"fetch_type_error":"other",
        // Safe here: probes contain no sensitive URL parameters or credentials.
        // Limit messages to known non-sensitive diagnostic keywords.
        reason: /redirect/i.test(message)?"redirect_rejected":
          /timeout|timed out/i.test(message)?"timeout":
          /tls|ssl|handshake|certificate/i.test(message)?"tls":
          /dns|resolve|ENOTFOUND/i.test(message)?"dns":"unspecified",
      });
    }
  }
  return json({diagnostic:"naver_oauth_transport",credentials_sent:false,
    checks:results,temporary_probe:true});
}
function authErrorPage(reason) {
  // Never put NAVER auth codes, access tokens, raw responses, or secrets into the page.
  const messages = {
    state: "로그인 세션이 만료됐거나 브라우저 쿠키가 전달되지 않았습니다. 처음부터 다시 로그인하세요.",
    naver: "네이버에서 로그인을 거부하거나 취소했습니다. 네이버 개발자센터의 앱 설정을 확인하세요.",
    missing_code: "네이버에서 인증코드를 전달하지 않았습니다.",
    token: "네이버 인증코드 교환 과정에서 확인되지 않은 오류가 발생했습니다.",
    token_http_404: "네이버 토큰 서버 경로가 404를 반환했습니다.",
    token_http_429: "네이버 토큰 서버가 요청 제한(429)을 반환했습니다.",
    token_http_other: "네이버 토큰 API가 예상하지 못한 HTTP 상태를 반환했습니다.",
    token_provider_error: "네이버 토큰 API가 오류 응답을 반환했습니다. 네이버 로그인 앱 설정을 확인하세요.",
    token_nonjson: "네이버 토큰 서버가 JSON이 아닌 응답을 반환했습니다.",
    token_invalid_json: "네이버 토큰 서버의 JSON 응답이 손상되었거나 해석할 수 없습니다.",
    profile_network: "네이버 프로필 API에 대한 Cloudflare 요청이 실패했습니다.",
    profile_redirect: "네이버 프로필 API가 리다이렉트 응답을 반환했습니다.",
    profile_http_401: "네이버 프로필 조회 시 401(액세스 토큰 인증 실패)을 반환했습니다.",
    profile_http_403: "네이버 프로필 조회 시 403(호출 권한 없음)을 반환했습니다.",
    profile_http_other: "네이버 프로필 API가 정상 상태(200)를 반환하지 않았습니다.",
    profile_nonjson: "네이버 프로필 API가 JSON이 아닌 응답을 반환했습니다.",
    profile_invalid: "네이버 프로필 API 응답에서 이용자 식별자를 확인하지 못했습니다.",
    callback_internal: "OAuth 응답은 받았지만 인증 후속 처리에서 예상하지 못한 오류가 발생했습니다.",
    token_credentials: "네이버 개발자센터의 로그인용 Client ID와 Client Secret이 일치하지 않습니다. Cloudflare의 Secret을 다시 확인하세요.",
    token_code: "네이버의 인증코드가 유효하지 않거나 이미 사용됐습니다. 새 로그인에서 다시 시도하세요.",
    token_request: "네이버가 토큰 요청 형식을 거부했습니다. 서버 설정을 확인하세요.",
    token_http_400: "네이버 토큰 API가 400 오류를 반환했습니다. 인증 정보 또는 요청 형식을 확인하세요.",
    token_http_401: "네이버 토큰 API가 401 오류를 반환했습니다. 로그인 앱 Client ID/Secret 조합을 확인하세요.",
    token_http_403: "네이버 토큰 API가 403 오류를 반환했습니다. 앱 권한·설정을 확인하세요.",
    token_http_5xx: "네이버 토큰 서버가 일시적으로 오류를 반환했습니다.",
    token_network: "Cloudflare에서 네이버 토큰 서버에 접속하지 못했거나 요청이 리다이렉트되었습니다. 네트워크 진단 페이지로 연결 상태를 확인하세요.",
    token_redirect: "네이버 토큰 서버가 다른 페이지로 리다이렉트했습니다. 인증정보는 이동된 주소로 전송하지 않았습니다.",
    token_response: "네이버 토큰 응답을 해석할 수 없거나 액세스 토큰이 누락됐습니다.",
    profile: "인증 이후 네이버 사용자 식별자 조회에 실패했습니다.",
  };
  const key = Object.prototype.hasOwnProperty.call(messages,reason) ? reason : "naver";
  const body = '<!doctype html><html lang="ko"><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>GPT Maps 로그인 오류</title>'
    + '<body style="font:16px system-ui;margin:40px auto;padding:0 20px;max-width:600px;line-height:1.7;background:#101e28;color:#f2f5f6">'
    + '<h1>네이버 로그인 확인 필요</h1><p>'+messages[key]+'</p>'
    + '<p>오류 단계: <code>'+key+'</code></p>'
    + '<p><a href="/auth/login" style="color:#88e8cb">새 로그인 시도</a></p>'
    + '<p style="font-size:14px;color:#a0b6c2">네이버 앱 Client ID, 서비스 URL 및 Callback URL을 확인하세요. 인증코드나 비밀키는 공유하지 마세요.</p>'
    + '</body></html>';
  return new Response(body,{status:400,headers:headers({"Content-Type":"text/html; charset=utf-8"})});
}
function checkConfig(env, request) {
  if (!env.APP_ORIGIN || !/^https:\/\//.test(env.APP_ORIGIN)
      || new URL(request.url).origin !== env.APP_ORIGIN) {
    return "APP_ORIGIN is not set to this exact HTTPS worker origin.";
  }
  if (!env.NAVER_LOGIN_CLIENT_ID || !env.NAVER_LOGIN_CLIENT_SECRET || !env.SESSION_SECRET) {
    return "OAuth credentials and session secret are not configured.";
  }
  if (env.SESSION_SECRET.length < 32) return "SESSION_SECRET must be at least 32 characters.";
  return null;
}
async function exchangeCode(code, state, env) {
  // Naver Login OAuth2.0: POST form parameters from the public API spec.
  // Never place Client Secret, authorization code or access token in a URL,
  // browser response, console or logs.
  const args = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: env.NAVER_LOGIN_CLIENT_ID,
    client_secret: env.NAVER_LOGIN_CLIENT_SECRET,
    code, state,
  });
  let tokenResponse;
  try {
    tokenResponse = await fetch("https://nid.naver.com/oauth2.0/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
      },
      body: args.toString(),
      redirect: "manual",
    });
  } catch {
    throw new Error("token_network");
  }
  if (tokenResponse.status >= 300 && tokenResponse.status < 400)
    throw new Error("token_redirect");

  let token;
  const tokenType = (tokenResponse.headers.get("Content-Type") || "").toLowerCase();
  try {
    token = await tokenResponse.json();
  } catch {
    if (tokenResponse.status === 400) throw new Error("token_http_400");
    if (tokenResponse.status === 401) throw new Error("token_http_401");
    if (tokenResponse.status === 403) throw new Error("token_http_403");
    if (tokenResponse.status === 404) throw new Error("token_http_404");
    if (tokenResponse.status === 429) throw new Error("token_http_429");
    if (tokenResponse.status >= 500) throw new Error("token_http_5xx");
    throw new Error(tokenType.includes("json") ? "token_invalid_json" : "token_nonjson");
  }
  const e = typeof token?.error === "string" ? token.error.toLowerCase() : "";
  if (["unauthorized_client","invalid_client","024"].includes(e)) throw new Error("token_credentials");
  if (["invalid_grant","invalid_code"].includes(e)) throw new Error("token_code");
  if (e === "invalid_request") throw new Error("token_request");
  if (e === "server_error" || e === "temporarily_unavailable") throw new Error("token_http_5xx");
  if (e) throw new Error("token_provider_error");
  if (!tokenResponse.ok) {
    if (tokenResponse.status === 400) throw new Error("token_http_400");
    if (tokenResponse.status === 401) throw new Error("token_http_401");
    if (tokenResponse.status === 403) throw new Error("token_http_403");
    if (tokenResponse.status === 404) throw new Error("token_http_404");
    if (tokenResponse.status === 429) throw new Error("token_http_429");
    if (tokenResponse.status >= 500) throw new Error("token_http_5xx");
    throw new Error("token_http_other");
  }
  if (typeof token?.access_token !== "string" || !token.access_token)
    throw new Error("token_response");

  // NAVER profile lookup is a DIFFERENT request stage. No redirect following
  // with Bearer credentials; identify failures distinctly from token issues.
  let profileResponse;
  try {
    profileResponse = await fetch("https://openapi.naver.com/v1/nid/me", {
      method: "GET",
      headers: {
        "Authorization": "Bearer " + token.access_token,
        "X-Naver-Client-Id": env.NAVER_LOGIN_CLIENT_ID,
        "X-Naver-Client-Secret": env.NAVER_LOGIN_CLIENT_SECRET,
        "Accept": "application/json",
      },
      redirect: "manual",
    });
  } catch {
    throw new Error("profile_network");
  }
  if (profileResponse.status >= 300 && profileResponse.status < 400)
    throw new Error("profile_redirect");
  if (!profileResponse.ok) {
    if (profileResponse.status === 401) throw new Error("profile_http_401");
    if (profileResponse.status === 403) throw new Error("profile_http_403");
    throw new Error("profile_http_other");
  }
  let profile;
  try { profile = await profileResponse.json(); }
  catch { throw new Error("profile_nonjson"); }
  if (profile?.resultcode !== "00" || typeof profile.response?.id !== "string" ||
      !profile.response.id)
    throw new Error("profile_invalid");
  return profile.response.id;
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return json({service:"gpt-maps-private", active:!checkConfig(env,request),
        owner_bound: Boolean(env.ALLOWED_NAVER_USER_ID)});
    }
    const problem = checkConfig(env, request);
    if (problem) return reply("Setup required: " + problem, 503);
    if (url.pathname === "/auth/network-check" && request.method === "GET") {
      // Temporary unauthenticated outbound probe was retired after testing.
      return reply("Diagnostic closed. Start a new NAVER login at /auth/login.", 410);
    }
    if (url.pathname === "/auth/error" && request.method === "GET") {
      return authErrorPage(url.searchParams.get("reason"));
    }
    if (url.pathname === "/auth/login" && request.method === "GET") {
      // Old error redirects must not silently restart OAuth in an infinite loop.
      if (url.searchParams.has("error"))
        return redirect(env.APP_ORIGIN + "/auth/error?reason=naver");
      const state = randomState();
      const callback = env.APP_ORIGIN + "/auth/callback";
      const oauth = new URL("https://nid.naver.com/oauth2.0/authorize");
      oauth.search = new URLSearchParams({
        response_type: "code",
        client_id: env.NAVER_LOGIN_CLIENT_ID,
        redirect_uri: callback,
        state,
      }).toString();
      return redirect(oauth.toString(), [cookie(STATE_COOKIE, state, STATE_TTL)]);
    }
    if (url.pathname === "/auth/callback" && request.method === "GET") {
      const supplied = url.searchParams.get("state");
      const expected = cookieValue(request, STATE_COOKIE);
      const expireState = cookie(STATE_COOKIE, "", 0);
      if (!expected || !supplied || supplied !== expected || expected.length < 30)
        return redirect(env.APP_ORIGIN + "/auth/error?reason=state", [expireState]);
      if (url.searchParams.has("error")) return redirect(env.APP_ORIGIN + "/auth/error?reason=naver", [expireState]);
      const code = url.searchParams.get("code");
      if (!code || code.length > 2048)
        return redirect(env.APP_ORIGIN + "/auth/error?reason=missing_code", [expireState]);
      try {
        const userId = await exchangeCode(code, supplied, env);
        if (!env.ALLOWED_NAVER_USER_ID) {
          const page = pendingOwnerPage(userId);
          page.headers.append("Set-Cookie", expireState);
          return page;
        }
        if (userId !== env.ALLOWED_NAVER_USER_ID)
          return deniedOwnerPage(userId, expireState);
        const session = await createSession(userId, env);
        return redirect(env.APP_ORIGIN + "/", [
          expireState, cookie(SESSION_COOKIE, session, SESSION_TTL),
        ]);
      } catch (error) {
        const allowedErrors = new Set([
          "profile", "token", "token_credentials", "token_code", "token_request",
          "token_http_400", "token_http_401", "token_http_403", "token_http_404",
          "token_http_429", "token_http_5xx", "token_http_other",
          "token_provider_error", "token_nonjson", "token_invalid_json",
          "token_network", "token_response", "token_redirect",
          "profile_network", "profile_redirect", "profile_http_401",
          "profile_http_403", "profile_http_other", "profile_nonjson", "profile_invalid",
        ]);
        const reason = allowedErrors.has(error?.message) ? error.message : "callback_internal";
        return redirect(env.APP_ORIGIN + "/auth/error?reason=" + reason, [expireState]);
      }
    }
    if (url.pathname === "/auth/logout" && request.method === "POST") {
      return redirect(env.APP_ORIGIN + "/auth/login",
        [cookie(SESSION_COOKIE,"",0),cookie(STATE_COOKIE,"",0)]);
    }
    if (url.pathname === "/denied") return reply("This NAVER account is not authorized.", 403);
    const isOwner = await authorized(request,env);
    if (url.pathname === "/api/me") {
      return json({authenticated:isOwner, owner:isOwner},isOwner?200:401);
    }
    if (!isOwner) return url.pathname.startsWith("/api/") ? json({error:"NAVER 로그인이 필요합니다."},401) : redirect(env.APP_ORIGIN + "/auth/login");
    if (url.pathname === "/api/features" || url.pathname === "/api/places" || url.pathname === "/api/directions") {
      return featureRequest(request,env,url);
    }
    if (request.method !== "GET" && request.method !== "HEAD") return reply("Method not allowed.", 405);
    const assetResponse = await env.ASSETS.fetch(request);
    const resultHeaders = new Headers(assetResponse.headers);
    Object.entries(headers()).forEach(([key,value])=>resultHeaders.set(key,value));
    return new Response(assetResponse.body, {status:assetResponse.status,
      statusText:assetResponse.statusText,headers:resultHeaders});
  },
};
