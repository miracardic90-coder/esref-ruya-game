// ================================================================
// EŞREF RÜYA — Multiplayer Server
// ================================================================
'use strict';
const http = require('http');
const fs   = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3001;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css' };

const httpServer = http.createServer((req, res) => {
  let url = req.url === '/' ? '/index.html' : req.url;
  // Render uyku önleme ping endpoint
  if (url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('pong');
    return;
  }
  if (url.startsWith('/socket.io')) {
    const f = path.join(__dirname, 'node_modules/socket.io/client-dist/socket.io.js');
    fs.readFile(f, (err, d) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(d);
    });
    return;
  }
  const fp = path.join(__dirname, url);
  fs.readFile(fp, (err, d) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'text/plain' });
    res.end(d);
  });
});

// ---- RENDER UYKU ÖNLEME (14 dakikada bir self-ping) ----
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || null;
if (RENDER_URL) {
  setInterval(() => {
    const https = require('https');
    https.get(RENDER_URL + '/ping', r => {
      console.log('Keep-alive ping:', r.statusCode);
    }).on('error', e => console.log('Ping error:', e.message));
  }, 14 * 60 * 1000); // 14 dakika
}

const io = new Server(httpServer, { cors: { origin: '*' } });

// ================================================================
// KARAKTER TANIMLARI
// ================================================================
const ROLE_DEFS = {
  esref: {
    label: 'Eşref', icon: '🕴',
    hp: 120, maxAmmo: 12, reloadTime: 80,
    speed: 2.8, damage: 30,
    ability: 'kalkan',      // hasar azaltma
    abilityCd: 300,
    desc: 'Koruyucu lider. Fazla hasar verir, kalkan aktive edebilir.',
  },
  nisan: {
    label: 'Nisan', icon: '🎵',
    hp: 90, maxAmmo: 10, reloadTime: 70,
    speed: 3.4, damage: 18,
    ability: 'muzik',       // yakındaki düşmanları yavaşlatır
    abilityCd: 240,
    desc: 'Hızlı müzisyen. Müzik alanı düşmanları yavaşlatır.',
  },
  gurdalı: {
    label: 'Gürdalı', icon: '💪',
    hp: 180, maxAmmo: 8, reloadTime: 110,
    speed: 1.8, damage: 22,
    ability: 'tank',        // geçici dokunulmazlık
    abilityCd: 360,
    desc: 'Tank. Çok canı var ama yavaş. Dokunulmazlık aktive edebilir.',
  },
  muslum: {
    label: 'Müslüm', icon: '🔧',
    hp: 100, maxAmmo: 10, reloadTime: 90,
    speed: 2.5, damage: 16,
    ability: 'heal',        // yakındaki oyuncuları iyileştirir
    abilityCd: 280,
    desc: 'Tamirci. Yetenek ile yakındaki takım arkadaşlarını iyileştirir.',
  },
  faruk: {
    label: 'Faruk', icon: '🎯',
    hp: 85, maxAmmo: 6, reloadTime: 120,
    speed: 2.6, damage: 45,
    ability: 'sniper',      // tek atış yüksek hasar
    abilityCd: 200,
    desc: 'Nişancı. Az mermi ama çok hasar. Sniper atışı yapar.',
  },
  kadir: {
    label: 'Kadir', icon: '😈',
    hp: 110, maxAmmo: 14, reloadTime: 75,
    speed: 3.0, damage: 20,
    ability: 'sabotaj',     // rastgele bir oyuncunun ammo'sunu sıfırlar
    abilityCd: 400,
    desc: 'HAİN! Gizlice takımı sabote edebilir. Kimse bilmez...',
    isTraitor: true,
  },
  cigdem: {
    label: 'Çiğdem', icon: '🔍',
    hp: 95, maxAmmo: 12, reloadTime: 85,
    speed: 2.9, damage: 18,
    ability: 'radar',       // tüm düşman konumlarını gösterir
    abilityCd: 220,
    desc: 'Dedektif. Radar ile tüm düşman konumlarını ekranda gösterir.',
  },
};

const ALL_ROLES = Object.keys(ROLE_DEFS);

// ================================================================
// ODA YÖNETİMİ
// ================================================================
const rooms = {};

