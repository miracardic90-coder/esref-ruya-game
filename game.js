// ================================================================
// EŞREF RÜYA — 4P Multiplayer Client
// ================================================================
'use strict';

const canvas = document.getElementById('c');
const ctx    = canvas.getContext('2d');
const GW = 480, GH = 320;
canvas.width = GW; canvas.height = GH;

// ---- INPUT ----
const keys = {};
document.addEventListener('keydown', e => { keys[e.code] = true; });
document.addEventListener('keyup',   e => { keys[e.code] = false; });

// ---- SOCKET ----
const socket = io();

// ---- STATE ----
let myRole    = null;
let myRoomId  = null;
let mySlot    = 0;
let gameActive = false;
let gameState  = 'lobby';
let roomIdx = 0, waveIdx = 0;

// Server verisi
let sEnemies  = [];
let sPlayers  = {};
let sEBullets = [];

// Client görsel
let cBullets   = [];
let particles  = [];
let frameCount = 0;
let screenShake = 0;

// Yerel oyuncu
const me = {
  x:240, y:160, angle:0,
  hp:100, maxHp:100,
  ammo:12, maxAmmo:12,
  reloading:0, invT:0,
  dashTimer:0, dashCooldown:0,
  trail:[], score:0,
  alive:true,
  _shootCd:false,
};

// ---- ROLLER ----
// abilityCdLeft ve shieldActive server'dan gelir
let sSlowZones = [];
let sRadarActive = false;
let myAbilityCd = 0;
let abilityFxList = []; // görsel efektler
const ROLE_CFG = {
  esref:   { icon:'🕴', color:'#c8a84b', glow:'#c8a84b', label:'EŞREF',   suit:'#1c2340', tie:'#c8a84b', hair:'#1a0a00', abilityName:'KALKAN',  abilityKey:'Q' },
  nisan:   { icon:'🎵', color:'#ff88aa', glow:'#ff4488', label:'NİSAN',   suit:'#c06080', tie:null,      hair:'#1a0800', abilityName:'MÜZİK',   abilityKey:'Q' },
  'gurdalı':{ icon:'💪', color:'#6090ff', glow:'#4070dd', label:'GÜRDALII', suit:'#1a3060', tie:'#4488ff', hair:'#111',    abilityName:'TANK',    abilityKey:'Q' },
  muslum:  { icon:'🔧', color:'#60d080', glow:'#40b060', label:'MÜSLÜM',  suit:'#1a4030', tie:'#40c060', hair:'#222',    abilityName:'İYİLEŞTİR',abilityKey:'Q' },
  faruk:   { icon:'🎯', color:'#d0a040', glow:'#b08020', label:'FARUK',   suit:'#3a2810', tie:'#c08030', hair:'#2a1800', abilityName:'SNİPER',  abilityKey:'Q' },
  kadir:   { icon:'😈', color:'#ff4444', glow:'#cc0000', label:'KADİR',   suit:'#2a0808', tie:'#ff2020', hair:'#1a0000', abilityName:'SABOTAJ', abilityKey:'Q' },
  cigdem:  { icon:'🔍', color:'#a0d0ff', glow:'#60a0ff', label:'ÇİĞDEM',  suit:'#102040', tie:'#60a0ff', hair:'#0a1020', abilityName:'RADAR',   abilityKey:'Q' },
};
const ABILITY_CDS = {
  esref:300, nisan:240, 'gurdalı':360, muslum:280, faruk:200, kadir:400, cigdem:220
};
const ROOM_NAMES = ['Ravena Hotel — Düğün Salonu','İstanbul Sokakları','Yetimler Karargahı'];
const ROOM_BGS   = ['hotel','street','base'];

// ================================================================
// SOCKET OLAYLARI
// ================================================================
socket.on('joined', d => {
  mySlot   = d.slot;
  myRoomId = d.roomId;
  document.getElementById('lobbyCode').style.display = 'block';
  document.getElementById('lobbyCode').textContent   = d.roomId;
  document.getElementById('lobbyStatus').textContent = `Slot ${d.slot+1} — ${d.playerCount}/4 oyuncu`;
  if (d.slot === 0 || true) document.getElementById('btnStart').style.display = 'block';
});

socket.on('roomFull', () => setStatus('❌ Oda dolu!'));

socket.on('lobbyUpdate', d => {
  setStatus(`${d.count}/4 oyuncu bağlı`);
  for (let i = 0; i < 4; i++) {
    const el = document.getElementById('slot'+i);
    const filled = d.slots.find(s => s.slot === i);
    el.className = 'lp-slot' + (filled ? ' filled' : '');
    el.innerHTML = filled
      ? `<span class="lp-icon">🎮</span><span>P${i+1}</span>`
      : `<span class="lp-icon">👤</span><span>Boş</span>`;
  }
});

