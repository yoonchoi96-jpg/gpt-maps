/**
 * Owner-only NAVER Places Search and opt-in Directions5 APIs.
 * Must be called AFTER signed-session verification, never before.
 * All upstream credentials remain server-side only.
 */
const SAFE = {"Cache-Control":"no-store","Content-Type":"application/json; charset=utf-8",
  "X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
function result(value,status=200){return new Response(JSON.stringify(value),{status,headers:SAFE})}
function label(s,max=160){return String(s||"").replace(/<[^>]*>/g,"").replace(/\s+/g," ").trim().slice(0,max)}
function coord(raw,min,max){
  const n=Number(raw);
  // NAVER Local API WGS84 values are integer degrees times 10^7.
  const v=Number.isInteger(n)&&Math.abs(n)>1000000?n/10000000:n;
  return Number.isFinite(v)&&v>=min&&v<=max?v:null;
}
function point(s){
  if(typeof s!=="string"||s.length>100) return null;
  const a=s.split(",");
  if(a.length!==2)return null;
  const lng=Number(a[0]),lat=Number(a[1]);
  return Number.isFinite(lng)&&lng>=122&&lng<=132&&
    Number.isFinite(lat)&&lat>=31&&lat<=45?
      {lng,lat}:null;
}
function fail(status,message){return result({error:message},status)}
export async function featureRequest(request,env,url) {
  if(request.method!=="GET")return fail(405,"GET 요청만 허용됩니다.");
  if(url.pathname==="/api/features"){
    return result({
      places: Boolean(env.NAVER_LOGIN_CLIENT_ID&&env.NAVER_LOGIN_CLIENT_SECRET),
      directions: Boolean(env.NAVER_MAPS_CLIENT_SECRET&&env.ENABLE_PAID_DIRECTIONS==="true"),
      directionsRequiresOptIn: true,
      notion: "copy_link_and_markdown",
      naverLogin:"verified",
    });
  }
  if(url.pathname==="/api/places"){
    const q=(url.searchParams.get("q")||"").trim();
    if(q.length<2||q.length>70)return fail(400,"검색어는 2~70자로 입력해 주세요.");
    if(!env.NAVER_LOGIN_CLIENT_ID||!env.NAVER_LOGIN_CLIENT_SECRET)
      return fail(503,"네이버 개발자센터 검색 API 키가 설정되지 않았습니다.");
    // NAVER Developers Search API is a no-login API. Restrict query
    // counts and response size; user must explicitly submit search.
    const upstream=new URL("https://openapi.naver.com/v1/search/local.json");
    upstream.searchParams.set("query",q);
    upstream.searchParams.set("display","5");
    upstream.searchParams.set("start","1");
    try {
      const res=await fetch(upstream.toString(),{
        method:"GET",redirect:"manual",
        headers:{
          "X-Naver-Client-Id":env.NAVER_LOGIN_CLIENT_ID,
          "X-Naver-Client-Secret":env.NAVER_LOGIN_CLIENT_SECRET,
          Accept:"application/json",
        },
        signal:AbortSignal.timeout(7000),
      });
      if(res.status===403)return fail(403,"네이버 로그인 앱에 '검색' API 권한을 추가해야 합니다. 네이버 개발자센터 > 내 애플리케이션 > API 설정에서 검색을 선택해 주세요.");
      if(res.status===429)return fail(429,"네이버 검색 API 호출 한도에 도달했습니다.");
      if(!res.ok)return fail(502,"네이버 장소 검색 API 응답 오류("+res.status+").");
      const data=await res.json();
      const items=Array.isArray(data?.items)?data.items.slice(0,5):[];
      const places=items.map((item,i)=>({
        id:i,
        name:label(item.title,100),
        category:label(item.category,90),
        address:label(item.roadAddress||item.address,150),
        lat:coord(item.mapy,31,45),
        lng:coord(item.mapx,122,132),
        // Do not blindly forward third-party URLs or embedded markup.
      }));
      return result({query:q,places,total:places.length});
    }catch{return fail(502,"장소 검색 서버에 연결할 수 없습니다.");}
  }
  if(url.pathname==="/api/directions"){
    // Explicit paid API opt-in required; no metered query without it.
    if(env.ENABLE_PAID_DIRECTIONS!=="true")
      return fail(503,"Directions 5 API는 사용량 과금 가능성 때문에 비활성화돼 있습니다. 네이버 지도 앱 길찾기 연결을 이용하세요.");
    if(!env.NAVER_MAPS_CLIENT_SECRET)
      return fail(503,"NAVER_MAPS_CLIENT_SECRET을 Cloudflare Secret에 등록해야 합니다.");
    const start=point(url.searchParams.get("start")),goal=point(url.searchParams.get("goal"));
    if(!start||!goal)return fail(400,"출발지와 목적지 좌표가 올바르지 않습니다.");
    const endpoint=new URL("https://maps.apigw.ntruss.com/map-direction/v1/driving");
    endpoint.searchParams.set("start",start.lng+","+start.lat);
    endpoint.searchParams.set("goal",goal.lng+","+goal.lat);
    endpoint.searchParams.set("option","traoptimal");
    try{
      const res=await fetch(endpoint,{
        headers:{
          "x-ncp-apigw-api-key-id":env.NAVER_MAPS_CLIENT_ID||"napr2ensb6",
          "x-ncp-apigw-api-key":env.NAVER_MAPS_CLIENT_SECRET,
          "Accept":"application/json",
        },redirect:"manual",signal:AbortSignal.timeout(8000)
      });
      if(!res.ok)return fail(502,"네이버 자동차 길찾기 API가 "+res.status+"을 반환했습니다.");
      const data=await res.json();
      const route=data?.route?.traoptimal?.[0];
      if(!route||!Array.isArray(route.path))return fail(404,"탐색 가능한 자동차 경로가 없습니다.");
      const geometry=route.path.slice(0,12000).filter(pair=>Array.isArray(pair)&&point(pair.join(",")));
      return result({distance:route.summary?.distance||0,
        duration:route.summary?.duration||0,
        tollFare:route.summary?.tollFare||0,geometry});
    }catch{return fail(502,"자동차 길찾기 서버 통신에 실패했습니다.");}
  }
  return null;
}
