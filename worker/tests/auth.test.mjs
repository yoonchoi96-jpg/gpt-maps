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