socket.on('roleAssigned', d => {
  myRole = d.role;
  const cfg = ROLE_CFG[myRole];
  // Rol açıklama ekranı
  document.getElementById('lobbyPanel').style.display = 'none';
  document.getElementById('roleReveal').style.display = 'flex';
  document.getElementById('revealIcon').textContent = cfg.icon;
  document.getElementById('revealName').textContent = cfg.label;
  document.getElementById('revealDesc').textContent = myRole === 'esref'
    ? 'Sen Eşref\'sin! Diğer oyuncuları koru. Sen ölürsen oyun biter. Daha fazla hasar verirsin. [Q] Kalkan aktive et.'
    : myRole === 'kadir'
    ? '😈 Sen KADİR\'sin! Kimse bilmiyor. [Q] ile bir takım arkadaşının silahını boşalt. Oyunu sabote et!'
    : myRole === 'cigdem'
    ? '🔍 Sen Çiğdem\'sin! [Q] ile Radar aktive et — tüm düşmanlar görünür olur.'
    : `Sen ${cfg.label}\'sin. [Q] ile özel yeteneğini kullan: ${cfg.abilityName}`;
  document.getElementById('roleTag').textContent = cfg.icon + ' ' + cfg.label;
  document.getElementById('roleTag').style.color = cfg.color;
});

socket.on('gameStart', d => {
  roomIdx = d.roomIdx; waveIdx = d.waveIdx;
  gameState = 'playing'; gameActive = true;
  document.getElementById('overlay').style.display = 'none';
  cBullets = []; particles = [];
  me.x = 200 + (mySlot % 2) * 80;
  me.y = 140 + Math.floor(mySlot / 2) * 60;
});

socket.on('tick', d => {
  sEnemies  = d.enemies;
  sEBullets = d.eBullets;
  sSlowZones = d.slowZones || [];
  sRadarActive = d.radarActive || false;
  for (const [id, p] of Object.entries(d.players)) {
    if (id !== socket.id) sPlayers[id] = p;
    else {
      me.hp       = p.hp;
      me.ammo     = p.ammo;
      me.reloading= p.reloading;
      me.alive    = p.alive;
      myAbilityCd = p.abilityCdLeft || 0;
    }
  }
});

socket.on('bullet', d => {
  if (d.owner !== socket.id)
    cBullets.push({ x:d.x, y:d.y, vx:d.vx, vy:d.vy, life:50, r:3, role:d.role });
});

socket.on('abilityFx', d => {
  abilityFxList.push({ ...d, life: 45 });
  if (d.type === 'heal') spawnParticles(d.x, d.y, '#60d080', 12);
  if (d.type === 'shield') spawnParticles(d.x, d.y, '#c8a84b', 10);
  if (d.type === 'tank') spawnParticles(d.x, d.y, '#6090ff', 10);
  if (d.type === 'music') spawnParticles(d.x, d.y, '#ff88aa', 10);
  if (d.type === 'sniper') spawnParticles(d.tx||d.x, d.ty||d.y, '#d0a040', 14);
  if (d.type === 'radar') spawnParticles(d.x, d.y, '#a0d0ff', 12);
});

socket.on('sabotaged', d => {
  showDialog('⚠️ SABOTAJ', 'Silahın boşaltıldı! Kadir aramızda...');
  setTimeout(hideDialog, 3000);
  screenShake = 15;
});

socket.on('hit', d => {
  spawnParticles(d.ex, d.ey, d.dead ? '#c8a84b' : '#ff8844', d.dead ? 14 : 6);
  if (d.dead) screenShake = 8;
});

socket.on('playerDied', d => {
  spawnParticles(200, 160, '#ff4444', 10);
  if (d.id === socket.id) me.alive = false;
  showDialog('!', d.role === 'esref' ? 'Eşref düştü!' : ROLE_CFG[d.role]?.label + ' öldü!');
  setTimeout(hideDialog, 2500);
});

socket.on('waveClear', d => {
  waveIdx = d.waveIdx; gameState = 'wave_clear';
  showDialog('Anlatıcı','Dalga temizlendi! Hazır ol...');
});

socket.on('roomClear', () => {
  gameState = 'room_clear';
  showDialog('Eşref','Burası temizlendi. İlerleyelim.');
});

socket.on('waitingReady', d => {
  showDialog('Sistem', `Hazır: ${d.ready}/${d.total}`);
});

socket.on('gameOver', d => {
  gameState = 'gameover'; hideDialog();
  screenShake = 20;
});

socket.on('win', () => { gameState = 'win'; hideDialog(); });

socket.on('dialog', d => {
  showDialog(d.speaker, d.text);
  setTimeout(hideDialog, 3000);
});

socket.on('playerLeft', id => { delete sPlayers[id]; });

// ================================================================
// LOBBY
// ================================================================
function joinRoom() {
  const code = (document.getElementById('roomInput').value.trim().toUpperCase() || 'RAVENA');
  socket.emit('joinRoom', { roomId: code });
}
function startGame() { socket.emit('startGame'); }
function setStatus(m) { document.getElementById('lobbyStatus').textContent = m; }
function dismissRole() {
  document.getElementById('roleReveal').style.display = 'none';
  // Oyun zaten başladıysa overlay'i kapat
  if (gameActive) document.getElementById('overlay').style.display = 'none';
}

