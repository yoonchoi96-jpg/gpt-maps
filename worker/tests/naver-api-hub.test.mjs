import test from "node:test";
import assert from "node:assert/strict";
import {hubSearch,hubTrend,hubShoppingInsight,hubStatus,HUB_SEARCH_TYPES,handleHub} from "../src/naver-api-hub.js";
import handler from "../src/index.js";
const origin="https://gpt-maps-private.example.workers.dev";
const base={APP_ORIGIN:origin,NAVER_API_HUB_CLIENT_ID:"HUB-TEST-ID",NAVER_API_HUB_CLIENT_SECRET:"HUB-SECRET-NEVER-EXPOSE",NAVER_API_HUB_ENABLED:"true"};
const noHubs={APP_ORIGIN:origin};
const get=(suffix)=>new Request(origin+suffix);
test("HUB requires BOTH credentials and explicit billing/quota gate",async()=>{
  assert.equal(hubStatus(noHubs).enabled,false);
  for(const env of [noHubs,{...base,NAVER_API_HUB_ENABLED:"false"},{...base,NAVER_API_HUB_CLIENT_SECRET:undefined}]){
    const prev=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw Error("unexpected")};
    try{
      const response=await hubSearch(env,{type:"news",query:"대만 여행"});
      assert.equal(response.status,503);assert.equal(calls,0);
    }finally{globalThis.fetch=prev}
  }
});
test("HUB rejects unknown/retired search endpoints without API calls",async()=>{
  const prev=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw Error("unexpected")};
  try{
    for(const type of ["shopping","book","doc","../../secrets","whatever"]){
      const res=await hubSearch(base,{type,query:"네이버"});
      assert.equal(res.status,400);
    }
    assert.equal(calls,0);
    assert.equal(HUB_SEARCH_TYPES.includes("book"),false);
  }finally{globalThis.fetch=prev}
});
test("News HUB calls exact host and returns ordered, attributed links without secrets",async()=>{
  const old=globalThis.fetch;
  globalThis.fetch=async(url,opts)=>{
    const u=new URL(url);
    assert.equal(u.origin,"https://naverapihub.apigw.ntruss.com");
    assert.equal(u.pathname,"/search/v1/news");
    assert.equal(u.searchParams.get("query"),"대만 여행");
    assert.equal(u.searchParams.get("display"),"5");
    assert.equal(opts.headers["X-NCP-APIGW-API-KEY-ID"],base.NAVER_API_HUB_CLIENT_ID);
    assert.equal(opts.headers["X-NCP-APIGW-API-KEY"],base.NAVER_API_HUB_CLIENT_SECRET);
    return Response.json({total:2,items:[
      {title:"<b>첫 기사</b>",description:"기사1",link:"https://news.naver.com/1",originallink:"https://publisher.example/one",pubDate:"Fri 23 Oct 2026"},
      {title:"두번째 기사",description:"기사2",link:"https://news.naver.com/2",originallink:"javascript:evil()"},
    ]});
  };
  try{
    const r=await hubSearch(base,{type:"news",query:"대만 여행"});
    assert.equal(r.status,200);
    const d=await r.json();
    assert.equal(d.items[0].rank,1);assert.equal(d.items[1].rank,2);
    assert.equal(d.items[0].title,"첫 기사");
    assert.equal(d.items[0].original_link,"https://publisher.example/one");
    assert.equal(d.items[1].original_link,null);
    assert.equal(JSON.stringify(d).includes(base.NAVER_API_HUB_CLIENT_SECRET),false);
  }finally{globalThis.fetch=old}
});
test("local result converts and preserves source order and valid coordinates",async()=>{
  const old=globalThis.fetch;
  globalThis.fetch=async(url)=>{assert.match(String(url),/\/search\/v1\/local/);
    return Response.json({items:[
      {title:"<b>서울시청</b>",mapx:"1269784100",mapy:"375666800",roadAddress:"서울특별시 중구",category:"관공서"},
    ]});
  };
  try{
    const res=await hubSearch(base,{type:"local",query:"서울시청",display:5});
    assert.equal(res.status,200);
    const d=await res.json();
    assert.equal(d.items[0].latitude,37.56668);
    assert.equal(d.items[0].longitude,126.97841);
    assert.equal(d.items[0].address,"서울특별시 중구");
  }finally{globalThis.fetch=old}
});
test("HUB errors do not reveal upstream response body nor credentials",async()=>{
  const old=globalThis.fetch;globalThis.fetch=async()=>new Response("hidden tokens",{status:403});
  try{
    const res=await hubSearch(base,{type:"blog",query:"검색어"});
    assert.equal(res.status,403);
    const txt=await res.text();
    assert.ok(!txt.includes("hidden tokens"));
    assert.ok(!txt.includes("HUB-SECRET"));
  }finally{globalThis.fetch=old}
});
test("DataLab Search Trends use POST, validate groups, and label relative not absolute values",async()=>{
  const old=globalThis.fetch;
  globalThis.fetch=async(url,opts)=>{
    assert.equal(url,"https://naverapihub.apigw.ntruss.com/search-trend/v1/search");
    assert.equal(opts.method,"POST");
    const d=JSON.parse(opts.body);
    assert.deepEqual(d.keywordGroups,[{groupName:"한국",keywords:["한국"]}]);
    return Response.json({results:[{title:"한국",keywords:["한국"],data:[{period:"2026-09-01",ratio:100}]}]});
  };
  try{
    const r=await hubTrend(base,{startDate:"2026-09-01",endDate:"2026-09-30",timeUnit:"week",
      keywordGroups:[{groupName:"한국",keywords:["한국"]}]});
    assert.equal(r.status,200);
    const d=await r.json();assert.equal(d.results[0].data[0].ratio,100);
    assert.match(d.interpretation,/상대적/);
    const invalid=await hubTrend(base,{startDate:"2026-09-01",endDate:"2026-09-30",timeUnit:"week",keywordGroups:[]});
    assert.equal(invalid.status,400);
  }finally{globalThis.fetch=old}
});
test("shopping insight categories/keywords use supported APIs, not discontinued shopping product search",async()=>{
  const old=globalThis.fetch;
  let count=0;
  globalThis.fetch=async(url,opts)=>{
    count++;
    assert.ok(String(url).endsWith("/shopping/v1/category/keywords"));
    const data=JSON.parse(opts.body);
    assert.equal(data.category,"50000000");
    assert.deepEqual(data.keyword,[{name:"운동화",param:["운동화"]}]);
    return Response.json({results:[{title:"운동화",data:[{period:"2026-09-01",ratio:23.4}]}]});
  };
  try{
    const args={kind:"keywords",startDate:"2026-09-01",endDate:"2026-09-30",timeUnit:"week",
      category:"50000000",keywords:[{name:"운동화",keyword:"운동화"}]};
    const res=await hubShoppingInsight(base,args);
    assert.equal(res.status,200);assert.equal(count,1);
    assert.match((await res.json()).interpretation,/클릭/);
  }finally{globalThis.fetch=old}
});
test("owner web API HUB route without session redirects; not publicly exposed",async()=>{
  const env={...base,NAVER_LOGIN_CLIENT_ID:"test",NAVER_LOGIN_CLIENT_SECRET:"test",SESSION_SECRET:"a-secret-key-longer-than-32-chars-in-node",ALLOWED_NAVER_USER_ID:"me"};
  const res=await handler.fetch(get("/api/hub/search?type=news&q=%EB%8C%80%EB%A7%8C"),env);
  assert.equal(res.status,401);
});
test("HTML routes accept no untrusted POST Origin and restrict oversized bodies",async()=>{
  const path="/api/hub/trend",payload={startDate:"2026-09-01",endDate:"2026-09-30",timeUnit:"week",keywordGroups:[{groupName:"한글",keywords:["한글"]}]};
  const cross=await handleHub(new Request(origin+path,{method:"POST",headers:{Origin:"https://outside.invalid","Content-Type":"application/json"},body:JSON.stringify(payload)}),base,new URL(origin+path));
  assert.equal(cross.status,403);
  const huge=await handleHub(new Request(origin+path,{method:"POST",headers:{"Content-Type":"application/json"},body:" ".repeat(7200)}),base,new URL(origin+path));
  assert.equal(huge.status,413);
});
