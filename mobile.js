// ================================================================
// MOBİL KONTROLLER + CANVAS SCALE
// ================================================================
(function(){
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1;

  function resize(){
    const GW=480,GH=320;
    const ctrlH=isMobile?76:0;
    const scale=Math.min(window.innerWidth/GW,(window.innerHeight-ctrlH)/GH);
    const dw=Math.floor(GW*scale),dh=Math.floor(GH*scale);
    const c=document.getElementById('c');
    c.style.width=dw+'px';c.style.height=dh+'px';
    const wrap=document.getElementById('wrap');
    wrap.style.width=dw+'px';wrap.style.height=(dh+ctrlH)+'px';
    if(isMobile){
      document.getElementById('mobileCtrl').style.display='block';
      document.getElementById('dlg').style.bottom=(ctrlH+4)+'px';
    }
  }
  window.addEventListener('resize',resize);
  window.addEventListener('orientationchange',()=>setTimeout(resize,200));
  resize();

  if(!isMobile) return;

  function bind(id,code){
    const el=document.getElementById(id);if(!el)return;
    el.addEventListener('touchstart',e=>{e.preventDefault();keys[code]=true;el.classList.add('pressed');},{passive:false});
    el.addEventListener('touchend',  e=>{e.preventDefault();keys[code]=false;el.classList.remove('pressed');},{passive:false});
    el.addEventListener('touchcancel',e=>{e.preventDefault();keys[code]=false;el.classList.remove('pressed');},{passive:false});
  }
  bind('jUp','ArrowUp');bind('jDown','ArrowDown');
  bind('jLeft','ArrowLeft');bind('jRight','ArrowRight');
  bind('btnShoot','Space');bind('btnDash','ShiftLeft');bind('btnReload','KeyR');
  bind('btnAbility','KeyQ');

  // Overlay ekranlarda canvas'a dokunma = Enter
  document.getElementById('c').addEventListener('touchstart',e=>{
    e.preventDefault();
    if(typeof gameState!=='undefined'&&(gameState==='wave_clear'||gameState==='room_clear')){
      socket.emit('nextWave');
      hideDialog();
    }
    if(typeof gameState!=='undefined'&&(gameState==='gameover'||gameState==='win')){
      location.reload();
    }
  },{passive:false});
})();