// ================================================================
// GÜNCELLEME
// ================================================================
function update() {
  frameCount++;
  if (screenShake > 0) screenShake--;
  if (!gameActive || gameState !== 'playing' || !me.alive) return;

  // Hareket
  let dx = 0, dy = 0;
  if (keys['ArrowLeft']  || keys['KeyA']) dx -= 1;
  if (keys['ArrowRight'] || keys['KeyD']) dx += 1;
  if (keys['ArrowUp']    || keys['KeyW']) dy -= 1;
  if (keys['ArrowDown']  || keys['KeyS']) dy += 1;

  if (dx || dy) {
    const len = Math.sqrt(dx*dx + dy*dy);
    const spd = me.dashTimer > 0 ? 2.8 * 3.2 : 2.8;
    me.x = Math.max(12, Math.min(GW-12, me.x + (dx/len)*spd));
    me.y = Math.max(12, Math.min(GH-12, me.y + (dy/len)*spd));
    me.angle = Math.atan2(dy, dx);
  }

  // Dash
  if (me.dashTimer > 0) { me.dashTimer--; me.trail.push({x:me.x,y:me.y,life:14}); }
  if (me.dashCooldown > 0) me.dashCooldown--;
  if (me.invT > 0) me.invT--;
  for (let i = me.trail.length-1; i >= 0; i--) { me.trail[i].life--; if(me.trail[i].life<=0) me.trail.splice(i,1); }

  if ((keys['ShiftLeft']||keys['ShiftRight']||keys['KeyC']) && me.dashCooldown===0) {
    me.dashTimer=10; me.dashCooldown=45; me.invT=14;
    spawnParticles(me.x,me.y,'#4488ff',8);
  }

  // Ateş
  if ((keys['Space']||keys['KeyX']) && me.reloading===0 && !me._shootCd && me.ammo>0) {
    socket.emit('shoot', { angle: me.angle });
    cBullets.push({x:me.x+Math.cos(me.angle)*15,y:me.y+Math.sin(me.angle)*15,
      vx:Math.cos(me.angle)*7.5,vy:Math.sin(me.angle)*7.5,life:50,r:3,role:myRole});
    spawnParticles(me.x+Math.cos(me.angle)*15,me.y+Math.sin(me.angle)*15,'#ffe080',4);
    me._shootCd=true; setTimeout(()=>me._shootCd=false,180);
  }

  // Reload
  if (keys['KeyR'] && me.reloading===0 && me.ammo<me.maxAmmo) {
    socket.emit('reload');
    spawnParticles(me.x,me.y-14,'#c8a84b',5);
  }

  // Yetenek (Q)
  if (keys['KeyQ'] && myAbilityCd === 0 && !me._abilityCd) {
    socket.emit('ability');
    me._abilityCd = true;
    setTimeout(() => me._abilityCd = false, 500);
  }

  // Pozisyon gönder
  if (frameCount%2===0) socket.emit('move',{x:me.x,y:me.y,angle:me.angle});

  // Client mermiler
  for (let i=cBullets.length-1;i>=0;i--) {
    const b=cBullets[i]; b.x+=b.vx; b.y+=b.vy; b.life--;
    if(b.life<=0||b.x<0||b.x>GW||b.y<0||b.y>GH) cBullets.splice(i,1);
  }

  updateParticles();

  // Geçiş tuşları
  if ((keys['Enter']||keys['NumpadEnter']) && (gameState==='wave_clear'||gameState==='room_clear')) {
    socket.emit('nextWave'); hideDialog();
  }
  if (keys['KeyR'] && (gameState==='gameover'||gameState==='win')) location.reload();
}

function updateParticles() {
  for (let i=particles.length-1;i>=0;i--) {
    const p=particles[i];
    p.x+=p.vx; p.y+=p.vy; p.vx*=0.86; p.vy*=0.86; p.life--;
    if(p.life<=0) particles.splice(i,1);
  }
}

function spawnParticles(x,y,color,n=6) {
  for(let i=0;i<n;i++){
    const a=Math.random()*Math.PI*2, spd=1.5+Math.random()*3.5;
    particles.push({x,y,vx:Math.cos(a)*spd,vy:Math.sin(a)*spd,
      life:18+Math.random()*22,color,size:1.5+Math.random()*2.5});
  }
}
// ================================================================
// DRAW ENGINE
// ================================================================
function draw() {
  ctx.save();
  if (screenShake > 0) {
    ctx.translate((Math.random()-0.5)*screenShake*0.8, (Math.random()-0.5)*screenShake*0.8);
  }
  ctx.clearRect(-10,-10,GW+20,GH+20);
  drawRoom();
  drawSlowZones();
  drawAbilityFx();
  drawParticles();
  drawEBullets();
  drawBullets();
  drawEnemies();
  drawOtherPlayers();
  drawMe();
  drawOverlay();
  ctx.restore();
}

