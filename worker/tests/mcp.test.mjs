import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {mintMcpToken,validMcpToken,handleMcp,MCP_TOOLS} from "../src/mcp.js";
import handler from "../src/index.js";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const origin="https://gpt-maps-private.example.workers.dev";
const env={
 APP_ORIGIN:origin,
 SESSION_SECRET:"test-local-mcp-signing-key-more-than-32-characters",
 ALLOWED_NAVER_USER_ID:"owner-only-app-user",
 NAVER_LOGIN_CLIENT_ID:"id",NAVER_LOGIN_CLIENT_SECRET:"secret",
 NAVER_API_HUB_CLIENT_ID:"hub-id",NAVER_API_HUB_CLIENT_SECRET:"hub-secret",NAVER_API_HUB_ENABLED:"true",
 ASSETS:{fetch:async()=>new Response("safe")},
};
const post=(method,params={},headers={})=>new Request(origin+"/mcp",{
 method:"POST",
 headers:{"Content-Type":"application/json",...headers},
 body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),
});
async function body(res){return res.json()}
test("MCP refuses anonymous clients and never leaks tool list",async()=>{
 const res=await handler.fetch(post("tools/list"),env);
 assert.equal(res.status,401);
 assert.match(res.headers.get("WWW-Authenticate"),/Bearer/);
 const data=await body(res);
 assert.equal(JSON.stringify(data).includes("search_naver_places"),false);
});
test("MCP token can be minted, verified and tampering is rejected",async()=>{
 const data=await mintMcpToken(env);
 assert.equal(data.token_type,"Bearer");
 assert.ok(data.expires_at>Math.floor(Date.now()/1000));
 const req=new Request(origin+"/mcp",{headers:{Authorization:"Bearer "+data.access_token}});
 assert.equal(await validMcpToken(req,env),true);
 const fake=data.access_token.slice(0,-3)+"BAD";
 assert.equal(await validMcpToken(new Request(origin+"/mcp",{headers:{Authorization:"Bearer "+fake}}),env),false);
 assert.equal(await validMcpToken(req,{...env,ALLOWED_NAVER_USER_ID:"another-owner"}),false);
 assert.equal(await validMcpToken(req,{...env,SESSION_SECRET:"rotated-secret".repeat(4)}),false);
});
test("MCP basic JSON-RPC methods work with bearer auth",async()=>{
 const token=await mintMcpToken(env);
 const headers={Authorization:"Bearer "+token.access_token};
 const init=await handler.fetch(post("initialize",{protocolVersion:"2025-06-18",capabilities:{},clientInfo:{name:"test",version:"1"}},headers),env);
 assert.equal(init.status,200);
 assert.equal((await body(init)).result.serverInfo.name,"gpt-maps-naver");
 const listed=await handler.fetch(post("tools/list",{},headers),env);
 const names=(await body(listed)).result.tools.map(x=>x.name);
 assert.equal(names.length,10);
 assert.ok(names.includes("get_omari_life_status"));
 assert.ok(names.includes("query_omari_life_api"));
 assert.ok(names.includes("search_naver_hub"));
 assert.ok(names.includes("get_naver_search_trend"));
 assert.ok(names.includes("get_naver_shopping_insight"));
 assert.ok(names.includes("get_naver_hub_status"));
 assert.ok(names.includes("search_naver_places"));
 assert.ok(!names.includes("get_naver_driving_route"));
 const bad=await handler.fetch(post("tools/list",{}, {...headers,Origin:"https://evil.example"}),env);
 assert.equal(bad.status,403);
});
test("MCP link generation is deterministic and never calls NAVER paid APIs",async()=>{
 const token=await mintMcpToken(env);
 const headers={Authorization:"Bearer "+token.access_token};
 const params={name:"create_map_link",arguments:{latitude:37.5666,longitude:126.9784,title:"서울 시청"}};
 const res=await handler.fetch(post("tools/call",params,headers),env);
 assert.equal(res.status,200);
 const output=(await body(res)).result.structuredContent;
 assert.ok(output.map_url.includes("lat=37.5666"));
 assert.ok(output.map_url.startsWith(origin));
 assert.equal(output.place_saved,false);
 const disabled=await handler.fetch(post("tools/call",{name:"get_naver_driving_route",arguments:{}},headers),env);
 assert.equal((await body(disabled)).result.isError,true);
});
test("MCP rejects POST with bad content type, huge body, forged routing headers",async()=>{
 const token=await mintMcpToken(env);const auth="Bearer "+token.access_token;
 const bad=await handler.fetch(new Request(origin+"/mcp",{method:"POST",headers:{"Authorization":auth,"Content-Type":"text/plain"},body:"xx"}),env);
 assert.equal(bad.status,415);
 const spoof=await handler.fetch(post("tools/list",{},{"Authorization":auth,"Mcp-Method":"tools/call"}),env);
 assert.equal((await body(spoof)).error.code,-32600);
 const oversize=await handler.fetch(new Request(origin+"/mcp",{method:"POST",headers:{"Authorization":auth,"Content-Type":"application/json"},body:"x".repeat(17_000)}),env);
 assert.equal(oversize.status,413);
});
test("MCP token endpoint requires owner session, POST, and exact browser Origin",async()=>{
 const unauth=await handler.fetch(new Request(origin+"/api/mcp-token",{method:"POST",headers:{Origin:origin}}),env);
 assert.equal(unauth.status,401);
 const method=await handler.fetch(new Request(origin+"/api/mcp-token",{method:"GET"}),env);
 assert.equal(method.status,401);
});
test("MCP local-place search reuses NAVER proxy, no secret output",async()=>{
 const token=await mintMcpToken(env);
 const original=globalThis.fetch;
 globalThis.fetch=async(url,opts)=> {
   assert.equal(opts.headers["X-NCP-APIGW-API-KEY"],env.NAVER_API_HUB_CLIENT_SECRET);
   assert.equal(new URL(url).pathname,"/search/v1/local");
   assert.equal(opts.headers["X-Naver-Client-Secret"],undefined);
   return Response.json({items:[{title:"<b>서울시청</b>",roadAddress:"서울 중구",mapx:1269784100,mapy:375666800}]});
 };
 try{
   const res=await handler.fetch(post("tools/call",{name:"search_naver_places",arguments:{query:"서울시청"}},
      {Authorization:"Bearer "+token.access_token}),env);
   const result=(await body(res)).result;
   assert.equal(result.structuredContent.places[0].name,"서울시청");
   assert.equal(result.structuredContent.places[0].lat,37.56668);
   assert.equal(JSON.stringify(result).includes("secret"),false);
 }finally{globalThis.fetch=original}
});
test("All exposed tools are read-only and directions disabled without explicit opt-in",()=>{
 assert.ok(MCP_TOOLS.every(x=>x.annotations.readOnlyHint===true));
 assert.ok(!MCP_TOOLS.some(x=>x.name==="get_naver_driving_route"));
});

