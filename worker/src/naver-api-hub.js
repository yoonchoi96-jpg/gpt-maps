/**
 * NAVER API HUB read-only gateway (2026).
 * Owner session or authenticated MCP only. No exposed credentials.
 * NAVER_API_HUB_ENABLED must be exactly "true" AND HUB credentials bound.
 * An NCP Application quota must be configured before enabling.
 */
const HUB="https://naverapihub.apigw.ntruss.com";
const TYPES=Object.freeze({
  news:"news",blog:"blog",local:"local",cafe:"cafearticle",
  kin:"kin",encyclopedia:"encyc",image:"image",web:"webkr",
  errata:"errata",adult:"adult",
});
const TYPES_PUBLIC=Object.freeze(Object.keys(TYPES));
const SEARCH_TYPES=new Set(["news","blog","local","cafe","kin","encyclopedia","image","web"]);
const SAFE_HEADERS={"Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
const LIMIT_BYTES=7000;
function json(v,code=200){return new Response(JSON.stringify(v),{status:code,headers:SAFE_HEADERS})}
function fail(code,message){return json({error:message},code)}
function validText(s,n=75){return typeof s==="string"&&s.trim().length>=2&&s.trim().length<=n}
function clean(v,n=450){return String(v??"").replace(/<[^>]*>/g,"").trim().slice(0,n)}
function httpURL(raw){
  try{const u=new URL(raw);return ["https:","http:"].includes(u.protocol)&&!u.username&&!u.password&&u.hostname?u.href:null}
  catch{return null}
}
function coordinate(v,min,max){
  const n=Number(v);
  if(v===null||v===undefined||v==="")return null;
  const pos=Number.isInteger(n)&&Math.abs(n)>1000000?n/10000000:n;
  return Number.isFinite(pos)&&pos>=min&&pos<=max?pos:null;
}
function isISO(s,minDate){
  if(typeof s!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(s)||s<minDate)return false;
  const d=new Date(s+"T00:00:00Z");
  return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s&&s<=new Date().toISOString().slice(0,10);
}
function basePeriod(args,minDate){
  if(!args||typeof args!=="object"||Array.isArray(args))return null;
  if(!isISO(args.startDate,minDate)||!isISO(args.endDate,minDate)||
     args.startDate>args.endDate||!["date","week","month"].includes(args.timeUnit))return null;
  const fields={startDate:args.startDate,endDate:args.endDate,timeUnit:args.timeUnit};
  if(args.device!==undefined){if(!["pc","mo"].includes(args.device))return null;fields.device=args.device}
  if(args.gender!==undefined){if(!["m","f"].includes(args.gender))return null;fields.gender=args.gender}
  return fields;
}
function enabled(env){return env.NAVER_API_HUB_ENABLED==="true"&&
  Boolean(env.NAVER_API_HUB_CLIENT_ID&&env.NAVER_API_HUB_CLIENT_SECRET)}
function provider(){
  return {provider:"NAVER API HUB",api_origin:HUB,official_quota_required:true};
}
function authHeaders(env,post=false){
  return {
    "X-NCP-APIGW-API-KEY-ID":env.NAVER_API_HUB_CLIENT_ID,
    "X-NCP-APIGW-API-KEY":env.NAVER_API_HUB_CLIENT_SECRET,
    Accept:"application/json",
    ...(post?{"Content-Type":"application/json"}:{}),
  };
}
async function upstream(path,env,body=null){
  const url=HUB+path;
  try{
    const res=await fetch(url,{
      method:body===null?"GET":"POST",
      redirect:"manual",headers:authHeaders(env,body!==null),
      ...(body===null?{}:{body:JSON.stringify(body)}),
      signal:AbortSignal.timeout(8000),
    });
    if(res.status===401||res.status===403)return fail(403,"NAVER API HUB 앱 키 또는 해당 API 이용 권한을 확인하세요.");
    if(res.status===429)return fail(429,"NAVER API HUB 이용량 한도 또는 속도 제한에 도달했습니다.");
    if(!res.ok)return fail(502,"NAVER API HUB 응답 오류("+res.status+").");
    // Limit processed body size. Never return upstream headers or secrets.
    const t=await res.text();
    if(t.length>450000)return fail(502,"NAVER API HUB 응답이 제한 크기를 넘었습니다.");
    const d=JSON.parse(t);
    return d;
  }catch{return fail(502,"NAVER API HUB 연결 또는 JSON 응답 처리에 실패했습니다.")}
}
function isResponse(x){return x instanceof Response}
function prepare(env){
  if(!enabled(env))return fail(503,"NAVER API HUB가 아직 활성화되지 않았습니다. Omari HUB 앱의 Client ID/Secret을 Worker에 등록하고 NCP에서 이용 한도 설정 후 NAVER_API_HUB_ENABLED=true로 활성화해야 합니다.");
  return null;
}
function sourceItem(item,type,index){
  const result={
    rank:index+1,title:clean(item?.title,210),
    description:clean(item?.description,800),
    link:httpURL(item?.link),
  };
  if(type==="news") {result.original_link=httpURL(item?.originallink);result.published_at=clean(item?.pubDate,85)}
  if(type==="blog")result.published_at=clean(item?.postdate,25);
  if(type==="image"){result.image_url=httpURL(item?.link);result.page_url=httpURL(item?.thumbnail);result.image_size={width:Number(item?.sizewidth)||null,height:Number(item?.sizeheight)||null}}
  if(type==="local"){
    result.category=clean(item?.category,90);
    result.address=clean(item?.roadAddress||item?.address,200);
    result.latitude=coordinate(item?.mapy,31,45);
    result.longitude=coordinate(item?.mapx,122,132);
  }
  return result;
}
export const HUB_SEARCH_TYPES=TYPES_PUBLIC;
export function hubStatus(env){
  return {...provider(),configured:Boolean(env.NAVER_API_HUB_CLIENT_ID&&env.NAVER_API_HUB_CLIENT_SECRET),
    enabled:enabled(env),available_search_types:TYPES_PUBLIC,
    trend_available:true,shopping_insight_available:true,
    retired_endpoints:["shopping_product_search","book_search","document_search"],
    note:"Configured means credentials are bound, not that NAVER API HUB permissions or API queries are verified. Set a hard NCP application quota before enabling."};
}
export async function hubSearch(env,args){
  if(!args||!TYPES[args.type])return fail(400,"지원하지 않는 NAVER 검색 분류입니다.");
  if(!validText(args.query))return fail(400,"검색어 길이는 2~75자입니다.");
  const block=prepare(env);if(block)return block;
  const simple=!SEARCH_TYPES.has(args.type);
  const display=args.type==="local"?5:Math.min(Number(args.display)||5,10);
  if(!simple&&(!Number.isInteger(display)||display<1||display>(args.type==="local"?5:10)))
    return fail(400,"검색 결과는 한 번에 최대 10건(지역 5건)입니다.");
  const u=new URL(HUB+"/search/v1/"+TYPES[args.type]);
  u.searchParams.set("query",args.query.trim());
  u.searchParams.set("format","json");
  if(!simple){
    u.searchParams.set("display",String(display));
    u.searchParams.set("start","1");
    if(["news","blog","cafe","kin"].includes(args.type))
      u.searchParams.set("sort",args.sort==="date"?"date":"sim");
  }
  const res=await upstream(u.pathname+u.search,env);
  if(isResponse(res))return res;
  if(simple)return json({...provider(),type:args.type,query:args.query,
    ...(args.type==="errata"?{suggestion:clean(res.errata,160)}:{adult:String(res.adult||"0")==="1"})});
  const items=Array.isArray(res.items)?res.items.slice(0,display):[];
  return json({...provider(),type:args.type,query:args.query.trim(),
    total:Number(res.total)||0,returned:items.length,
    items:items.map((x,i)=>sourceItem(x,args.type,i)),
    attribution:"NAVER 검색 결과. 원본 순서 유지. 원본 기사/페이지 URL을 함께 표시하세요."});
}
export async function hubTrend(env,args){
  const block=prepare(env);if(block)return block;
  const period=basePeriod(args,"2016-01-01");
  if(!period)return fail(400,"조회 기간 또는 일/주/월 단위를 확인하세요.");
  if(!Array.isArray(args.keywordGroups)||args.keywordGroups.length<1||args.keywordGroups.length>5)
    return fail(400,"검색어 그룹은 1~5개입니다.");
  const groups=[];
  for(const group of args.keywordGroups){
    if(!group||!validText(group.groupName,50)||!Array.isArray(group.keywords)||
      group.keywords.length<1||group.keywords.length>20||
      !group.keywords.every(x=>typeof x==="string"&&x.trim().length>=1&&x.trim().length<=60))
      return fail(400,"그룹명 또는 검색어(그룹당 1~20개)를 확인하세요.");
    groups.push({groupName:group.groupName.trim(),keywords:group.keywords.map(x=>x.trim())});
  }
  if(args.ages!==undefined){
    if(!Array.isArray(args.ages)||args.ages.length>11||!args.ages.every(x=>/^(?:[1-9]|10|11)$/.test(String(x))))return fail(400,"연령대 필터를 확인하세요.");
    period.ages=args.ages.map(String);
  }
  const res=await upstream("/search-trend/v1/search",env,{...period,keywordGroups:groups});
  if(isResponse(res))return res;
  return json({...provider(),type:"search_trend",...period,
    interpretation:"각 요청 결과 내부의 상대적 검색량 지수(최댓값 100)이며 절대 검색 건수가 아닙니다.",
    results:Array.isArray(res.results)?res.results.slice(0,5).map(g=>({
      title:clean(g.title,100),keywords:Array.isArray(g.keywords)?g.keywords.slice(0,20).map(x=>clean(x,70)):[],
      data:Array.isArray(g.data)?g.data.slice(0,3700).map(p=>({
        period:clean(p.period,15),ratio:Number.isFinite(Number(p.ratio))?Number(p.ratio):null,
      })):[],
    })):[]});
}
export async function hubShoppingInsight(env,args){
  const block=prepare(env);if(block)return block;
  const period=basePeriod(args,"2017-08-01");
  if(!period)return fail(400,"쇼핑 트렌드 조회 기간 또는 일/주/월 단위를 확인하세요.");
  if(args.ages!==undefined){
    if(!Array.isArray(args.ages)||args.ages.length>6||
      !args.ages.every(x=>["10","20","30","40","50","60"].includes(String(x))))
      return fail(400,"쇼핑 연령대 필터를 확인하세요.");
    period.ages=args.ages.map(String);
  }
  if(!["categories","keywords"].includes(args.kind))
    return fail(400,"쇼핑 인사이트 유형은 categories 또는 keywords입니다.");
  let path,body;
  if(args.kind==="categories"){
    if(!Array.isArray(args.categories)||args.categories.length<1||args.categories.length>3||
      !args.categories.every(x=>x&&validText(x.name,60)&&/^\d{4,12}$/.test(String(x.param))))
      return fail(400,"쇼핑 분야는 1~3개이며 카테고리 코드가 필요합니다.");
    path="/shopping/v1/categories";
    body={...period,category:args.categories.map(x=>({name:x.name,param:[String(x.param)]}))};
  }else{
    if(!/^\d{4,12}$/.test(String(args.category||""))||!Array.isArray(args.keywords)||
      args.keywords.length<1||args.keywords.length>5||
      !args.keywords.every(x=>x&&validText(x.name,60)&&validText(x.keyword,75)))
      return fail(400,"쇼핑 카테고리 코드와 1~5개 키워드가 필요합니다.");
    path="/shopping/v1/category/keywords";
    body={...period,category:String(args.category),
      keyword:args.keywords.map(x=>({name:x.name,param:[x.keyword]}))};
  }
  const res=await upstream(path,env,body);
  if(isResponse(res))return res;
  return json({...provider(),type:"shopping_insight",kind:args.kind,
    interpretation:"네이버쇼핑 검색 클릭 상대 추이이며 판매량·매출액·구매 전환을 나타내지 않습니다.",
    results:Array.isArray(res.results)?res.results.slice(0,5).map(x=>({
      title:clean(x.title,90),
      data:Array.isArray(x.data)?x.data.slice(0,3700).map(p=>({period:clean(p.period,16),
        ratio:Number.isFinite(Number(p.ratio))?Number(p.ratio):null})):[],
    })):[]});
}
export async function handleHub(request,env,url){
  if(url.pathname==="/api/hub/status"&&request.method==="GET")return json(hubStatus(env));
  if(url.pathname==="/api/hub/search"&&request.method==="GET")
    return hubSearch(env,{type:url.searchParams.get("type"),query:url.searchParams.get("q"),
      sort:url.searchParams.get("sort"),display:Number(url.searchParams.get("display")||5)});
  if((url.pathname==="/api/hub/trend"||url.pathname==="/api/hub/shopping")&&request.method==="POST"){
    const origin=request.headers.get("Origin");
    if(origin&&origin!==env.APP_ORIGIN)return fail(403,"다른 출처의 요청은 허용하지 않습니다.");
    if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type")||""))
      return fail(415,"JSON 형식만 허용합니다.");
    const declared=Number(request.headers.get("Content-Length")||"0");
    if(declared>LIMIT_BYTES)return fail(413,"요청 크기가 너무 큽니다.");
    let s;try{s=await request.text()}catch{return fail(400,"요청 본문을 읽지 못했습니다.")}
    if(s.length>LIMIT_BYTES)return fail(413,"요청 크기가 너무 큽니다.");
    let args;try{args=JSON.parse(s)}catch{return fail(400,"잘못된 JSON 형식입니다.")}
    return url.pathname==="/api/hub/trend"?hubTrend(env,args):hubShoppingInsight(env,args);
  }
  return fail(405,"허용되지 않은 NAVER API HUB 요청 방식입니다.");
}