// ---- ZEMIN ----
function drawSlowZones() {
  for (const z of sSlowZones) {
    const alpha = (z.life / 90) * 0.35;
    ctx.fillStyle = `rgba(255,136,170,${alpha})`;
    ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = `rgba(255,136,170,${alpha*2})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, Math.PI*2); ctx.stroke();
    ctx.fillStyle = `rgba(255,200,220,${alpha*3})`;
    ctx.font = '14px serif'; ctx.textAlign = 'center';
    ctx.fillText('♪', z.x - 20, z.y - 10);
    ctx.fillText('♫', z.x + 20, z.y + 10);
    ctx.textAlign = 'left';
  }
}

function drawAbilityFx() {
  for (let i = abilityFxList.length-1; i >= 0; i--) {
    const fx = abilityFxList[i];
    fx.life--;
    if (fx.life <= 0) { abilityFxList.splice(i,1); continue; }
    const alpha = fx.life / 45;
    const cfg = ROLE_CFG[fx.role] || ROLE_CFG.esref;
    if (fx.type === 'shield' || fx.type === 'tank') {
      ctx.strokeStyle = cfg.color + Math.floor(alpha*255).toString(16).padStart(2,'0');
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(fx.x, fx.y, 20 + (1-alpha)*10, 0, Math.PI*2); ctx.stroke();
    }
    if (fx.type === 'sniper' && fx.tx !== undefined) {
      ctx.strokeStyle = `rgba(208,160,64,${alpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(fx.x, fx.y); ctx.lineTo(fx.tx, fx.ty); ctx.stroke();
    }
    if (fx.type === 'radar') {
      ctx.strokeStyle = `rgba(160,208,255,${alpha*0.5})`;
      ctx.lineWidth = 1;
      const r = (1 - alpha) * 200;
      ctx.beginPath(); ctx.arc(GW/2, GH/2, r, 0, Math.PI*2); ctx.stroke();
    }
  }
  if (sRadarActive) {
    for (const e of sEnemies) {
      if (e.dead) continue;
      ctx.strokeStyle = 'rgba(160,208,255,0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(e.x, e.y, (e.r||11)+6, 0, Math.PI*2); ctx.stroke();
    }
  }
}

function drawRoom() {
  const bg = ROOM_BGS[roomIdx] || 'hotel';
  if (bg === 'hotel') drawHotel();
  else if (bg === 'street') drawStreet();
  else drawBase();
  // Kenar
  ctx.strokeStyle = '#c8a84b55'; ctx.lineWidth = 3;
  ctx.strokeRect(2,2,GW-4,GH-4);
  ctx.strokeStyle = '#c8a84b22'; ctx.lineWidth = 1;
  ctx.strokeRect(8,8,GW-16,GH-16);
}

function drawHotel() {
  // Zemin
  ctx.fillStyle = '#16121e'; ctx.fillRect(0,0,GW,GH);
  // Mermer desen
  for (let x=0;x<GW;x+=48) for (let y=0;y<GH;y+=48) {
    ctx.fillStyle = (Math.floor(x/48+y/48)%2===0) ? '#1a1626' : '#181422';
    ctx.fillRect(x,y,48,48);
  }
  // Izgara çizgisi
  ctx.strokeStyle = '#2a2038'; ctx.lineWidth = 0.5;
  for(let x=0;x<GW;x+=48){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,GH);ctx.stroke();}
  for(let y=0;y<GH;y+=48){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(GW,y);ctx.stroke();}
  // Halı
  ctx.fillStyle = '#1e0e2a';
  ctx.fillRect(GW/2-22,0,44,GH); ctx.fillRect(0,GH/2-22,GW,44);
  ctx.fillStyle = '#2a1438';
  ctx.fillRect(GW/2-18,0,36,GH); ctx.fillRect(0,GH/2-18,GW,36);
  ctx.fillStyle = '#c8a84b18';
  ctx.fillRect(GW/2-2,0,4,GH); ctx.fillRect(0,GH/2-2,GW,4);
  // Avize glow
  const ag = ctx.createRadialGradient(GW/2,GH/2,0,GW/2,GH/2,90);
  ag.addColorStop(0,'rgba(200,168,75,0.12)'); ag.addColorStop(1,'transparent');
  ctx.fillStyle=ag; ctx.beginPath(); ctx.arc(GW/2,GH/2,90,0,Math.PI*2); ctx.fill();
  // Sütunlar
  for (const [px,py] of [[24,24],[GW-24,24],[24,GH-24],[GW-24,GH-24]]) {
    ctx.fillStyle='#2a2038'; ctx.fillRect(px-10,py-10,20,20);
    ctx.fillStyle='#3a3050'; ctx.fillRect(px-8,py-8,16,16);
    const cg=ctx.createRadialGradient(px,py,0,px,py,14);
    cg.addColorStop(0,'rgba(200,168,75,0.2)'); cg.addColorStop(1,'transparent');
    ctx.fillStyle=cg; ctx.beginPath(); ctx.arc(px,py,14,0,Math.PI*2); ctx.fill();
  }
}