test("Full owner login -> token issue -> tools/list works, while forged Origin fails",async()=>{
 const original=globalThis.fetch;
 const login=await handler.fetch(new Request(origin+"/auth/login"),env);
 assert.equal(login.status,303);
 const naver=new URL(login.headers.get("Location"));
 const state=naver.searchParams.get("state");
 const stateCookie=(login.headers.get("Set-Cookie")||"").match(/__Host-gptmaps_oauth=[^;]+/)?.[0];
 assert.ok(stateCookie);
 globalThis.fetch=async(url,options)=>{
   if(String(url)==="https://nid.naver.com/oauth2.0/token")
     return Response.json({access_token:"dummy-nav-access"});
   if(String(url)==="https://openapi.naver.com/v1/nid/me")
     return Response.json({resultcode:"00",response:{id:env.ALLOWED_NAVER_USER_ID}});
   throw Error("unexpected request");
 };
 let sessionCookie;
 try{
   const response=await handler.fetch(new Request(origin+"/auth/callback?state="+state+"&code=valid",{
     headers:{Cookie:stateCookie},
   }),env);
   assert.equal(response.status,303);
   sessionCookie=(response.headers.get("Set-Cookie")||"").match(/__Host-gptmaps_session=[^;]+/)?.[0];
   assert.ok(sessionCookie);
 }finally{globalThis.fetch=original;}
 const proper=await handler.fetch(new Request(origin+"/api/mcp-token",{
   method:"POST",headers:{Origin:origin,Cookie:sessionCookie,"Content-Type":"application/json"},
   body:"{}",
 }),env);
 assert.equal(proper.status,200);
 const issued=await proper.json();
 assert.equal(issued.token_type,"Bearer");
 assert.ok(issued.expires_in<=43200);
 const forged=await handler.fetch(new Request(origin+"/api/mcp-token",{
   method:"POST",headers:{Origin:"https://evil.example",Cookie:sessionCookie},
 }),env);
 assert.equal(forged.status,403);
 const toolsResponse=await handler.fetch(post("tools/list",{},{
   Authorization:"Bearer "+issued.access_token}),env);
 assert.equal(toolsResponse.status,200);
 assert.ok((await toolsResponse.json()).result.tools.length>=4);
});
