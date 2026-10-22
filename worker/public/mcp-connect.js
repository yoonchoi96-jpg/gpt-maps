(function(){
  "use strict";
  const button=document.getElementById("mcp-token-copy");
  if(!button)return;
  button.addEventListener("click",async()=>{
    if(!window.confirm("이 인증 토큰은 12시간 동안 MCP 서버 도구 접근을 허용합니다. 외부에 노출하지 말고 신뢰하는 MCP 클라이언트의 Authorization 헤더에만 사용하세요. 발급할까요?"))return;
    button.disabled=true;
    const original=button.textContent;
    button.textContent="발급 중...";
    try{
      const response=await fetch("/api/mcp-token",{
        method:"POST",
        credentials:"same-origin",
        cache:"no-store",
        headers:{"Content-Type":"application/json"},
        body:"{}",
      });
      const data=await response.json();
      if(!response.ok||typeof data.access_token!=="string")
        throw Error(data.error||"토큰 발급에 실패했습니다.");
      const header="Bearer "+data.access_token;
      await navigator.clipboard.writeText(header);
      button.textContent="MCP 인증 헤더 복사 완료 (12시간)";
      setTimeout(()=>{button.textContent=original},5000);
    }catch(e){
      button.textContent="토큰 발급 실패 · 다시 시도";
      alert(String(e.message||"토큰 복사 실패")+". 토큰은 표시하거나 저장하지 않았습니다.");
      setTimeout(()=>{button.textContent=original},5000);
    }finally{button.disabled=false}
  });
})();