function drawStreet() {
  ctx.fillStyle='#0e1014'; ctx.fillRect(0,0,GW,GH);
  // Asfalt desen
  for(let x=0;x<GW;x+=60) for(let y=0;y<GH;y+=60) {
    ctx.fillStyle=(Math.floor(x/60+y/60)%2===0)?'#111418':'#0f1216';
    ctx.fillRect(x,y,60,60);
  }
  // Kaldırım
  ctx.fillStyle='#181c22';
  ctx.fillRect(0,0,GW,22); ctx.fillRect(0,GH-22,GW,22);
  ctx.fillRect(0,0,22,GH); ctx.fillRect(GW-22,0,22,GH);
  ctx.fillStyle='#222830';
  ctx.fillRect(0,20,GW,2); ctx.fillRect(0,GH-22,GW,2);
  ctx.fillRect(20,0,2,GH); ctx.fillRect(GW-22,0,2,GH);
  // Yol çizgisi
  ctx.setLineDash([22,14]); ctx.strokeStyle='#c8a84b28'; ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(GW/2,0);ctx.lineTo(GW/2,GH);ctx.stroke();
  ctx.beginPath();ctx.moveTo(0,GH/2);ctx.lineTo(GW,GH/2);ctx.stroke();
  ctx.setLineDash([]);
  // Sokak lambası glow
  for (const [lx,ly] of [[50,50],[GW-50,50],[50,GH-50],[GW-50,GH-50]]) {
    const lg=ctx.createRadialGradient(lx,ly,0,lx,ly,55);
    lg.addColorStop(0,'rgba(200,168,75,0.1)'); lg.addColorStop(1,'transparent');
    ctx.fillStyle=lg; ctx.beginPath(); ctx.arc(lx,ly,55,0,Math.PI*2); ctx.fill();
    // Lamba direği
    ctx.fillStyle='#2a2a38'; ctx.fillRect(lx-2,ly,4,22);
    ctx.fillStyle='#c8a84b'; ctx.beginPath(); ctx.arc(lx,ly,4,0,Math.PI*2); ctx.fill();
  }
}

function drawBase() {
  ctx.fillStyle='#080810'; ctx.fillRect(0,0,GW,GH);
  // Metal ızgara
  ctx.strokeStyle='#141420'; ctx.lineWidth=1;
  for(let x=0;x<GW;x+=20){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,GH);ctx.stroke();}
  for(let y=0;y<GH;y+=20){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(GW,y);ctx.stroke();}
  // Perçin noktaları
  ctx.fillStyle='#1a1a28';
  for(let x=20;x<GW;x+=40) for(let y=20;y<GH;y+=40) {
    ctx.beginPath(); ctx.arc(x,y,2,0,Math.PI*2); ctx.fill();
  }
  // Kırmızı glow merkez
  const rg=ctx.createRadialGradient(GW/2,GH/2,0,GW/2,GH/2,110);
  rg.addColorStop(0,'rgba(180,0,0,0.18)'); rg.addColorStop(1,'transparent');
  ctx.fillStyle=rg; ctx.beginPath(); ctx.arc(GW/2,GH/2,110,0,Math.PI*2); ctx.fill();
  // Uyarı şeritleri
  ctx.fillStyle='#1a1000';
  for(let i=0;i<8;i++){
    ctx.fillRect(i*60-10,GH-18,30,18); ctx.fillRect(i*60-10,0,30,18);
  }
  ctx.fillStyle='#c8a84b22';
  for(let i=0;i<8;i++){
    ctx.fillRect(i*60+20-10,GH-18,30,18); ctx.fillRect(i*60+20-10,0,30,18);
  }
}