function createRoom(id, ownerId) {
  rooms[id] = {
    id, ownerId,
    players: {},
    state: 'waiting',
    roomIdx: 0, waveIdx: 0,
    enemies: [], eBullets: [],
    eidx: 0, ebidx: 0,
    tick: null,
    readyForNext: new Set(),
    slowZones: [],   // Nisan yeteneği
    radarActive: 0,  // Çiğdem yeteneği
  };
}

function getRoomOf(sid) {
  for (const [rid, r] of Object.entries(rooms))
    if (r.players[sid]) return { rid, room: r };
  return null;
}

const ROOM_W = 480, ROOM_H = 320;

function edgeSpawn() {
  const side = Math.floor(Math.random() * 4);
  if (side === 0) return { x: Math.random() * ROOM_W, y: -24 };
  if (side === 1) return { x: ROOM_W + 24, y: Math.random() * ROOM_H };
  if (side === 2) return { x: Math.random() * ROOM_W, y: ROOM_H + 24 };
  return { x: -24, y: Math.random() * ROOM_H };
}

function spawnWave(room) {
  const base  = 5 + room.waveIdx * 3 + room.roomIdx * 4;
  const count = Math.min(base, 22);
  room.enemies = []; room.eBullets = [];
  for (let i = 0; i < count; i++) {
    const isBoss = room.roomIdx === 2 && room.waveIdx === 2 && i === 0;
    const type   = isBoss ? 'boss' : (Math.random() < 0.3 ? 'shooter' : 'thug');
    const { x, y } = edgeSpawn();
    room.enemies.push({
      id: room.eidx++, x, y, type,
      hp:    isBoss ? 500 : type === 'shooter' ? 35 : 50,
      maxHp: isBoss ? 500 : type === 'shooter' ? 35 : 50,
      spd:   isBoss ? 1.6 : type === 'shooter' ? 1.0 : 1.3,
      r: isBoss ? 18 : 11,
      shootRange: (type === 'shooter' || isBoss) ? 190 : 0,
      shootCd: isBoss ? 50 : 85,
      shootT: Math.random() * 60,
      angle: 0, dead: false, slowed: 0,
    });
  }
}

