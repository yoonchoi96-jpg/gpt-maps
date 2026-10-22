/* GPT Maps private enhancement layer: search, pins, directions and Notion sharing. */
(function(){
"use strict";
const $=id=>document.getElementById(id);
const origin=location.origin;
let results=[], selected=null, markers=[], routeLine=null, routeEnabled=false;
const view=()=>window.gptMapsApi?.getView?.()||{lat:37.56668,lng:126.97841,title:"서울 시청",zoom:15};
const map=()=>window.gptMapsApi?.getMap?.();
const notice=(message,color)=>{const el=$("feature-state");el.textContent=message;el.style.color=color||"var(--muted)"};
const fmtDistance=(m)=>m<1000?Math.round(m)+"m":(m/1000).toFixed(1)+"km";
function markerClear(){
  for(const m of markers)m.setMap(null);markers=[];
}
function routeClear(){if(routeLine){routeLine.setMap(null);routeLine=null}}
function selectPlace(item){
  if(!Number.isFinite(item.lat)||!Number.isFinite(item.lng)) {
    notice("검색된 장소에 지도 좌표가 없습니다. 주소를 확인하세요.","#ffcf92");
    return;
  }
  selected=item;
  $("selected-place").textContent="목적지: "+item.name;
  $("selected-place").title=item.address||"";
  const m=map();
  if(m&&window.naver?.maps){
    m.panTo(new naver.maps.LatLng(item.lat,item.lng));
    m.setZoom(Math.max(m.getZoom(),15));
  }
  $("naver-place-link").href="https://map.naver.com/p/search/"+encodeURIComponent(item.name+" "+(item.address||""));
  $("route-app").disabled=false;
  $("route-map").disabled=false;
  $("notion-note").disabled=false;
  $("route-internal").disabled=!routeEnabled;
  routeClear();
}
function renderPlaces(data){
  markerClear();routeClear();
  results=data.places||[];
  selected=null;
  $("selected-place").textContent="검색 결과에서 목적지를 선택하세요.";
  $("route-app").disabled=true;
  $("route-map").disabled=true;
  $("route-internal").disabled=true;
  $("notion-note").disabled=true;
  $("naver-place-link").removeAttribute("href");
  const list=$("place-results");list.replaceChildren();
  const m=map();
  for(const item of results){
    const li=document.createElement("li");
    const btn=document.createElement("button");btn.type="button";btn.className="place-item";
    const name=document.createElement("strong");name.textContent=item.name||"이름 없음";
    const addr=document.createElement("span");addr.textContent=item.address||item.category||"주소 없음";
    btn.append(name,addr);btn.addEventListener("click",()=>selectPlace(item));
    li.appendChild(btn);list.appendChild(li);
    if(m&&window.naver?.maps&&Number.isFinite(item.lat)&&Number.isFinite(item.lng)){
      const pin=new naver.maps.Marker({
        map:m,position:new naver.maps.LatLng(item.lat,item.lng),title:item.name,
      });
      naver.maps.Event.addListener(pin,"click",()=>selectPlace(item));
      markers.push(pin);
    }
  }
  if(results.length===0){notice("일치하는 장소가 없습니다. 더 구체적인 검색어를 입력해 주세요.");return}
  notice(results.length+"건 검색됨 · 장소를 선택하면 지도에 표시됩니다.");
  if(m&&markers.length>1&&window.naver?.maps){
    const b=new naver.maps.LatLngBounds();
    for(const item of results)if(item.lat!=null&&item.lng!=null)b.extend(new naver.maps.LatLng(item.lat,item.lng));
    m.fitBounds(b,{padding:70});
  }
}
async function placesSearch(e){
  e.preventDefault();
  const q=$("search-q").value.trim();
  if(q.length<2||q.length>70)return notice("검색어를 2~70자로 입력해 주세요.","#ffcf92");
  const button=$("search-submit");button.disabled=true;notice("네이버 지역 검색 중...");
  try{
    const response=await fetch("/api/places?q="+encodeURIComponent(q),{headers:{Accept:"application/json"},cache:"no-store"});
    const data=await response.json();
    if(!response.ok)throw Error(data.error||"검색 API 오류 "+response.status);
    renderPlaces(data);
  }catch(err){notice(String(err.message||"검색 실패"),"#ffb5a8")}
  finally{button.disabled=false}
}
function nativeRouteUrl(){
  if(!selected)return null;
  const v=view();
  const q=new URLSearchParams({
    slat:String(v.lat),slng:String(v.lng),sname:v.title||"지도 중심",
    dlat:String(selected.lat),dlng:String(selected.lng),dname:selected.name,
    appname:origin,
  });
  return "nmap://route/car?"+q.toString();
}
function openNaverNavigation(){
  if(!selected)return;
  // The custom URL scheme requires installed NAVER Maps app on mobile.
  // Desktop browsers and app-less devices have a separate web-search option.
  const route=nativeRouteUrl();
  if(route)location.href=route;
  notice("네이버 지도 앱이 설치되지 않았으면 아래 '웹에서 검색' 버튼을 사용해 주세요.");
}
async function showInternalRoute(){
  if(!selected||!routeEnabled)return;
  routeClear();
  const v=view();
  const start=v.lng+","+v.lat,goal=selected.lng+","+selected.lat;
  notice("네이버 Directions 5 경로 조회 중...");
  try{
    const response=await fetch("/api/directions?"+new URLSearchParams({start,goal}),{cache:"no-store"});
    const data=await response.json();
    if(!response.ok)throw Error(data.error||"경로를 불러올 수 없습니다.");
    const m=map();
    if(!m||!window.naver?.maps)throw Error("지도가 아직 준비되지 않았습니다.");
    const path=data.geometry.map(pair=>new naver.maps.LatLng(pair[1],pair[0]));
    routeLine=new naver.maps.Polyline({map:m,path,strokeColor:"#30d59b",strokeWeight:6,strokeOpacity:.85});
    m.fitBounds(routeLine.getBounds(),{padding:60});
    notice("자동차 "+fmtDistance(data.distance)+" · 약 "+Math.round(data.duration/60000)+"분 · 통행료 "+Number(data.tollFare||0).toLocaleString()+"원");
  }catch(err){notice(String(err.message||"경로 실패"),"#ffb5a8")}
}
function currentMapLink(){
  const url=new URL(origin+"/");
  const v=view();
  for(const [key,val] of Object.entries({lat:v.lat,lng:v.lng,zoom:v.zoom,title:v.title}))
    url.searchParams.set(key,String(val));
  return url.toString();
}
async function copyText(str,msg){
  try {await navigator.clipboard.writeText(str);notice(msg,"var(--accent)")}
  catch{window.prompt("아래 내용을 직접 복사해 주세요",str)}
}
function copyNotionLink(){copyText(currentMapLink(),"개인 지도 링크 복사 완료 · Notion에 링크로 붙여 넣으세요.")}
function copyNotionNote(){
  if(!selected)return;
  const v=view();
  const note=[
    "# "+selected.name,
    "",
    "- 주소: "+(selected.address||"미제공"),
    "- 분류: "+(selected.category||"미제공"),
    "- 위치: "+selected.lat+", "+selected.lng,
    "- 출발 기준: "+(v.title||"지도 중심"),
    "- 내 전용 지도: "+currentMapLink(),
    "",
    "> NAVER 지역 검색 결과. 이 주소는 본인 계정 인증 후에만 열립니다.",
  ].join("\n");
  copyText(note,"Notion 메모 복사 완료 · Notion 페이지에 붙여 넣으세요.");
}
async function setup(){
  $("search-form").addEventListener("submit",placesSearch);
  $("route-app").addEventListener("click",openNaverNavigation);
  $("route-internal").addEventListener("click",showInternalRoute);
  $("route-map").addEventListener("click",()=>{
    if(selected)window.open("https://map.naver.com/p/search/"+encodeURIComponent(selected.name+" "+(selected.address||"")),"_blank","noopener,noreferrer");
  });
  $("notion-url").addEventListener("click",copyNotionLink);
  $("notion-note").addEventListener("click",copyNotionNote);
  $("notion-open").addEventListener("click",()=>window.open("https://www.notion.so/","_blank","noopener,noreferrer"));
  $("route-app").disabled=true;$("route-map").disabled=true;$("notion-note").disabled=true;
  $("route-internal").disabled=true;
  try{
    const res=await fetch("/api/features",{cache:"no-store"});
    if(!res.ok)return;
    const cfg=await res.json();
    routeEnabled=cfg.directions===true;
    $("route-internal").hidden=!routeEnabled;
    $("route-internal-hint").hidden=routeEnabled;
  }catch{/* Map remains usable without feature status. */}
}
setup();
})();
