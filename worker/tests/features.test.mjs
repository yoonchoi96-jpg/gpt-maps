import test from "node:test";
import assert from "node:assert/strict";
import {featureRequest} from "../src/places-and-routes.js";

const env={
  NAVER_LOGIN_CLIENT_ID:"TEST-PUBLIC-CLIENT",
  NAVER_LOGIN_CLIENT_SECRET:"TEST-PRIVATE-SECRET",
  NAVER_MAPS_CLIENT_ID:"TEST-MAPS-ID",
};
const base="https://gpt-maps-private.example.workers.dev";
const request=(p)=>new Request(base+p);
test("Feature status never reveals credentials, and paid directions default off", async()=>{
  const response=await featureRequest(request("/api/features"),env,new URL(base+"/api/features"));
  assert.equal(response.status,200);
  const value=await response.json();
  assert.equal(value.places,true);
  assert.equal(value.directions,false);
  assert.equal(JSON.stringify(value).includes("TEST-PRIVATE-SECRET"),false);
});
test("Local search requires 2-70 characters and does not call NAVER for invalid inputs",async()=>{
  for(const q of ["a","a".repeat(71),""]){
    const path="/api/places?q="+encodeURIComponent(q);
    const response=await featureRequest(request(path),env,new URL(base+path));
    assert.equal(response.status,400);
  }
});
test("NAVER local search converts WGS84 integer coordinates and removes HTML tags",async()=>{
  const original=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async(url,options)=>{
    calls++;
    assert.equal(options.headers["X-Naver-Client-Secret"],"TEST-PRIVATE-SECRET");
    assert.ok(String(url).startsWith("https://openapi.naver.com/v1/search/local.json?"));
    assert.equal(new URL(url).searchParams.get("display"),"5");
    return Response.json({items:[
      {title:"<b>서울 시청</b>",category:"관공서",roadAddress:"서울 중구 세종대로",mapx:1269873882,mapy:375666103},
    ]});
  };
  try{
    const path="/api/places?q="+encodeURIComponent("서울 시청");
    const response=await featureRequest(request(path),env,new URL(base+path));
    assert.equal(response.status,200);
    const data=await response.json();
    assert.equal(calls,1);
    assert.equal(data.places.length,1);
    assert.equal(data.places[0].name,"서울 시청");
    assert.equal(data.places[0].lat,37.5666103);
    assert.equal(data.places[0].lng,126.9873882);
    assert.ok(!JSON.stringify(data).includes("TEST-PRIVATE-SECRET"));
  }finally{globalThis.fetch=original;}
});
test("API search permission denial yields actionable error, not fake empty list",async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>new Response("",{status:403});
  try{
    const path="/api/places?q=서울시청";
    const response=await featureRequest(request(path),env,new URL(base+path));
    assert.equal(response.status,403);
    assert.match((await response.json()).error,/검색.*API/);
  }finally{globalThis.fetch=original;}
});
test("Paid Directions5 cannot call upstream with default flags",async()=>{
  const original=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async()=>{calls++;throw Error("should never call upstream")};
  try{
    const path="/api/directions?start=126.98,37.56&goal=127.00,37.58";
    const response=await featureRequest(request(path),env,new URL(base+path));
    assert.equal(response.status,503);
    assert.equal(calls,0);
  }finally{globalThis.fetch=original;}
});
test("Paid Directions5 only runs on explicit opt-in and returns reduced geometry",async()=>{
  const active={...env,NAVER_MAPS_CLIENT_SECRET:"NEVER-SHOW-MAPS-SECRET",ENABLE_PAID_DIRECTIONS:"true"};
  const original=globalThis.fetch;
  globalThis.fetch=async (url,options)=>{
    assert.ok(String(url).startsWith("https://maps.apigw.ntruss.com/map-direction/v1/driving?"));
    assert.equal(options.headers["x-ncp-apigw-api-key"],"NEVER-SHOW-MAPS-SECRET");
    return Response.json({route:{traoptimal:[{summary:{distance:1200,duration:180000,tollFare:0},path:[[126.98,37.56],[127,37.58]]}]}});
  };
  try{
    const path="/api/directions?start=126.98,37.56&goal=127,37.58";
    const response=await featureRequest(request(path),active,new URL(base+path));
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.distance,1200);
    assert.equal(result.geometry.length,2);
    assert.ok(!JSON.stringify(result).includes("NEVER-SHOW-MAPS-SECRET"));
  }finally{globalThis.fetch=original;}
});
