/**
 * NAVER Maps private remote MCP (stateless Streamable HTTP).
 * No extra paid infrastructure. Authenticated via existing owner-only
 * NAVER session or a short-lived HMAC bearer minted by that session.
 *
 * This is an API-key-style bearer transport for compatible MCP clients.
 * It is NOT an OAuth authorization server and cannot yet be directly
 * installed into ChatGPT custom MCP connections that require OAuth.
 */
import { featureRequest } from "./places-and-routes.js";

const VERSION = "2025-06-18";
const TOKEN_LIFETIME = 12 * 60 * 60;
const SECRET_CONTEXT = "gpt-maps-mcp-bearer-v1:";
const ORIGIN = "https://gpt-maps-private.yoonchoi-96.workers.dev";
const BASE_HEADERS = {
  "Cache-Control":"no-store",
  "Content-Type":"application/json; charset=utf-8",
  "X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer",
  "Mcp-Protocol-Version":VERSION,
};
const enc = new TextEncoder();
function base64url(data) {
  let s="";for(const b of data)s+=String.fromCharCode(b);
  return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function unbase64url(s) {
  if(!/^[A-Za-z0-9_-]{1,4096}$/.test(s))throw Error("invalid encoding");
  return Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")),x=>x.charCodeAt(0));
}
async function hmacKey(env) {
  return crypto.subtle.importKey("raw",enc.encode(env.SESSION_SECRET),
    {name:"HMAC",hash:"SHA-256"},false,["sign","verify"]);
}
async function tokenSignature(body,env) {
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC",await hmacKey(env),
    enc.encode(SECRET_CONTEXT+body))));
}
export async function mintMcpToken(env) {
  const exp=Math.floor(Date.now()/1000)+TOKEN_LIFETIME;
  const payload={
    v:1,aud:"gpt-maps-mcp",sub:env.ALLOWED_NAVER_USER_ID,
    iat:Math.floor(Date.now()/1000),exp,
    nonce:base64url(crypto.getRandomValues(new Uint8Array(16))),
  };
  const body=base64url(enc.encode(JSON.stringify(payload)));
  return {access_token:body+"."+await tokenSignature(body,env),expires_at:exp,
    token_type:"Bearer",mcp_url:env.APP_ORIGIN+"/mcp"};
}
export async function validMcpToken(request,env) {
  if(!env.SESSION_SECRET||!env.ALLOWED_NAVER_USER_ID)return false;
  const h=request.headers.get("Authorization")||"";
  if(!h.startsWith("Bearer ")||h.length>4096)return false;
  const match=h.slice(7).split(".");
  if(match.length!==2)return false;
  try {
    const verified=await crypto.subtle.verify("HMAC",await hmacKey(env),
      unbase64url(match[1]),enc.encode(SECRET_CONTEXT+match[0]));
    if(!verified)return false;
    const token=JSON.parse(new TextDecoder().decode(unbase64url(match[0])));
    const now=Math.floor(Date.now()/1000);
    return token.v===1&&token.aud==="gpt-maps-mcp"&&
      token.sub===env.ALLOWED_NAVER_USER_ID&&
      Number.isInteger(token.iat)&&token.iat<=now+60&&
      Number.isInteger(token.exp)&&token.exp>now&&
      token.exp-token.iat<=TOKEN_LIFETIME&&
      typeof token.nonce==="string";
  }catch{return false}
}
function response(body,status=200,extra={}) {
  return new Response(body===null?null:JSON.stringify(body),{
    status,headers:{...BASE_HEADERS,...extra},
  });
}
function rpc(id, result) {return response({jsonrpc:"2.0",id,result})}
function failure(id,code,message){return response({jsonrpc:"2.0",id,error:{code,message}})}
function toolReply(data,isError=false){
  return {content:[{type:"text",text:JSON.stringify(data)}],
    structuredContent:data,isError};
}
function objectSchema(properties,required=[]){
  return {type:"object",properties,required,additionalProperties:false};
}
const S={type:"string"},N={type:"number"};
export const MCP_TOOLS=[
  {
    name:"search_naver_places",title:"Search NAVER places",
    description:"Search NAVER's Korean local place API (at most five results) and return names, street addresses and coordinates. Requires NAVER Developers Search API permission. Do not present guesses as search results.",
    inputSchema:objectSchema({query:{...S,minLength:2,maxLength:70,description:"Korean location or establishment keyword"}},["query"]),
    annotations:{readOnlyHint:true,openWorldHint:true},
  },
  {
    name:"create_map_link",title:"Create GPT Maps link",
    description:"Build an exact HTTPS URL opening the given latitude/longitude in the owner's private GPT Maps webpage. This creates a link only; it does not store or alter the map.",
    inputSchema:objectSchema({
      latitude:{...N,minimum:31,maximum:45},
      longitude:{...N,minimum:122,maximum:132},
      zoom:{type:"integer",minimum:6,maximum:21,default:15},
      title:{...S,maxLength:80},
    },["latitude","longitude"]),
    annotations:{readOnlyHint:true,openWorldHint:false},
  },
  {
    name:"create_naver_driving_link",title:"Open NAVER driving directions",
    description:"Create a NAVER Maps driving-app deep link from start and destination coordinates, plus a NAVER Maps web search fallback. No paid Directions API called; does not provide travel time, route geometry or guarantee a route.",
    inputSchema:objectSchema({
      start_latitude:{...N,minimum:31,maximum:45},
      start_longitude:{...N,minimum:122,maximum:132},
      destination_latitude:{...N,minimum:31,maximum:45},
      destination_longitude:{...N,minimum:122,maximum:132},
      start_name:{...S,maxLength:80},
      destination_name:{...S,maxLength:80},
    },["start_latitude","start_longitude","destination_latitude","destination_longitude"]),
    annotations:{readOnlyHint:true,openWorldHint:false},
  },
  {
    name:"get_naver_maps_status",title:"NAVER Maps capabilities",
    description:"Inspect which tools are configured. Does not return credentials or account identity and does not perform paid external API calls.",
    inputSchema:objectSchema({}),
    annotations:{readOnlyHint:true,openWorldHint:false},
  },
];
const PAID_ROUTE_TOOL={
  name:"get_naver_driving_route",title:"Get driving route",
  description:"Get a NAVER Cloud Directions5 driving route only when the owner explicitly enabled paid APIs. This call can incur charges; do not use without user approval.",
  inputSchema:objectSchema({
    start_longitude:{...N,minimum:122,maximum:132},
    start_latitude:{...N,minimum:31,maximum:45},
    destination_longitude:{...N,minimum:122,maximum:132},
    destination_latitude:{...N,minimum:31,maximum:45},
  },["start_longitude","start_latitude","destination_longitude","destination_latitude"]),
  annotations:{readOnlyHint:true,openWorldHint:true},
};
function tools(env){
  return env.ENABLE_PAID_DIRECTIONS==="true"&&env.NAVER_MAPS_CLIENT_SECRET
    ?[...MCP_TOOLS,PAID_ROUTE_TOOL]:MCP_TOOLS;
}
function num(n,min,max){return typeof n==="number"&&Number.isFinite(n)&&n>=min&&n<=max}
function str(s,max){return typeof s==="string"&&s.length<=max}
function validateArgs(args,schema){
  if(!args||typeof args!=="object"||Array.isArray(args))return false;
  if(Object.keys(args).some(k=>!Object.hasOwn(schema.properties,k)))return false;
  for(const k of schema.required)if(!(k in args))return false;
  for(const [k,v] of Object.entries(args)){
    const field=schema.properties[k];
    if(field.type==="string"&&(!str(v,field.maxLength??1000)||(field.minLength&&v.length<field.minLength)))return false;
    if(field.type==="number"&&!num(v,field.minimum??-Infinity,field.maximum??Infinity))return false;
    if(field.type==="integer"&&(!Number.isInteger(v)||!num(v,field.minimum??-Infinity,field.maximum??Infinity)))return false;
  }
  return true;
}
function myMapLink(args,env){
  const u=new URL(env.APP_ORIGIN+"/");
  u.searchParams.set("lat",String(args.latitude));
  u.searchParams.set("lng",String(args.longitude));
  u.searchParams.set("zoom",String(args.zoom??15));
  u.searchParams.set("title",args.title||"지도에서 선택한 위치");
  return u.toString();
}
function drivingLinks(args,env){
  const params=new URLSearchParams({
    slat:String(args.start_latitude),slng:String(args.start_longitude),
    sname:args.start_name||"출발지",dlat:String(args.destination_latitude),
    dlng:String(args.destination_longitude),dname:args.destination_name||"목적지",
    appname:env.APP_ORIGIN,
  });
  return {app_url:"nmap://route/car?"+params.toString(),
    web_search_url:"https://map.naver.com/p/search/"+
      encodeURIComponent(args.destination_name||String(args.destination_latitude)+","+String(args.destination_longitude)),
    note:"Naver app link requires app installed. Web fallback is destination search, not a computed driving route.",
    route_calculated:false,charged_api_called:false};
}
async function callTool(name,args,env){
  const def=tools(env).find(t=>t.name===name);
  if(!def)return toolReply({error:"Unknown or disabled tool."},true);
  if(!validateArgs(args,def.inputSchema))
    return toolReply({error:"Invalid tool arguments."},true);
  if(name==="get_naver_maps_status")return toolReply({
    authenticated:true,
    place_search_configured:Boolean(env.NAVER_LOGIN_CLIENT_ID&&env.NAVER_LOGIN_CLIENT_SECRET),
    paid_directions_enabled:Boolean(env.ENABLE_PAID_DIRECTIONS==="true"&&env.NAVER_MAPS_CLIENT_SECRET),
    tools:tools(env).map(t=>t.name),
    note:"Search API permission can only be validated with an actual query; existing NAVER login does not expose NAVER Maps personal favorites.",
  });
  if(name==="create_map_link")return toolReply({
    map_url:myMapLink(args,env),requires_owner_login:true,place_saved:false});
  if(name==="create_naver_driving_link")return toolReply(drivingLinks(args,env));
  const endpoint=name==="search_naver_places"?"/api/places?q="+encodeURIComponent(args.query):
    "/api/directions?"+new URLSearchParams({
      start:args.start_longitude+","+args.start_latitude,
      goal:args.destination_longitude+","+args.destination_latitude}).toString();
  const url=new URL(endpoint,env.APP_ORIGIN);
  // Reuse the existing server-side NAVER proxy; never expose NAVER secrets.
  const r=await featureRequest(new Request(url.toString()),env,url);
  if(!r)return toolReply({error:"NAVER proxy unavailable"},true);
  let data;
  try{data=await r.json()}catch{return toolReply({error:"NAVER proxy malformed response"},true)}
  return toolReply(data,!r.ok);
}
export async function handleMcp(request,env,ownerSession=false) {
  const allowed=ownerSession||await validMcpToken(request,env);
  if(!allowed){
    return response({error:"Unauthorized MCP client. Use a short-lived bearer token minted by the NAVER-authenticated owner."},
      401,{"WWW-Authenticate":'Bearer realm="gpt-maps-mcp"'});
  }
  const origin=request.headers.get("Origin");
  if(origin&&origin!==env.APP_ORIGIN)return response({error:"Origin not allowed"},403);
  if(request.method!=="POST")return response({error:"Use POST with a JSON-RPC body."},405,{"Allow":"POST"});
  const contentType=request.headers.get("Content-Type")||"";
  if(!/^application\/json(?:\s*;|$)/i.test(contentType))return response({error:"JSON body required."},415);
  const len=Number(request.headers.get("Content-Length")||"0");
  if(len>16*1024)return response({error:"MCP body too large"},413);
  let raw;
  try{
    raw=await request.text();
    if(raw.length>16*1024)return response({error:"MCP body too large"},413);
  }catch{return response({error:"Cannot read body"},400)}
  let msg;
  try{msg=JSON.parse(raw)}catch{return failure(null,-32700,"Parse error")}
  if(!msg||Array.isArray(msg)||typeof msg!=="object"||
      msg.jsonrpc!=="2.0"||typeof msg.method!=="string"){
    return failure(null,-32600,"Invalid Request");
  }
  // Latest MCP clients also send routing headers. Reject disagreement.
  const sentMethod=request.headers.get("Mcp-Method");
  if(sentMethod&&sentMethod!==msg.method)return failure(msg.id??null,-32600,"MCP method header mismatch");
  const sentName=request.headers.get("Mcp-Name");
  if(sentName&&msg.method==="tools/call"&&sentName!==msg.params?.name)
    return failure(msg.id??null,-32600,"MCP name header mismatch");
  if(msg.method.startsWith("notifications/")&&!Object.hasOwn(msg,"id"))
    return new Response(null,{status:202,headers:{"Cache-Control":"no-store","Mcp-Protocol-Version":VERSION}});
  if(!(typeof msg.id==="number"||typeof msg.id==="string"))return failure(null,-32600,"Request id required");
  if(msg.method==="initialize"){
    return rpc(msg.id,{protocolVersion:VERSION,capabilities:{tools:{}},
      serverInfo:{name:"gpt-maps-naver",version:"0.1.0"},
      instructions:"Personal NAVER map tools. Read-only. Search queries require NAVER Search permission; directions are link-only by default. Never infer route metrics without Directions API."});
  }
  if(msg.method==="ping")return rpc(msg.id,{});
  if(msg.method==="tools/list")return rpc(msg.id,{tools:tools(env)});
  if(msg.method==="resources/list"||msg.method==="prompts/list")
    return rpc(msg.id,{[msg.method==="resources/list"?"resources":"prompts":[]});
  if(msg.method==="tools/call"){
    if(!msg.params||typeof msg.params.name!=="string")return failure(msg.id,-32602,"Invalid params");
    try{return rpc(msg.id,await callTool(msg.params.name,msg.params.arguments??{},env))}
    catch{return rpc(msg.id,toolReply({error:"Tool execution failed"},true))}
  }
  return failure(msg.id,-32601,"Method not found");
}
