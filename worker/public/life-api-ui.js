(function(){
  "use strict";
  const box=document.getElementById("life-api-providers");
  const status=document.getElementById("life-api-status");
  if(!box||!status)return;
  const labels={transport:"공공 교통",weather_air:"기상청 · 에어코리아",tour:"한국관광공사 TourAPI",
    flights:"항공정보",ecos:"한국은행 ECOS",realestate:"국토부 실거래가",
    youtube:"YouTube Data",google_places:"Google Places (유료 승인 필요)",home_assistant:"Home Assistant (센서 전용)"};
  fetch("/api/life/status",{cache:"no-store"}).then(async r=>{
    if(!r.ok)throw Error("상태 조회 실패");
    return r.json();
  }).then(d=>{
    status.textContent="서버 설정만 표시합니다. 실제 API 사용 권한 및 응답 성공은 별도 검증이 필요합니다.";
    box.replaceChildren();
    for(const p of d.providers||[]){
      const row=document.createElement("div");
      row.style.cssText="display:flex;justify-content:space-between;gap:8px;border-bottom:1px solid var(--line);padding:4px 0";
      const label=document.createElement("span");label.textContent=labels[p.name]||p.name;
      const state=document.createElement("span");
      state.style.color=p.enabled?"var(--accent)":"var(--muted)";
      state.textContent=p.enabled?"설정됨 (미검증)":p.configured?"대기 (비활성)":"인증키 필요";
      row.append(label,state);box.appendChild(row);
    }
  }).catch(()=>{status.textContent="상태 조회 불가. 로그인 또는 서버 연결을 확인하세요."});
})();
