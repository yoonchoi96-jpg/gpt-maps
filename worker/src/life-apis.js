/**
 * Omari Life API gateway: fixed upstream hosts, read-only operations, no public proxy.
 * No provider is contacted unless its explicit opt-in flag AND credential are present.
 * Paid Google Places is doubly gated by a separate billing approval flag.
 */
const HEADERS={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
const ACTIONS=Object.freeze({
  bus_arrivals:{group:"transport",secret:"DATA_GO_KR_SERVICE_KEY",flag:"OMARI_LIFE_PUBLIC_ENABLED",billing:"free_quota"},
  weather_now:{group:"weather_air",secret:"DATA_GO_KR_SERVICE_KEY",flag:"OMARI_LIFE_PUBLIC_ENABLED",billing:"free_quota"},
  air_quality:{group:"weather_air",secret:"DATA_GO_KR_SERVICE_KEY",flag:"OMARI_LIFE_PUBLIC_ENABLED",billing:"free_quota"},
  tour_search:{group:"tour",secret:"DATA_GO_KR_SERVICE_KEY",flag:"OMARI_LIFE_PUBLIC_ENABLED",billing:"free_quota"},
  flight_domestic:{group:"flights",secret:"DATA_GO_KR_SERVICE_KEY",flag:"OMARI_LIFE_PUBLIC_ENABLED",billing:"free_quota"},
  ecos_series:{group:"ecos",secret:"ECOS_API_KEY",flag:"OMARI_LIFE_PUBLIC_ENABLED",billing:"free_quota"},
  apt_sales:{group:"realestate",secret:"DATA_GO_KR_SERVICE_KEY",flag:"OMARI_LIFE_PUBLIC_ENABLED",billing:"free_quota"},
  youtube_video:{group:"youtube",secret:"YOUTUBE_DATA_API_KEY",flag:"OMARI_YOUTUBE_ENABLED",billing:"quota"},
  places_text_search:{group:"google_places",secret:"GOOGLE_PLACES_API_KEY",flag:"OMARI_GOOGLE_PLACES_ENABLED",billing:"paid"},
  ha_sensor:{group:"home_assistant",secret:"HOME_ASSISTANT_TOKEN",flag:"OMARI_HOME_ASSISTANT_ENABLED",billing:"private"},
});
const VALID_ACTIONS=Object.keys(ACTIONS);
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const fail=(status,error)=>json({error},status);
const valid=(v,pattern)=>typeof v==="string"&&pattern.test(v);
const txt=(v,max=200)=>String(v??"").replace(/<[^>]*>/g,"").slice(0,max);
const clamp=(v,min,max)=>Math.max(min,Math.min(max,Number(v)||min));
const kstNow=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10).replaceAll("-","");
function enabled(env,action){
  const x=ACTIONS[action];
  return !!x && env[x.flag]==="true" && !!env[x.secret] &&
    (action!=="places_text_search"||env.OMARI_GOOGLE_PLACES_BILLING_APPROVED==="true") &&
    (action!=="ha_sensor"||!!env.HOME_ASSISTANT_URL);
}
export function lifeStatus(env){
  const groups=["transport","weather_air","tour","flights","ecos","realestate","youtube","google_places","home_assistant"];
  return {service:"Omari Life APIs",live_queries_verified:false,
    providers:groups.map(group=>{
      const ops=VALID_ACTIONS.filter(k=>ACTIONS[k].group===group);
      return {name:group,operations:ops,configured:ops.every(k=>!!env[ACTIONS[k].secret])&&
        (group!=="home_assistant"||!!env.HOME_ASSISTANT_URL),
        enabled:ops.every(k=>enabled(env,k)),
        billing:group==="google_places"?"paid_requires_explicit_approval":ACTIONS[ops[0]].billing};
    }),
    note:"Configured/enabled only reflect Worker settings, not provider approval or successful live queries."};
}
function publicUrl(path,params,env){
  const u=new URL("https://apis.data.go.kr"+path);
  u.searchParams.set("serviceKey",env.DATA_GO_KR_SERVICE_KEY);
  for(const [k,v] of Object.entries(params))u.searchParams.set(k,String(v));
  return u;
}
function paramsFor(action,args,env){
  const p={numOfRows:"10",pageNo:"1",_type:"json"};
  switch(action){
    case "bus_arrivals":
      if(!valid(args.cityCode,/^\d{1,6}$/)||!valid(args.nodeId,/^[A-Za-z0-9_-]{2,40}$/))return null;
      return {url:publicUrl("/1613000/ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList",{...p,cityCode:args.cityCode,nodeId:args.nodeId},env),kind:"public"};
    case "weather_now":
      if(!valid(args.baseDate,/^\d{8}$/)||!valid(args.baseTime,/^\d{4}$/)||
         Number(args.nx)<1||Number(args.nx)>149||Number(args.ny)<1||Number(args.ny)>253||
         !Number.isInteger(Number(args.nx))||!Number.isInteger(Number(args.ny)))return null;
      return {url:publicUrl("/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst",
        {...p,base_date:args.baseDate,base_time:args.baseTime,nx:args.nx,ny:args.ny},env),kind:"public"};
    case "air_quality":
      if(!valid(args.stationName,/^[\p{L}\p{N} ()-]{2,35}$/u))return null;
      return {url:publicUrl("/B552584/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty",
        {...p,stationName:args.stationName,dataTerm:"DAILY",ver:"1.5"},env),kind:"public"};
    case "tour_search":
      if(!valid(args.keyword,/^.{2,60}$/u))return null;
      return {url:publicUrl("/B551011/KorService2/searchKeyword2",
        {...p,MobileOS:"ETC",MobileApp:"Omari",keyword:args.keyword},env),kind:"public"};
    case "flight_domestic":
      if(!valid(args.departure,/^[A-Z0-9]{3,12}$/)||!valid(args.arrival,/^[A-Z0-9]{3,12}$/))return null;
      return {url:publicUrl("/1613000/DmstcFlightNvgInfo/GetFlightOpratInfoList",
        {...p,depAirportId:args.departure,arrAirportId:args.arrival},env),kind:"public"};
    case "apt_sales":
      if(!valid(args.districtCode,/^\d{5}$/)||!valid(args.month,/^20\d{4}$/)||
         Number(args.month.slice(4))<1||Number(args.month.slice(4))>12)return null;
      return {url:publicUrl("/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade",
        {LAWD_CD:args.districtCode,DEAL_YMD:args.month,numOfRows:"10",pageNo:"1"},env),kind:"xml"};
    case "ecos_series":{
      if(!valid(args.statCode,/^[A-Za-z0-9_.]{2,35}$/)||!valid(args.cycle,/^[AQMYD]$/)||
         !valid(args.start,/^\d{4,8}$/)||!valid(args.end,/^\d{4,8}$/)||
         args.start>args.end)return null;
      const parts=[env.ECOS_API_KEY,"json","kr","1","10",args.statCode,args.cycle,args.start,args.end];
      if(args.itemCode){if(!valid(args.itemCode,/^[A-Za-z0-9_.]{1,30}$/))return null;parts.push(args.itemCode)}
      return {url:new URL("https://ecos.bok.or.kr/api/StatisticSearch/"+parts.map(encodeURIComponent).join("/")),kind:"ecos",secrets:[env.ECOS_API_KEY]};
    }
    case "youtube_video":
      if(!valid(args.videoId,/^[A-Za-z0-9_-]{11}$/))return null;
      {const u=new URL("https://www.googleapis.com/youtube/v3/videos");
       u.searchParams.set("id",args.videoId);u.searchParams.set("part","snippet,statistics");
       u.searchParams.set("key",env.YOUTUBE_DATA_API_KEY);
       return {url:u,kind:"youtube"};}
    case "places_text_search":
      if(!valid(args.query,/^.{2,80}$/u))return null;
      return {url:new URL("https://places.googleapis.com/v1/places:searchText"),
        kind:"places",body:JSON.stringify({textQuery:args.query,pageSize:3,languageCode:"ko"}),
        headers:{"Content-Type":"application/json","X-Goog-Api-Key":env.GOOGLE_PLACES_API_KEY,
          "X-Goog-FieldMask":"places.id,places.displayName,places.formattedAddress"}};
    case "ha_sensor":{
      if(!valid(args.entityId,/^(sensor|binary_sensor|weather)\.[a-z0-9_]{1,80}$/))return null;
      let base;try{base=new URL(env.HOME_ASSISTANT_URL)}catch{return null}
      if(base.protocol!=="https:"||base.username||base.password||base.search||base.hash||
         base.port&&base.port!=="443"||!base.hostname.includes(".")||
         /^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(base.hostname)||
         /^(?:\d{1,3}\.){3}\d{1,3}$/.test(base.hostname))return null;
      return {url:new URL("/api/states/"+args.entityId,base.origin),kind:"ha",
        headers:{Authorization:"Bearer "+env.HOME_ASSISTANT_TOKEN}};
    }
  }
  return null;
}
async function fetchBound(spec){
  try{
    const r=await fetch(spec.url,{method:spec.body?"POST":"GET",
      headers:spec.headers||{Accept:"application/json"},body:spec.body,
      redirect:"manual",signal:AbortSignal.timeout(7000)});
    if(r.status>=300&&r.status<400)return fail(502,"Provider redirect refused.");
    if(r.status===401||r.status===403)return fail(403,"Provider credentials or API approval missing.");
    if(r.status===429)return fail(429,"Provider quota exceeded.");
    if(!r.ok)return fail(502,"Provider request failed ("+r.status+").");
    const contentLength=Number(r.headers.get("Content-Length")||0);
    if(contentLength>120000)return fail(502,"Provider response too large.");
    const t=await r.text();
    if(t.length>120000)return fail(502,"Provider response too large.");
    // Never forward upstream headers or query URLs; scrub credentials if upstream echoes them.
    let raw=t;
    for(const secret of [spec.url.searchParams.get("serviceKey"),spec.url.searchParams.get("key"),...(spec.secrets||[])]){
      if(secret&&secret.length>=4)raw=raw.replaceAll(secret,"[REDACTED]");
    }
    if(spec.kind==="xml")return json({format:"xml",excerpt:raw.slice(0,12000),truncated:raw.length>12000});
    let data;try{data=JSON.parse(raw)}catch{return fail(502,"Provider did not return valid JSON.");}
    if(spec.kind==="ha")return json({entity_id:txt(data.entity_id,90),state:txt(data.state,100),
      last_updated:txt(data.last_updated,40),
      attributes:{friendly_name:txt(data.attributes?.friendly_name,100),
        unit_of_measurement:txt(data.attributes?.unit_of_measurement,25)}});
    if(spec.kind==="places")return json({provider:"Google Places (New)",paid_api:true,
      items:(data.places||[]).slice(0,3).map(x=>({id:txt(x.id,140),
        name:txt(x.displayName?.text,160),address:txt(x.formattedAddress,250)}))});
    if(spec.kind==="youtube")return json({provider:"YouTube Data API",quota_units:1,
      items:(data.items||[]).slice(0,1).map(x=>({id:txt(x.id,15),
        title:txt(x.snippet?.title,200),channel:txt(x.snippet?.channelTitle,120),
        published_at:txt(x.snippet?.publishedAt,40),
        view_count:txt(x.statistics?.viewCount,30)}))});
    if(spec.kind==="ecos")return json({provider:"BOK ECOS",results:(data.StatisticSearch?.row||[]).slice(0,10)
      .map(x=>({stat:txt(x.STAT_NAME,150),item:txt(x.ITEM_NAME1,150),
        period:txt(x.TIME,15),value:txt(x.DATA_VALUE,50),unit:txt(x.UNIT_NAME,50)})),
      error:data.RESULT?.MESSAGE?txt(data.RESULT.MESSAGE,180):undefined});
    const response=data.response;
    const header=response?.header;
    if(header&&header.resultCode&&String(header.resultCode)!=="00")
      return fail(502,"Public-data provider error code: "+txt(header.resultCode,15));
    const items=response?.body?.items?.item;
    const list=Array.isArray(items)?items:items?[items]:[];
    return json({provider:"data.go.kr",results:list.slice(0,10),total:response?.body?.totalCount??null});
  }catch{return fail(502,"Upstream timeout or network error.");}
}
export async function lifeCall(env,action,args={}){
  if(!Object.hasOwn(ACTIONS,action))return fail(400,"Unsupported Life API action.");
  if(!enabled(env,action))return fail(503,"Provider not enabled or credential missing. No upstream request made.");
  const spec=paramsFor(action,args,env);
  if(!spec)return fail(400,"Invalid or unsupported parameters.");
  return fetchBound(spec);
}
export async function handleLife(request,env,url){
  if(url.pathname==="/api/life/status"&&request.method==="GET")return json(lifeStatus(env));
  if(url.pathname==="/api/life/query"&&request.method==="GET"){
    const args=Object.fromEntries(url.searchParams.entries());
    const action=args.action;delete args.action;
    return lifeCall(env,action,args);
  }
  return fail(405,"Only read-only GET operations supported.");
}
export const LIFE_ACTIONS=VALID_ACTIONS;