// ================================================================
// KARAKTER SPRTELARI (gelişmiş pixel art)
// ================================================================
function drawCharSprite(x, y, angle, role, invT, dashTimer, reloading, trail, isMe) {
  // Trail
  const cfg = ROLE_CFG[role] || ROLE_CFG.esref;
  if (trail) for (const t of trail) {
    ctx.globalAlpha = t.life/14*0.4;
    ctx.fillStyle = cfg.glow;
    ctx.beginPath(); ctx.arc(t.x,t.y,9,0,Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  if (invT > 0 && Math.floor(frameCount/4)%2===0) return;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle + Math.PI/2);

  // Glow aura (Eşref için altın, diğerleri için rol rengi)
  if (isMe || role === 'esref') {
    const aura = ctx.createRadialGradient(0,0,0,0,0,18);
    aura.addColorStop(0, cfg.glow+'44');
    aura.addColorStop(1, 'transparent');
    ctx.fillStyle = aura;
    ctx.beginPath(); ctx.arc(0,0,18,0,Math.PI*2); ctx.fill();
  }

  // Gölge
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath(); ctx.ellipse(2,3,10,5,0,0,Math.PI*2); ctx.fill();

  const isNisan = role === 'nisan';
  const legSwing = Math.sin(frameCount*0.22)*4;

  if (isNisan) {
    // Etek
    ctx.fillStyle = '#c06080';
    ctx.beginPath(); ctx.moveTo(-8,2); ctx.lineTo(8,2); ctx.lineTo(10,15); ctx.lineTo(-10,15); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e080a0';
    ctx.fillRect(-7,9,14,6);
    // Gövde
    ctx.fillStyle = '#c06080'; ctx.fillRect(-5,-7,10,11);
    ctx.fillStyle = '#e8b89a'; ctx.fillRect(-4,-7,8,6);
    // Kollar
    ctx.fillStyle = '#c06080';
    ctx.fillRect(-9,-5,4,8); ctx.fillRect(5,-5,4,8);
    ctx.fillStyle = '#e8b89a';
    ctx.fillRect(-10,2,4,4); ctx.fillRect(5,2,4,4);
    // Küçük silah
    ctx.fillStyle = '#555'; ctx.fillRect(5,0,2,8);
    ctx.fillStyle = '#777'; ctx.fillRect(5,-1,2,3);
  } else {
    // Ayaklar
    ctx.fillStyle = cfg.suit;
    ctx.fillRect(-5,5+legSwing,5,8); ctx.fillRect(1,5-legSwing,5,8);
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(-6,12+legSwing,6,3); ctx.fillRect(0,12-legSwing,6,3);
    // Gövde
    ctx.fillStyle = cfg.suit; ctx.fillRect(-7,-5,14,12);
    // Yaka
    ctx.fillStyle = '#f0f0f0'; ctx.fillRect(-2,-5,4,6);
    // Kravat
    if (cfg.tie) { ctx.fillStyle = cfg.tie; ctx.fillRect(-1,-4,2,8); }
    // Ceket kenarı
    ctx.fillStyle = cfg.suit+'cc';
    ctx.fillRect(-7,-5,3,12); ctx.fillRect(4,-5,3,12);
    // Kollar
    ctx.fillStyle = cfg.suit;
    ctx.fillRect(-10,-4,4,9); ctx.fillRect(6,-4,4,9);
    ctx.fillStyle = '#e8b89a';
    ctx.fillRect(-11,4,5,5); ctx.fillRect(6,4,5,5);
    // Silah (sağ el)
    ctx.fillStyle = '#222'; ctx.fillRect(7,3,4,10);
    ctx.fillStyle = '#444'; ctx.fillRect(7,2,4,4);
    ctx.fillStyle = '#333'; ctx.fillRect(8,12,2,3);
    // Namlu ışığı
    if (!me._shootCd) {
      ctx.fillStyle = 'rgba(255,200,60,0.6)';
      ctx.beginPath(); ctx.arc(9,15,3,0,Math.PI*2); ctx.fill();
    }
  }

  // Baş
  ctx.fillStyle = '#e8b89a';
  ctx.beginPath(); ctx.arc(0,-9,7,0,Math.PI*2); ctx.fill();
  // Saç
  ctx.fillStyle = cfg.hair;
  ctx.beginPath(); ctx.arc(0,-11,7,Math.PI,0); ctx.fill();
  if (isNisan) {
    ctx.fillRect(-7,-11,3,9);
    ctx.fillRect(4,-11,3,5);
  } else {
    ctx.fillRect(-7,-11,4,7);
  }
  // Göz
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(2,-10,2,2);
  // Ağız
  ctx.fillStyle = '#c07060'; ctx.fillRect(-2,-6,4,1);

  // Reload ring
  if (reloading > 0) {
    const pct = 1 - reloading/90;
    ctx.strokeStyle = cfg.color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0,0,14,-Math.PI/2,-Math.PI/2+Math.PI*2*pct); ctx.stroke();
  }

  ctx.restore();

  // İsim etiketi
  const cfg2 = ROLE_CFG[role] || ROLE_CFG.esref;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(x-20,y-28,40,13);
  ctx.fillStyle = cfg2.color;
  ctx.font = 'bold 8px Courier New'; ctx.textAlign = 'center';
  ctx.fillText(cfg2.label, x, y-18);
  ctx.textAlign = 'left';

  // Eşref kalkan ikonu
  if (role === 'esref') {
    ctx.fillStyle = '#c8a84b';
    ctx.font = '10px serif'; ctx.textAlign = 'center';
    ctx.fillText('🛡', x, y-30);
    ctx.textAlign = 'left';
  }
}

function drawMe() {
  if (!myRole) return;
  drawCharSprite(me.x, me.y, me.angle, myRole, me.invT, me.dashTimer, me.reloading, me.trail, true);
}

function drawOtherPlayers() {
  for (const p of Object.values(sPlayers)) {
    if (!p.alive) continue;
    drawCharSprite(p.x, p.y, p.angle, p.role, 0, 0, p.reloading, [], false);
  }
}

