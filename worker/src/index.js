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
function authErrorPage(reason) {
  // Never put NAVER auth codes, access tokens, raw responses, or secrets into the page.
  const messages = {
    state: "로그인 세션이 만료됐거나 브라우저 쿠키가 전달되지 않았습니다. 처음부터 다시 로그인하세요.",
    naver: "네이버에서 로그인을 거부하거나 취소했습니다. 네이버 개발자센터의 앱 설정을 확인하세요.",
    missing_code: "네이버에서 인증코드를 전달하지 않았습니다.",
    token: "네이버 인증코드 교환에 실패했습니다. Client Secret 및 Callback URL 일치 여부를 확인하세요.",
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
  const args = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: env.NAVER_LOGIN_CLIENT_ID,
    client_secret: env.NAVER_LOGIN_CLIENT_SECRET,
    redirect_uri: env.APP_ORIGIN + "/auth/callback",
    code, state,
  });
  const tokenResponse = await fetch("https://nid.naver.com/oauth2.0/token", {
    method: "POST",
    headers: {"Content-Type": "application/x-www-form-urlencoded"},
    body: args.toString(),
    redirect: "error",
  });
  if (!tokenResponse.ok) throw new Error("token");
  const token = await tokenResponse.json();
  if (!token || typeof token.access_token !== "string" || !token.access_token) {
    throw new Error("token");
  }
  const profileResponse = await fetch("https://openapi.naver.com/v1/nid/me", {
    headers: {
      "Authorization": "Bearer " + token.access_token,
      "X-Naver-Client-Id": env.NAVER_LOGIN_CLIENT_ID,
      "X-Naver-Client-Secret": env.NAVER_LOGIN_CLIENT_SECRET,
    },
    redirect: "error",
  });
  if (!profileResponse.ok) throw new Error("profile");
  const profile = await profileResponse.json();
  if (profile?.resultcode !== "00" || typeof profile.response?.id !== "string"
      || !profile.response.id) throw new Error("profile");
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
        if (userId !== env.ALLOWED_NAVER_USER_ID) return redirect(env.APP_ORIGIN + "/denied", [expireState]);
        const session = await createSession(userId, env);
        return redirect(env.APP_ORIGIN + "/", [
          expireState, cookie(SESSION_COOKIE, session, SESSION_TTL),
        ]);
      } catch (error) {
        const reason = error?.message === "profile" ? "profile" : "token";
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
    if (!isOwner) return redirect(env.APP_ORIGIN + "/auth/login");
    if (request.method !== "GET" && request.method !== "HEAD") return reply("Method not allowed.", 405);
    const assetResponse = await env.ASSETS.fetch(request);
    const resultHeaders = new Headers(assetResponse.headers);
    Object.entries(headers()).forEach(([key,value])=>resultHeaders.set(key,value));
    return new Response(assetResponse.body, {status:assetResponse.status,
      statusText:assetResponse.statusText,headers:resultHeaders});
  },
};
