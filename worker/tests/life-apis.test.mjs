import test from "node:test";
import assert from "node:assert/strict";
import {lifeStatus,lifeCall,handleLife,LIFE_ACTIONS} from "../src/life-apis.js";
import handler from "../src/index.js";
const origin="https://gpt-maps-private.yoonchoi-96.workers.dev";
const empty={APP_ORIGIN:origin};
const active={...empty,OMARI_LIFE_PUBLIC_ENABLED:"true",
  DATA_GO_KR_SERVICE_KEY:"fake-public-data-key",ECOS_API_KEY:"fake-ecos-key"};
test("all nine groups and ten read operations are registered",()=>{
  assert.equal(lifeStatus(empty).providers.length,9);
  assert.equal(LIFE_ACTIONS.length,10);
  assert.ok(lifeStatus(empty).providers.every(x=>!x.enabled));
});
test("all actions fail closed without explicit opt-in and no upstream calls",async()=>{
  const old=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw Error("should not call")};
  try{
    for(const action of LIFE_ACTIONS){
      const res=await lifeCall(empty,action,{});
      assert.equal(res.status,503,action);
    }
    assert.equal(calls,0);
  }finally{globalThis.fetch=old}
});
test("Google Places requires BOTH flags and credentials, even with generic public enabled",async()=>{
  const old=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw Error("should not call")};
  try{
    for(const env of [active,{...active,GOOGLE_PLACES_API_KEY:"fake",OMARI_GOOGLE_PLACES_ENABLED:"true"},
      {...active,GOOGLE_PLACES_API_KEY:"fake",OMARI_GOOGLE_PLACES_BILLING_APPROVED:"true"}]){
      assert.equal((await lifeCall(env,"places_text_search",{query:"서울시청"})).status,503);
    }
    assert.equal(calls,0);
  }finally{globalThis.fetch=old}
});
test("public-data weather uses a fixed endpoint and limits results",async()=>{
  const old=globalThis.fetch;
  globalThis.fetch=async(url,opts)=>{
    const u=new URL(url);assert.equal(u.origin,"https://apis.data.go.kr");
    assert.equal(u.pathname,"/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst");
    assert.equal(u.searchParams.get("nx"),"60");
    assert.equal(u.searchParams.get("serviceKey"),active.DATA_GO_KR_SERVICE_KEY);
    assert.equal(opts.redirect,"manual");
    return Response.json({response:{header:{resultCode:"00"},body:{totalCount:1,items:{item:[{category:"T1H",obsrValue:"20"}]}}}});
  };
  try{
    const r=await lifeCall(active,"weather_now",{baseDate:"20261023",baseTime:"1700",nx:"60",ny:"127"});
    assert.equal(r.status,200);
    const data=await r.json();assert.equal(data.results[0].category,"T1H");
    assert.equal(JSON.stringify(data).includes(active.DATA_GO_KR_SERVICE_KEY),false);
  }finally{globalThis.fetch=old}
});
test("TourAPI is fixed to KorService2 and limits search to 10",async()=>{
  const old=globalThis.fetch;
  globalThis.fetch=async(url)=>{
    const u=new URL(url);
    assert.equal(u.pathname,"/B551011/KorService2/searchKeyword2");
    assert.equal(u.searchParams.get("keyword"),"경복궁");
    return Response.json({response:{header:{resultCode:"00"},body:{items:{item:[{title:"경복궁"}]}}}});
  };
  try{assert.equal((await lifeCall(active,"tour_search",{keyword:"경복궁"})).status,200)}
  finally{globalThis.fetch=old}
});
test("ECOS series constructs exact fixed host without reflecting API key",async()=>{
  const old=globalThis.fetch;
  globalThis.fetch=async(url)=>{
    assert.equal(new URL(url).origin,"https://ecos.bok.or.kr");
    return Response.json({StatisticSearch:{row:[{STAT_NAME:"기준금리",TIME:"202610",DATA_VALUE:"2.5",UNIT_NAME:"%"}]}});
  };
  try{
    const r=await lifeCall(active,"ecos_series",{statCode:"722Y001",cycle:"M",start:"202601",end:"202610"});
    assert.equal(r.status,200);
    const d=await r.json();assert.equal(d.results[0].value,"2.5");
    assert.ok(!JSON.stringify(d).includes(active.ECOS_API_KEY));
  }finally{globalThis.fetch=old}
});
test("invalid public API params do not call upstream",async()=>{
  const old=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw Error("should not call")};
  try{
    assert.equal((await lifeCall(active,"apt_sales",{districtCode:"../../../",month:"202610"})).status,400);
    assert.equal((await lifeCall(active,"bus_arrivals",{cityCode:"1",nodeId:"bad/node"})).status,400);
    assert.equal((await lifeCall(active,"weather_now",{baseDate:"20261023",baseTime:"1700",nx:"999",ny:"127"})).status,400);
    assert.equal(calls,0);
  }finally{globalThis.fetch=old}
});
test("Home Assistant never permits arbitrary URLs or writes and only exposes sensor state",async()=>{
  const old=globalThis.fetch;let calls=0;
  globalThis.fetch=async(url,opts)=>{
    calls++;
    assert.equal(url,"https://home.example.org/api/states/sensor.temperature");
    assert.equal(opts.method,"GET");
    assert.ok(opts.headers.Authorization.startsWith("Bearer "));
    return Response.json({entity_id:"sensor.temperature",state:"22.5",
      attributes:{friendly_name:"거실 온도",unit_of_measurement:"°C",latitude:37.1,secret:"hidden"},
      context:{id:"hidden"}});
  };
  try{
    const env={...empty,OMARI_HOME_ASSISTANT_ENABLED:"true",
      HOME_ASSISTANT_URL:"https://home.example.org",HOME_ASSISTANT_TOKEN:"fake-token"};
    assert.equal((await lifeCall(env,"ha_sensor",{entityId:"light.bedroom"})).status,400);
    const r=await lifeCall(env,"ha_sensor",{entityId:"sensor.temperature"});
    assert.equal(r.status,200);
    const body=JSON.stringify(await r.json());
    assert.ok(!body.includes("latitude"));assert.ok(!body.includes("hidden"));
    assert.equal(calls,1);
    assert.equal((await lifeCall({...env,HOME_ASSISTANT_URL:"http://127.0.0.1:8123"},
      "ha_sensor",{entityId:"sensor.temperature"})).status,400);
  }finally{globalThis.fetch=old}
});
test("YouTube video lookup uses low-quota videos.list, not expensive search.list",async()=>{
  const old=globalThis.fetch;
  globalThis.fetch=async(url)=>{
    const u=new URL(url);assert.equal(u.pathname,"/youtube/v3/videos");
    assert.equal(u.searchParams.get("id"),"abcdefghijk");
    return Response.json({items:[{id:"abcdefghijk",snippet:{title:"Test",channelTitle:"Channel"},statistics:{viewCount:"20"}}]});
  };
  try{
    const r=await lifeCall({...empty,OMARI_YOUTUBE_ENABLED:"true",YOUTUBE_DATA_API_KEY:"fake"},
      "youtube_video",{videoId:"abcdefghijk"});
    assert.equal(r.status,200);assert.equal((await r.json()).quota_units,1);
  }finally{globalThis.fetch=old}
});
test("anonymous requests cannot call any life provider route",async()=>{
  const env={...active,NAVER_LOGIN_CLIENT_ID:"test",NAVER_LOGIN_CLIENT_SECRET:"test",
    SESSION_SECRET:"a-secret-key-longer-than-32-characters",ALLOWED_NAVER_USER_ID:"owner"};
  const r=await handler.fetch(new Request(origin+"/api/life/query?action=weather_now&nx=60"),env);
  assert.equal(r.status,401);
});
test("life status does not expose keys and does not call providers",async()=>{
  const old=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw Error("no calls")};
  try{
    const r=await handleLife(new Request(origin+"/api/life/status"),active,
      new URL(origin+"/api/life/status"));
    assert.equal(r.status,200);
    const txt=await r.text();assert.equal(calls,0);
    assert.ok(!txt.includes(active.DATA_GO_KR_SERVICE_KEY));
    assert.ok(!txt.includes(active.ECOS_API_KEY));
  }finally{globalThis.fetch=old}
});