// ---- DÜŞMANLAR ----
function drawEnemies() {
  for (const e of sEnemies) {
    if (e.dead) continue;
    const isBoss = e.type === 'kadir';
    const isShooter = e.type === 'shooter';
    const r = e.r || 11;

    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate((e.angle||0) + Math.PI/2);

    // Glow
    const eg = ctx.createRadialGradient(0,0,0,0,0,r+8);
    eg.addColorStop(0, isBoss?'rgba(200,0,0,0.25)':isShooter?'rgba(0,60,180,0.2)':'rgba(180,0,0,0.15)');
    eg.addColorStop(1,'transparent');
    ctx.fillStyle=eg; ctx.beginPath(); ctx.arc(0,0,r+8,0,Math.PI*2); ctx.fill();

    // Gölge
    ctx.fillStyle='rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.ellipse(2,3,r,r*0.55,0,0,Math.PI*2); ctx.fill();

    // Vücut
    const bc = isBoss?'#2a0808':isShooter?'#0e2050':'#6a1010';
    const bl = isBoss?'#5a1010':isShooter?'#1a3a80':'#aa2020';
    ctx.fillStyle=bc; ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=bl; ctx.beginPath(); ctx.arc(0,-2,r*0.65,0,Math.PI*2); ctx.fill();

    // Baş
    ctx.fillStyle='#c08060';
    ctx.beginPath(); ctx.arc(0,-r*0.55,r*0.42,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=isBoss?'#1a0000':'#111';
    ctx.beginPath(); ctx.arc(0,-r*0.55-1,r*0.42,Math.PI,0); ctx.fill();
    // Kızgın göz
    ctx.fillStyle='#ff1010';
    ctx.fillRect(1,-r*0.55-1,3,2);
    ctx.fillStyle='#ff6060';
    ctx.fillRect(2,-r*0.55,2,1);

    // Boss tacı
    if (isBoss) {
      ctx.fillStyle='#c8a84b';
      ctx.fillRect(-r*0.7,-r-5,r*1.4,5);
      ctx.fillRect(-r*0.5,-r-10,5,5);
      ctx.fillRect(r*0.2,-r-10,5,5);
      ctx.fillRect(-r*0.15,-r-12,4,4);
      // Omuz pedi
      ctx.fillStyle='#4a0808';
      ctx.fillRect(-r-2,-r*0.3,5,r*0.6);
      ctx.fillRect(r-3,-r*0.3,5,r*0.6);
    }

    // Nişancı silahı
    if (isShooter) {
      ctx.fillStyle='#333'; ctx.fillRect(r*0.3,r*0.1,4,r*0.9);
      ctx.fillStyle='#555'; ctx.fillRect(r*0.2,r*0.1,4,4);
    }

    ctx.restore();

    // Can barı
    if (e.hp < e.maxHp) {
      const bw=r*2+12, bx=e.x-r-6, by=e.y-r-12;
      ctx.fillStyle='#1a1a1a'; ctx.fillRect(bx-1,by-1,bw+2,7);
      ctx.fillStyle='#333'; ctx.fillRect(bx,by,bw,5);
      const pct = e.hp/e.maxHp;
      const hc = isBoss ? '#c8a84b' : pct>0.5 ? '#40c040' : pct>0.25 ? '#e0a020' : '#e03030';
      ctx.fillStyle=hc; ctx.fillRect(bx,by,bw*pct,5);
    }

    // Boss isim
    if (isBoss) {
      ctx.fillStyle='rgba(0,0,0,0.8)'; ctx.fillRect(e.x-26,e.y-r-24,52,14);
      ctx.fillStyle='#c8a84b'; ctx.font='bold 9px Courier New'; ctx.textAlign='center';
      ctx.fillText('KADİR',e.x,e.y-r-13); ctx.textAlign='left';
    }
  }
}

// ---- MERMLER ----
function drawBullets() {
  for (const b of cBullets) {
    const cfg = ROLE_CFG[b.role] || ROLE_CFG.esref;
    // z
    ctx.globalAlpha=0.3; ctx.fillStyle=cfg.color;
    ctx.beginPath(); ctx.arc(b.x-b.vx*2,b.y-b.vy*2,b.r*0.5,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha=0.6; ctx.beginPath(); ctx.arc(b.x-b.vx,b.y-b.vy,b.r*0.7,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha=1;
    // Mermi
    ctx.fillStyle=cfg.color;
    ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,Math.PI*2); ctx.fill();
    // Glow
    const bg=ctx.createRadialGradient(b.x,b.y,0,b.x,b.y,b.r+3);
    bg.addColorStop(0,cfg.glow+'88'); bg.addColorStop(1,'transparent');
    ctx.fillStyle=bg; ctx.beginPath(); ctx.arc(b.x,b.y,b.r+3,0,Math.PI*2); ctx.fill();
  }
}

function drawEBullets() {
  for (const b of sEBullets) {
    ctx.globalAlpha=0.35; ctx.fillStyle='#ff2020';
    ctx.beginPath(); ctx.arc(b.x-b.vx*2,b.y-b.vy*2,2,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha=1;
    ctx.fillStyle='#ff4444';
    ctx.beginPath(); ctx.arc(b.x,b.y,b.r||4,0,Math.PI*2); ctx.fill();
    const eg=ctx.createRadialGradient(b.x,b.y,0,b.x,b.y,7);
    eg.addColorStop(0,'rgba(255,60,60,0.5)'); eg.addColorStop(1,'transparent');
    ctx.fillStyle=eg; ctx.beginPath(); ctx.arc(b.x,b.y,7,0,Math.PI*2); ctx.fill();
  }
}

// ---- PARTKÜLLER ----
function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = p.life/40;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x,p.y,p.size,0,Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ---- OVERLAY ----
function drawOverlay() {
  if (gameState==='wave_clear') {
    ctx.fillStyle='rgba(0,0,0,0.65)'; ctx.fillRect(0,0,GW,GH);
    ctx.fillStyle='#c8a84b'; ctx.font='bold 22px Courier New'; ctx.textAlign='center';
    ctx.fillText('DALGA TEMİZLENDİ!',GW/2,GH/2-22);
    ctx.fillStyle='#888'; ctx.font='12px Courier New';
    ctx.fillText('Devam için ENTER / Ekrana dokun',GW/2,GH/2+10);
    ctx.textAlign='left';
  }
  if (gameState==='room_clear') {
    ctx.fillStyle='rgba(0,0,0,0.78)'; ctx.fillRect(0,0,GW,GH);
    ctx.fillStyle='#c8a84b'; ctx.font='bold 20px Courier New'; ctx.textAlign='center';
    ctx.fillText('ODA TAMAMLANDI',GW/2,GH/2-38);
    ctx.fillStyle='#fff'; ctx.font='12px Courier New';
    ctx.fillText(ROOM_NAMES[roomIdx]||'',GW/2,GH/2-12);
    ctx.fillStyle='#c8a84b'; ctx.font='12px Courier New';
    ctx.fillText('Sonraki bölüm için ENTER',GW/2,GH/2+18);
    ctx.textAlign='left';
  }
  if (gameState==='gameover') {
    ctx.fillStyle='rgba(0,0,0,0.88)'; ctx.fillRect(0,0,GW,GH);
    ctx.fillStyle='#cc2244'; ctx.font='bold 28px Courier New'; ctx.textAlign='center';
    ctx.fillText('OYUN BİTTİ',GW/2,GH/2-30);
    ctx.fillStyle='#888'; ctx.font='12px Courier New';
    ctx.fillText('Sayfayı yenile (R)',GW/2,GH/2+15);
    ctx.textAlign='left';
  }
  if (gameState==='win') {
    ctx.fillStyle='rgba(0,0,0,0.88)'; ctx.fillRect(0,0,GW,GH);
    ctx.fillStyle='#c8a84b'; ctx.font='bold 18px Courier New'; ctx.textAlign='center';
    ctx.fillText('EŞREF RÜYA\'YI BULDU!',GW/2,GH/2-60);
    ctx.fillStyle='#ffaacc'; ctx.font='13px Courier New';
    ctx.fillText('"Yıllardır aradığım kadın sendin..."',GW/2,GH/2-35);
    ctx.fillStyle='#ccc'; ctx.font='12px Courier New';
    ctx.fillText('Nisan = Rüya  |  Kadir yenildi',GW/2,GH/2-10);
    ctx.fillStyle='#888'; ctx.font='11px Courier New';
    ctx.fillText('Yeniden oynamak için R',GW/2,GH/2+30);
    ctx.textAlign='left';
  }
}

// ================================================================
// HUD
// ================================================================
function updateHUD() {
  if (!gameActive) return;
  // Oyuncu kartları
  const hudTop = document.getElementById('hudTop');
  hudTop.innerHTML = '';
  const allP = { [socket.id]: { ...me, role: myRole, alive: me.alive }, ...sPlayers };
  for (const [id, p] of Object.entries(allP)) {
    if (!p.role) continue;
    const cfg = ROLE_CFG[p.role] || ROLE_CFG.esref;
    const isMe = id === socket.id;
    const card = document.createElement('div');
    card.className = 'pcard' + (p.role==='esref'?' esref-card':'') + (!p.alive?' dead':'');
    card.innerHTML = `
      <div class="pcard-name ${isMe?'me':''} ${p.role==='esref'?'esref':''}">${cfg.icon} ${cfg.label}${isMe?' (sen)':''}</div>
      <div class="pcard-bar"><div class="pcard-fill fill-${p.role}" style="width:${(p.hp/p.maxHp*100).toFixed(0)}%"></div></div>
    `;
    hudTop.appendChild(card);
  }
  document.getElementById('hudRoom').textContent = ROOM_NAMES[roomIdx]||'';
  document.getElementById('hudWave').textContent = 'DALGA '+(waveIdx+1)+'/3';
  document.getElementById('hudScore').textContent = '★ '+me.score;
  document.getElementById('ammoLabel').textContent = '🔫 '+me.ammo+'/'+me.maxAmmo+(me.reloading>0?' ↺':'');
  document.getElementById('ammoFill').style.width = (me.ammo/me.maxAmmo*100)+'%';

  // Yetenek göstergesi
  const cfg = ROLE_CFG[myRole];
  if (cfg) {
    const abilEl = document.getElementById('abilityHud');
    if (abilEl) {
      const pct = myAbilityCd > 0 ? (1 - myAbilityCd / (ABILITY_CDS[myRole]||300)) * 100 : 100;
      abilEl.textContent = `[Q] ${cfg.abilityName} ${myAbilityCd > 0 ? '⏳' : '✅'}`;
      abilEl.style.color = myAbilityCd > 0 ? '#666' : cfg.color;
      const fillEl = document.getElementById('abilityFill');
      if (fillEl) fillEl.style.width = pct + '%';
    }
  }
}

// ================================================================
// DYALOG
// ================================================================
function showDialog(speaker, text) {
  document.getElementById('dlg').style.display='block';
  document.getElementById('dlgSpeaker').textContent=speaker;
  document.getElementById('dlgText').textContent=text;
}
function hideDialog() { document.getElementById('dlg').style.display='none'; }

// ================================================================
// ANA DÖNGÜ
// ================================================================
function loop() {
  update();
  draw();
  updateHUD();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
