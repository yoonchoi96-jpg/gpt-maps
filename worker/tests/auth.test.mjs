import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import handler from "../src/index.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const origin = "https://gpt-maps-private.example.workers.dev";
const defaultEnv = {
  APP_ORIGIN: origin,
  NAVER_LOGIN_CLIENT_ID: "test-client-id",
  NAVER_LOGIN_CLIENT_SECRET: "test-secret-only-on-backend",
  SESSION_SECRET: "very-long-local-testing-secret-32-bytes-minimum",
  ALLOWED_NAVER_USER_ID: "my-app-scoped-user-id",
  ASSETS: {
    async fetch() {
      return new Response("<html>PRIVATE MAP</html>", {
        headers: {"Content-Type": "text/html"},
      });
    },
  },
};
function req(path, cookie) {
  return new Request(origin+path,{headers:cookie?{Cookie:cookie}:{}});
}
function getCookie(response,name){
  const combined=response.headers.get("Set-Cookie")||"";
  const match=combined.match(new RegExp("("+name+"=[^;]+)"));
  return match?.[1]||"";
}
function parseOauth(resp){
  assert.equal(resp.status,303);
  const target=new URL(resp.headers.get("Location"));
  assert.equal(target.hostname,"nid.naver.com");
  const state=target.searchParams.get("state");
  assert.ok(state && state.length>30);
  return {state, cookie:getCookie(resp,"__Host-gptmaps_oauth")};
}
function mockNaverFetch(id) {
  const saved=globalThis.fetch;
  let count=0;
  globalThis.fetch=async (input,options={})=>{
    const url=String(input);count++;
    if(url==="https://nid.naver.com/oauth2.0/token"){
      assert.equal(options.method,"POST");
      assert.ok(!url.includes("test-secret-only-on-backend"));
      const params=new URLSearchParams(options.body);
      assert.equal(params.get("client_secret"),defaultEnv.NAVER_LOGIN_CLIENT_SECRET);
      assert.equal(params.has("redirect_uri"),false);
      return Response.json({access_token:"test-access-token"});
    }
    if(url==="https://openapi.naver.com/v1/nid/me"){
      assert.equal(options.headers.Authorization,"Bearer test-access-token");
      return Response.json({resultcode:"00",response:{id}});
    }
    throw Error("Unexpected external API: "+url);
  };
  return {restore:()=>{globalThis.fetch=saved;},calls:()=>count};
}

test("No credentials => fail closed with 503", async()=>{
  const env={...defaultEnv,NAVER_LOGIN_CLIENT_SECRET:""};
  const res=await handler.fetch(req("/"),env);
  assert.equal(res.status,503);
});

test("No session => redirect before serving static assets", async()=>{
  let served=0;
  const env={...defaultEnv,ASSETS:{async fetch(){served++; return new Response("unsafe")}}};
  const res=await handler.fetch(req("/"),env);
  assert.equal(res.status,303);
  assert.equal(res.headers.get("Location"),origin+"/auth/login");
  assert.equal(served,0);
});

test("OAuth state is unpredictable, secure, HTTP-only", async()=>{
  const res=await handler.fetch(req("/auth/login"),defaultEnv);
  const {state,cookie}=parseOauth(res);
  assert.equal(new URL(res.headers.get("Location")).searchParams.get("redirect_uri"),origin+"/auth/callback");
  assert.ok(cookie.includes("__Host-gptmaps_oauth="));
  assert.ok(res.headers.get("Set-Cookie").includes("HttpOnly"));
  assert.ok(res.headers.get("Set-Cookie").includes("Secure"));
  assert.ok(state.length>=40);
});

test("Forged callback state is rejected without outbound API calls", async()=>{
  const login=await handler.fetch(req("/auth/login"),defaultEnv);
  const {cookie}=parseOauth(login);
  const mock=mockNaverFetch("my-app-scoped-user-id");
  try{
    const res=await handler.fetch(req("/auth/callback?state=forged&code=bogus",cookie),defaultEnv);
    assert.equal(res.status,303);
    assert.equal(mock.calls(),0);
    assert.ok(!res.headers.get("Set-Cookie").includes("__Host-gptmaps_session="));
  } finally {mock.restore()}
});