// ================================================================
// TICK
// ================================================================
function startTick(rid) {
  const room = rooms[rid];
  if (room.tick) clearInterval(room.tick);

  room.tick = setInterval(() => {
    if (room.state !== 'playing') return;
    const plist = Object.values(room.players).filter(p => p.alive);
    if (!plist.length) return;

    // Slow zone tick (Nisan yeteneği)
    for (let i = room.slowZones.length - 1; i >= 0; i--) {
      room.slowZones[i].life--;
      if (room.slowZones[i].life <= 0) room.slowZones.splice(i, 1);
    }
    if (room.radarActive > 0) room.radarActive--;

    // Düşman hareketi
    for (const e of room.enemies) {
      if (e.dead) continue;
      if (e.slowed > 0) e.slowed--;

      // En yakın oyuncuyu hedef al (Eşref öncelikli)
      let target = plist[0];
      let minD = Infinity;
      for (const p of plist) {
        let d = Math.hypot(p.x - e.x, p.y - e.y);
        if (p.role === 'esref') d *= 0.7; // Eşref'e öncelik
        if (d < minD) { minD = d; target = p; }
      }
      const realDist = Math.hypot(target.x - e.x, target.y - e.y);
      e.angle = Math.atan2(target.y - e.y, target.x - e.x);

      // Slow zone kontrolü
      let inSlow = false;
      for (const z of room.slowZones) {
        if (Math.hypot(e.x - z.x, e.y - z.y) < z.r) { inSlow = true; break; }
      }
      const spd = inSlow ? e.spd * 0.35 : (e.slowed > 0 ? e.spd * 0.5 : e.spd);

      if (realDist > e.r + 12) {
        e.x += Math.cos(e.angle) * spd;
        e.y += Math.sin(e.angle) * spd;
        e.x = Math.max(-30, Math.min(ROOM_W + 30, e.x));
        e.y = Math.max(-30, Math.min(ROOM_H + 30, e.y));
      }

      // Temas hasarı
      if (realDist < e.r + 11) {
        const dmg = e.type === 'boss' ? 15 : 7;
        // Gürdalı tank modunda hasar almaz
        if (!(target.tankMode > 0)) {
          target.hp = Math.max(0, target.hp - dmg);
          target.invT = 40;
        }
        if (target.hp <= 0) killPlayer(room, rid, target);
      }

      // Ateş
      if (e.shootRange > 0 && realDist < e.shootRange) {
        e.shootT--;
        if (e.shootT <= 0) {
          e.shootT = e.shootCd;
          const bspd = e.type === 'boss' ? 5.5 : 4;
          room.eBullets.push({
            id: room.ebidx++,
            x: e.x + Math.cos(e.angle) * 16,
            y: e.y + Math.sin(e.angle) * 16,
            vx: Math.cos(e.angle) * bspd,
            vy: Math.sin(e.angle) * bspd,
            life: 65, r: 4,
          });
        }
      }
    }

    // Düşman mermileri
    for (let i = room.eBullets.length - 1; i >= 0; i--) {
      const b = room.eBullets[i];
      b.x += b.vx; b.y += b.vy; b.life--;
      if (b.life <= 0 || b.x < -10 || b.x > ROOM_W+10 || b.y < -10 || b.y > ROOM_H+10) {
        room.eBullets.splice(i, 1); continue;
      }
      for (const p of plist) {
        if ((p.invT||0) > 0 || (p.shieldActive||0) > 0) continue;
        if (Math.hypot(b.x - p.x, b.y - p.y) < b.r + 11) {
          p.hp = Math.max(0, p.hp - 9);
          p.invT = 28;
          room.eBullets.splice(i, 1);
          if (p.hp <= 0) killPlayer(room, rid, p);
          break;
        }
      }
    }

    // Oyuncu tick
    for (const p of Object.values(room.players)) {
      if (p.invT > 0) p.invT--;
      if (p.shieldActive > 0) p.shieldActive--;
      if (p.tankMode > 0) p.tankMode--;
      if (p.abilityCdLeft > 0) p.abilityCdLeft--;
      if (p.reloading > 0) { p.reloading--; if (p.reloading === 0) p.ammo = p.maxAmmo; }
    }

    // Dalga bitti mi?
    if (room.enemies.every(e => e.dead)) {
      room.waveIdx++;
      if (room.waveIdx >= 3) {
        if (room.roomIdx < 2) {
          room.state = 'room_clear';
          io.to(rid).emit('roomClear', { roomIdx: room.roomIdx });
        } else {
          room.state = 'win';
          io.to(rid).emit('win');
        }
      } else {
        room.state = 'wave_clear';
        io.to(rid).emit('waveClear', { waveIdx: room.waveIdx });
      }
    }

    io.to(rid).emit('tick', {
      enemies: room.enemies,
      eBullets: room.eBullets,
      players: room.players,
      slowZones: room.slowZones,
      radarActive: room.radarActive > 0,
    });
  }, 1000 / 30);
}

function killPlayer(room, rid, p) {
  p.alive = false;
  io.to(rid).emit('playerDied', { id: p.id, role: p.role });
  if (p.role === 'esref') {
    room.state = 'gameover';
    io.to(rid).emit('gameOver', { reason: 'Eşref düştü! Oyun bitti.' });
    return;
  }
  const alive = Object.values(room.players).filter(x => x.alive);
  if (!alive.length) {
    room.state = 'gameover';
    io.to(rid).emit('gameOver', { reason: 'Herkes öldü!' });
  }
}

