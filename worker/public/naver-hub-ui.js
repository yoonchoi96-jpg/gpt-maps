/* Owner-only NAVER API HUB browser controls. No third-party scripts or tokens. */
(function(){
 "use strict";
 const $=id=>document.getElementById(id);
 if(!$("hub-search-form"))return;
 const esc=(v,max=500)=>String(v??"").slice(0,max);
 const state=$("hub-ready");
 let active=false;
 const buttons=["hub-search-submit","hub-trend-submit","hub-shopping-submit"];
 const setEnabled=x=>{active=!!x;buttons.forEach(id=>$(id).disabled=!active)};
 const results=$("hub-search-results");
 const addText=(container,text)=>{
   const li=document.createElement("li");li.textContent=esc(text,400);container.appendChild(li);
   return li;
 };
 function errorFor(output,res){
   if(!res.ok)throw Error(output.error||"NAVER API HUB 요청 실패("+res.status+")");
   return output;
 }
 const pad=d=>d.toISOString().slice(0,10);
 const today=new Date(),monthAgo=new Date(today.getTime()-30*86400000);
 for(const prefix of ["hub-trend","hub-shopping"]){
   $(prefix+"-start").value=pad(monthAgo);
   $(prefix+"-end").value=pad(today);
 }
 (async()=>{
   try{
     const res=await fetch("/api/hub/status",{cache:"no-store"});
     const status=errorFor(await res.json(),res);
     setEnabled(status.enabled);
     if(active)state.textContent="NAVER API HUB 설정됨 · 검색 결과를 실제로 불러오는지는 검색 후 확인됩니다.";
     else state.textContent="사용 대기 · API HUB Omari 앱의 Cloudflare 인증키와 NCP 이용 한도 등록이 필요합니다.";
   }catch{state.textContent="API HUB 연결 상태를 확인할 수 없습니다."}
 })();
 $("hub-search-form").addEventListener("submit",async e=>{
   e.preventDefault();if(!active)return;
   results.replaceChildren();const type=$("hub-type").value,query=$("hub-search-q").value.trim();
   if(query.length<2)return;
   state.textContent="NAVER API HUB에서 조회 중...";setEnabled(false);
   try{
     const params=new URLSearchParams({type,q:query,display:"5"});
     const response=await fetch("/api/hub/search?"+params,{cache:"no-store"});
     const data=errorFor(await response.json(),response);
     state.textContent="NAVER API HUB 실제 검색 · "+(data.returned??1)+"건";
     if(type==="adult"){addText(results,"네이버 검색어 분류: "+(data.adult?"성인 검색어":"일반 검색어"));return}
     if(type==="errata"){addText(results,"네이버 오타변환: "+(data.suggestion||"변환 결과 없음"));return}
     if(!Array.isArray(data.items)||!data.items.length){addText(results,"검색 결과가 없습니다.");return}
     for(const item of data.items){
       const li=document.createElement("li");
       const name=document.createElement("strong");name.textContent=esc(item.title,200);
       li.appendChild(name);
       if(item.address){const addr=document.createElement("div");addr.textContent=esc(item.address,200);li.appendChild(addr)}
       if(item.description){const desc=document.createElement("div");desc.style.color="var(--muted)";desc.textContent=esc(item.description,200);li.appendChild(desc)}
       const link=item.original_link||item.link;
       if(typeof link==="string"&&/^https?:\/\//.test(link)){
         const a=document.createElement("a");a.href=link;a.target="_blank";a.rel="noopener noreferrer";a.textContent="네이버 검색 원문 열기 ↗";
         li.appendChild(a);
       }
       if(item.latitude!==null&&item.longitude!==null&&item.latitude!==undefined){
         const u=new URL(location.origin+"/");
         u.searchParams.set("lat",String(item.latitude));u.searchParams.set("lng",String(item.longitude));
         u.searchParams.set("zoom","16");u.searchParams.set("title",item.title||"검색 위치");
         const a=document.createElement("a");a.href=u.toString();a.textContent=" · 지도 보기";li.appendChild(a);
       }
       results.appendChild(li);
     }
   }catch(e){state.textContent="검색 실패: "+esc(e.message,250)}
   finally{setEnabled(true)}
 });
 async function runDataLab(endpoint,payload,target,button){
   if(!active)return;
   const el=$(target);el.textContent="NAVER API HUB 통계 조회 중...";
   button.disabled=true;
   try{
     const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},
       body:JSON.stringify(payload),cache:"no-store"});
     const data=errorFor(await response.json(),response);
     const rows=(data.results||[]).map(x=>{
       const d=x.data||[],last=d[d.length-1];
       return x.title+": "+d.length+"개 시계열 구간, 최근 상대지수 "+(last?.ratio??"없음");
     });
     el.textContent=(data.interpretation||"NAVER API HUB 상대 지수")+"\n"+(rows.join("\n")||"조회 결과 없음");
   }catch(e){el.textContent="조회 실패: "+esc(e.message,220)}
   finally{button.disabled=false}
 }
 $("hub-trend-form").addEventListener("submit",async e=>{
   e.preventDefault();
   const a=$("hub-trend-a").value.trim(),b=$("hub-trend-b").value.trim();
   if(!a||!b)return;
   await runDataLab("/api/hub/trend",{
     startDate:$("hub-trend-start").value,endDate:$("hub-trend-end").value,
     timeUnit:"week",keywordGroups:[
       {groupName:a,keywords:[a]},{groupName:b,keywords:[b]}],
   },"hub-trend-results",$("hub-trend-submit"));
 });
 $("hub-shopping-form").addEventListener("submit",async e=>{
   e.preventDefault();
   const category=$("hub-shopping-category").value.trim(),kw=$("hub-shopping-keyword").value.trim();
   if(!/^\d{4,12}$/.test(category)||!kw){$("hub-shopping-results").textContent="카테고리 코드는 숫자 4~12자리입니다.";return}
   await runDataLab("/api/hub/shopping",{
     kind:"keywords",category,startDate:$("hub-shopping-start").value,
     endDate:$("hub-shopping-end").value,timeUnit:"week",
     keywords:[{name:kw,keyword:kw}],
   },"hub-shopping-results",$("hub-shopping-submit"));
 });
})();