test("Other authenticated NAVER account receives no session and cannot see map", async()=>{
  const login=await handler.fetch(req("/auth/login"),defaultEnv);
  const {state,cookie}=parseOauth(login);
  const mock=mockNaverFetch("someone-else");
  try{
    const res=await handler.fetch(req("/auth/callback?state="+state+"&code=valid-code",cookie),defaultEnv);
    assert.equal(mock.calls(),2);
    assert.equal(res.status,303);
    assert.equal(res.headers.get("Location"),origin+"/denied");
    assert.ok(!res.headers.get("Set-Cookie").includes("__Host-gptmaps_session="));
  } finally {mock.restore()}
});

test("Owner can log in and access protected assets with signed session", async()=>{
  const login=await handler.fetch(req("/auth/login"),defaultEnv);
  const {state,cookie}=parseOauth(login);
  const mock=mockNaverFetch("my-app-scoped-user-id");
  let session;
  try{
    const callback=await handler.fetch(req("/auth/callback?state="+state+"&code=valid-code",cookie),defaultEnv);
    assert.equal(callback.status,303);
    session=getCookie(callback,"__Host-gptmaps_session");
    assert.ok(session);
  } finally {mock.restore()}
  const me=await handler.fetch(req("/api/me",session),defaultEnv);
  assert.equal(me.status,200);
  assert.deepEqual(await me.json(),{authenticated:true,owner:true});
  const map=await handler.fetch(req("/?lat=37.5",session),defaultEnv);
  assert.equal(map.status,200);
  assert.match(await map.text(),/PRIVATE MAP/);
  assert.equal(map.headers.get("Cache-Control"),"no-store");

  const logout=await handler.fetch(new Request(origin+"/auth/logout",{method:"POST",headers:{Cookie:session}}),defaultEnv);
  assert.equal(logout.status,303);
  assert.ok(logout.headers.get("Set-Cookie").includes("Max-Age=0"));

  // Corrupting the token invalidates the HMAC.
  const bad=session.slice(0,-2)+"xx";
  const denied=await handler.fetch(req("/api/me",bad),defaultEnv);
  assert.equal(denied.status,401);
});

test("Account enrollment cannot auto-authorize whoever signs in first", async()=>{
  const env={...defaultEnv,ALLOWED_NAVER_USER_ID:""};
  const login=await handler.fetch(req("/auth/login"),env);
  const {state,cookie}=parseOauth(login);
  const mock=mockNaverFetch("id-to-bind-manually");
  try{
    const callback=await handler.fetch(req("/auth/callback?state="+state+"&code=one-time-code",cookie),env);
    assert.equal(callback.status,403);
    const body=await callback.text();
    assert.match(body,/id-to-bind-manually/);
    assert.equal(callback.headers.get("Cache-Control"),"no-store");
    assert.ok(!callback.headers.get("Set-Cookie").includes("__Host-gptmaps_session="));
    const unauthorized=await handler.fetch(req("/"),env);
    assert.equal(unauthorized.status,303);
  } finally {mock.restore()}
});

test("NAVER callback errors show a diagnostic page instead of looping", async()=>{
  const login=await handler.fetch(req("/auth/login"),defaultEnv);
  const {state,cookie}=parseOauth(login);
  const callback=await handler.fetch(req("/auth/callback?state="+state+"&error=access_denied",cookie),defaultEnv);
  assert.equal(callback.status,303);
  assert.equal(callback.headers.get("Location"),origin+"/auth/error?reason=naver");
  const error=await handler.fetch(req("/auth/error?reason=naver"),defaultEnv);
  assert.equal(error.status,400);
  assert.match(await error.text(),/네이버 로그인 확인 필요/);
  const legacy=await handler.fetch(req("/auth/login?error=oauth"),defaultEnv);
  assert.equal(legacy.status,303);
  assert.equal(legacy.headers.get("Location"),origin+"/auth/error?reason=naver");
});

test("Token endpoint failure shows token-stage error instead of restarting consent", async()=>{
  const login=await handler.fetch(req("/auth/login"),defaultEnv);
  const {state,cookie}=parseOauth(login);
  const saved=globalThis.fetch;
  globalThis.fetch=async(url)=>{assert.equal(String(url),"https://nid.naver.com/oauth2.0/token");return new Response("Not authorized",{status:401})};
  try{
    const res=await handler.fetch(req("/auth/callback?state="+state+"&code=issued-code",cookie),defaultEnv);
    assert.equal(res.status,303);
    assert.equal(res.headers.get("Location"),origin+"/auth/error?reason=token_http_401");
    assert.ok(!res.headers.get("Set-Cookie").includes("__Host-gptmaps_session="));
  }finally{globalThis.fetch=saved}
});