// ================================================================
// SOCKET OLAYLARI
// ================================================================
io.on('connection', socket => {
  console.log('+', socket.id);

  socket.on('joinRoom', ({ roomId }) => {
    if (!rooms[roomId]) createRoom(roomId, socket.id);
    const room = rooms[roomId];
    if (room.state !== 'waiting') { socket.emit('roomFull'); return; }
    const count = Object.keys(room.players).length;
    if (count >= 7) { socket.emit('roomFull'); return; }

    const def = ROLE_DEFS.esref; // geçici, oyun başlayınca atanır
    room.players[socket.id] = {
      id: socket.id, slot: count, role: null,
      x: 200 + (count % 3) * 70, y: 130 + Math.floor(count / 3) * 70,
      angle: 0,
      hp: 100, maxHp: 100,
      ammo: 12, maxAmmo: 12,
      reloading: 0, invT: 0,
      shieldActive: 0, tankMode: 0,
      abilityCdLeft: 0,
      alive: true, score: 0,
      isOwner: count === 0,
    };

    socket.join(roomId);
    socket.emit('joined', { slot: count, roomId, isOwner: count === 0 });
    io.to(roomId).emit('lobbyUpdate', {
      count: Object.keys(room.players).length,
      slots: Object.values(room.players).map(p => ({ slot: p.slot, id: p.id })),
    });
  });

  socket.on('startGame', () => {
    const res = getRoomOf(socket.id);
    if (!res) return;
    const { room, rid } = res;
    // Sadece oda sahibi başlatabilir
    if (room.ownerId !== socket.id) return;

    const pids = Object.keys(room.players);
    // Rolleri karıştır ve ata
    const shuffled = [...ALL_ROLES].sort(() => Math.random() - 0.5);
    pids.forEach((sid, i) => {
      const role = shuffled[i % shuffled.length];
      const def  = ROLE_DEFS[role];
      const p    = room.players[sid];
      p.role     = role;
      p.hp       = def.hp; p.maxHp = def.hp;
      p.ammo     = def.maxAmmo; p.maxAmmo = def.maxAmmo;
      p.abilityCdLeft = 0;
    });

    room.state = 'playing';
    spawnWave(room);
    startTick(rid);

    for (const [sid, p] of Object.entries(room.players)) {
      io.to(sid).emit('roleAssigned', { role: p.role });
    }
    io.to(rid).emit('gameStart', { roomIdx: 0, waveIdx: 0 });
  });

  socket.on('move', ({ x, y, angle }) => {
    const res = getRoomOf(socket.id);
    if (!res) return;
    const p = res.room.players[socket.id];
    if (p && p.alive) { p.x = x; p.y = y; p.angle = angle; }
  });

  socket.on('shoot', ({ angle }) => {
    const res = getRoomOf(socket.id);
    if (!res) return;
    const { room, rid } = res;
    const p = room.players[socket.id];
    if (!p || !p.alive || p.ammo <= 0 || p.reloading > 0) return;

    const def = ROLE_DEFS[p.role] || ROLE_DEFS.esref;
    p.ammo--;
    if (p.ammo === 0) p.reloading = def.reloadTime;

    const bx = p.x + Math.cos(angle) * 15;
    const by = p.y + Math.sin(angle) * 15;
    const vx = Math.cos(angle) * 7.5;
    const vy = Math.sin(angle) * 7.5;

    for (const e of room.enemies) {
      if (e.dead) continue;
      let tx = bx, ty = by, hit = false;
      for (let s = 0; s < 60; s++) {
        tx += vx / 7.5; ty += vy / 7.5;
        if (Math.hypot(tx - e.x, ty - e.y) < e.r + 4) { hit = true; break; }
      }
      if (hit) {
        e.hp -= def.damage;
        if (e.hp <= 0) {
          e.dead = true;
          p.score += e.type === 'boss' ? 500 : e.type === 'shooter' ? 80 : 40;
          if (e.type === 'boss') io.to(rid).emit('dialog', { speaker: 'Eşref', text: 'Kadir! Artık bitti.' });
        }
        io.to(rid).emit('hit', { ex: e.x, ey: e.y, dead: e.dead });
        break;
      }
    }
    io.to(rid).emit('bullet', { x: bx, y: by, vx, vy, owner: socket.id, role: p.role });
  });

  socket.on('reload', () => {
    const res = getRoomOf(socket.id);
    if (!res) return;
    const p = res.room.players[socket.id];
    const def = ROLE_DEFS[p?.role] || ROLE_DEFS.esref;
    if (p && p.reloading === 0 && p.ammo < p.maxAmmo) p.reloading = def.reloadTime;
  });

  // ---- YETENEK ----
  socket.on('ability', () => {
    const res = getRoomOf(socket.id);
    if (!res) return;
    const { room, rid } = res;
    const p = room.players[socket.id];
    if (!p || !p.alive || p.abilityCdLeft > 0) return;
    const def = ROLE_DEFS[p.role];
    if (!def) return;

    p.abilityCdLeft = def.abilityCd;

    switch (p.role) {
      case 'esref':
        // Kalkan: 2 saniyelik hasar azaltma
        p.shieldActive = 60;
        io.to(rid).emit('abilityFx', { role: 'esref', x: p.x, y: p.y, type: 'shield' });
        break;

      case 'nisan':
        // Müzik alanı: 3 saniyelik yavaşlatma bölgesi
        room.slowZones.push({ x: p.x, y: p.y, r: 80, life: 90 });
        io.to(rid).emit('abilityFx', { role: 'nisan', x: p.x, y: p.y, type: 'music' });
        break;

      case 'gurdalı':
        // Tank modu: 2 saniyelik dokunulmazlık
        p.tankMode = 60;
        p.invT = 60;
        io.to(rid).emit('abilityFx', { role: 'gurdalı', x: p.x, y: p.y, type: 'tank' });
        break;

      case 'muslum':
        // İyileştirme: yakındaki oyuncuları 30 HP iyileştirir
        for (const op of Object.values(room.players)) {
          if (!op.alive) continue;
          if (Math.hypot(op.x - p.x, op.y - p.y) < 100) {
            op.hp = Math.min(op.maxHp, op.hp + 30);
          }
        }
        io.to(rid).emit('abilityFx', { role: 'muslum', x: p.x, y: p.y, type: 'heal' });
        break;

      case 'faruk':
        // Sniper: en yakın düşmana 120 hasar
        let closest = null, minD = Infinity;
        for (const e of room.enemies) {
          if (e.dead) continue;
          const d = Math.hypot(e.x - p.x, e.y - p.y);
          if (d < minD) { minD = d; closest = e; }
        }
        if (closest) {
          closest.hp -= 120;
          if (closest.hp <= 0) { closest.dead = true; p.score += 100; }
          io.to(rid).emit('abilityFx', { role: 'faruk', x: p.x, y: p.y, tx: closest.x, ty: closest.y, type: 'sniper' });
        }
        break;

      case 'kadir':
        // Sabotaj: rastgele bir takım arkadaşının ammo'sunu sıfırla (hain!)
        const others = Object.values(room.players).filter(op => op.id !== p.id && op.alive);
        if (others.length) {
          const victim = others[Math.floor(Math.random() * others.length)];
          victim.ammo = 0;
          victim.reloading = ROLE_DEFS[victim.role]?.reloadTime || 90;
          io.to(victim.id).emit('sabotaged', { by: 'Kadir' });
          // Sadece Kadir'e bildir
          io.to(socket.id).emit('abilityFx', { role: 'kadir', x: p.x, y: p.y, type: 'sabotaj' });
        }
        break;

      case 'cigdem':
        // Radar: 5 saniyelik düşman görünürlüğü
        room.radarActive = 150;
        io.to(rid).emit('abilityFx', { role: 'cigdem', x: p.x, y: p.y, type: 'radar' });
        io.to(rid).emit('dialog', { speaker: 'Çiğdem', text: 'Radar aktif! Tüm düşmanlar görünüyor.' });
        break;
    }
  });

  socket.on('nextWave', () => {
    const res = getRoomOf(socket.id);
    if (!res) return;
    const { room, rid } = res;
    room.readyForNext.add(socket.id);
    const alive = Object.keys(room.players).filter(id => room.players[id].alive);
    if (room.readyForNext.size >= Math.max(1, alive.length)) {
      room.readyForNext.clear();
      if (room.state === 'wave_clear') {
        room.state = 'playing';
        spawnWave(room);
        io.to(rid).emit('gameStart', { roomIdx: room.roomIdx, waveIdx: room.waveIdx });
      } else if (room.state === 'room_clear') {
        room.roomIdx++; room.waveIdx = 0; room.state = 'playing';
        for (const p of Object.values(room.players)) {
          p.hp = Math.min(p.maxHp, p.hp + 50);
          p.ammo = p.maxAmmo; p.reloading = 0;
        }
        spawnWave(room);
        io.to(rid).emit('gameStart', { roomIdx: room.roomIdx, waveIdx: room.waveIdx });
      }
    } else {
      io.to(rid).emit('waitingReady', { ready: room.readyForNext.size, total: alive.length });
    }
  });

  socket.on('disconnect', () => {
    console.log('-', socket.id);
    const res = getRoomOf(socket.id);
    if (!res) return;
    const { room, rid } = res;
    delete room.players[socket.id];
    io.to(rid).emit('playerLeft', socket.id);
    if (!Object.keys(room.players).length) {
      if (room.tick) clearInterval(room.tick);
      delete rooms[rid];
    }
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🎮 Eşref Rüya: http://localhost:${PORT}`);
});