test("NAVER invalid_client is safely mapped to credentials error without exposing raw message",async()=>{
  const login=await handler.fetch(req("/auth/login"),defaultEnv);
  const {state,cookie}=parseOauth(login);
  const saved=globalThis.fetch;
  globalThis.fetch=async ()=>new Response(JSON.stringify({
    error:"invalid_client",error_description:"DO-NOT-LEAK provider raw details"
  }),{status:401,headers:{"Content-Type":"application/json"}});
  try{
    const res=await handler.fetch(req("/auth/callback?state="+state+"&code=issued-code",cookie),defaultEnv);
    assert.equal(res.status,303);
    assert.equal(res.headers.get("Location"),origin+"/auth/error?reason=token_credentials");
    assert.ok(!res.headers.get("Location").includes("DO-NOT-LEAK"));
    const page=await handler.fetch(req("/auth/error?reason=token_credentials"),defaultEnv);
    assert.equal(page.status,400);
    assert.doesNotMatch(await page.text(),/DO-NOT-LEAK/);
  }finally{globalThis.fetch=saved}
});

test("NAVER HTTP 200 with invalid_grant body correctly identifies spent auth code",async()=>{
  const login=await handler.fetch(req("/auth/login"),defaultEnv);
  const {state,cookie}=parseOauth(login);
  const saved=globalThis.fetch;
  globalThis.fetch=async ()=>Response.json({error:"invalid_grant",error_description:"secret"});
  try{
    const res=await handler.fetch(req("/auth/callback?state="+state+"&code=old-code",cookie),defaultEnv);
    assert.equal(res.status,303);
    assert.equal(res.headers.get("Location"),origin+"/auth/error?reason=token_code");
  }finally{globalThis.fetch=saved}
});

test("NAVER unavailable network is distinguished from credential failures",async()=>{
  const login=await handler.fetch(req("/auth/login"),defaultEnv);
  const {state,cookie}=parseOauth(login);
  const saved=globalThis.fetch;
  globalThis.fetch=async()=>{throw Error("NETWORK-RAW-PRIVATE")};
  try{
    const res=await handler.fetch(req("/auth/callback?state="+state+"&code=valid-code",cookie),defaultEnv);
    assert.equal(res.headers.get("Location"),origin+"/auth/error?reason=token_network");
  }finally{globalThis.fetch=saved}
});


test("Transport probe never transmits credentials, auth codes, or session data",async()=>{
  const saved=globalThis.fetch;
  const seen=[];
  globalThis.fetch=async (url,init)=>{
    seen.push({url:String(url),method:init.method,body:init.body||"",redirect:init.redirect});
    return new Response("",{status:401});
  };
  try{
    const res=await handler.fetch(req("/auth/network-check"),defaultEnv);
    assert.equal(res.status,200);
    const body=await res.json();
    assert.equal(body.diagnostic,"naver_oauth_transport");
    assert.equal(body.credentials_sent,false);
    assert.equal(body.checks.length,3);
    assert.equal(seen.length,3);
    for(const call of seen){
      assert.equal(call.redirect,"manual");
      assert.ok(call.url.startsWith("https://"));
      assert.ok(!call.url.includes("test-secret-only-on-backend"));
      assert.ok(!call.body.includes("test-secret-only-on-backend"));
      assert.ok(!call.body.includes("test-client-id"));
    }
  } finally {globalThis.fetch=saved}
});

test("NAVER token redirect is classified safely and never followed",async()=>{
  const login=await handler.fetch(req("/auth/login"),defaultEnv);
  const {state,cookie}=parseOauth(login);
  const saved=globalThis.fetch;
  let requests=0;
  globalThis.fetch=async (_url,init)=>{
    requests++;
    assert.equal(init.redirect,"manual");
    return new Response("",{status:302,headers:{Location:"https://example.invalid/"}})
  };
  try{
    const res=await handler.fetch(req("/auth/callback?state="+state+"&code=valid-code",cookie),defaultEnv);
    assert.equal(res.status,303);
    assert.equal(res.headers.get("Location"),origin+"/auth/error?reason=token_redirect");
    assert.equal(requests,1);
  }finally{globalThis.fetch=saved}
});
