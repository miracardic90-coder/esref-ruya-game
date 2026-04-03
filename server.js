// ================================================================
// EŞREF RÜYA — 4 Oyunculu Multiplayer Server
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

const io = new Server(httpServer, { cors: { origin: '*' } });

// ---- ROLLER ----
const CIVILIAN_ROLES = ['nisan', 'gurdalı', 'muslum', 'faruk'];
const ROLE_NAMES = {
  esref:   'Eşref',
  nisan:   'Nisan',
  'gurdalı': 'Gürdalı',
  muslum:  'Müslüm',
  faruk:   'Faruk',
};

// ---- ODA YÖNETİMİ ----
const rooms = {};

function createRoom(id) {
  rooms[id] = {
    id,
    players: {},       // socketId -> playerData
    state: 'waiting',  // waiting|countdown|playing|wave_clear|room_clear|gameover|win
    roomIdx: 0,
    waveIdx: 0,
    enemies: [],
    eBullets: [],
    eidx: 0, ebidx: 0,
    tick: null,
    readyForNext: new Set(),
  };
}

function getRoomOf(sid) {
  for (const [rid, r] of Object.entries(rooms))
    if (r.players[sid]) return { rid, room: r };
  return null;
}

// ---- SPAWN ----
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
  const count = Math.min(base, 20);
  room.enemies = [];
  room.eBullets = [];
  for (let i = 0; i < count; i++) {
    const isBoss = room.roomIdx === 2 && room.waveIdx === 2 && i === 0;
    const type   = isBoss ? 'kadir' : (Math.random() < 0.3 ? 'shooter' : 'thug');
    const { x, y } = edgeSpawn();
    room.enemies.push({
      id: room.eidx++, x, y, type,
      hp:    isBoss ? 400 : type === 'shooter' ? 35 : 50,
      maxHp: isBoss ? 400 : type === 'shooter' ? 35 : 50,
      spd:   isBoss ? 1.6 : type === 'shooter' ? 1.0 : 1.3,
      r:     isBoss ? 16 : 11,
      shootRange: (type === 'shooter' || isBoss) ? 190 : 0,
      shootCd: isBoss ? 55 : 85,
      shootT:  Math.random() * 60,
      angle: 0, dead: false,
    });
  }
}

// ---- TICK ----
function startTick(rid) {
  const room = rooms[rid];
  if (room.tick) clearInterval(room.tick);

  room.tick = setInterval(() => {
    if (room.state !== 'playing') return;
    const plist = Object.values(room.players).filter(p => p.alive);
    if (!plist.length) return;

    // Düşman hareketi
    for (const e of room.enemies) {
      if (e.dead) continue;

      // Eşref'e öncelikli hedef
      let target = plist[0];
      let minD = Infinity;
      for (const p of plist) {
        const d = Math.hypot(p.x - e.x, p.y - e.y);
        if (d < minD) { minD = d; target = p; }
      }
      e.angle = Math.atan2(target.y - e.y, target.x - e.x);
      if (minD > e.r + 12) {
        e.x += Math.cos(e.angle) * e.spd;
        e.y += Math.sin(e.angle) * e.spd;
        e.x = Math.max(-30, Math.min(ROOM_W + 30, e.x));
        e.y = Math.max(-30, Math.min(ROOM_H + 30, e.y));
      }

      // Temas hasarı
      if (minD < e.r + 11) {
        const dmg = e.type === 'kadir' ? 14 : 7;
        target.hp = Math.max(0, target.hp - dmg);
        target.invT = 40;
        if (target.hp <= 0) killPlayer(room, rid, target);
      }

      // Ateş
      if (e.shootRange > 0 && minD < e.shootRange) {
        e.shootT--;
        if (e.shootT <= 0) {
          e.shootT = e.shootCd;
          const spd = e.type === 'kadir' ? 5 : 4;
          room.eBullets.push({
            id: room.ebidx++,
            x: e.x + Math.cos(e.angle) * 16,
            y: e.y + Math.sin(e.angle) * 16,
            vx: Math.cos(e.angle) * spd,
            vy: Math.sin(e.angle) * spd,
            life: 65, r: 4,
          });
        }
      }
    }

    // Düşman mermileri
    for (let i = room.eBullets.length - 1; i >= 0; i--) {
      const b = room.eBullets[i];
      b.x += b.vx; b.y += b.vy; b.life--;
      if (b.life <= 0 || b.x < -10 || b.x > ROOM_W + 10 || b.y < -10 || b.y > ROOM_H + 10) {
        room.eBullets.splice(i, 1); continue;
      }
      for (const p of plist) {
        if ((p.invT || 0) > 0) continue;
        if (Math.hypot(b.x - p.x, b.y - p.y) < b.r + 11) {
          p.hp = Math.max(0, p.hp - 9);
          p.invT = 28;
          room.eBullets.splice(i, 1);
          if (p.hp <= 0) killPlayer(room, rid, p);
          break;
        }
      }
    }

    // invincible tick
    for (const p of Object.values(room.players)) {
      if (p.invT > 0) p.invT--;
      if (p.reloading > 0) { p.reloading--; if (p.reloading === 0) p.ammo = p.maxAmmo; }
    }

    // Dalga bitti mi?
    if (room.enemies.every(e => e.dead)) {
      room.waveIdx++;
      const maxW = 3;
      if (room.waveIdx >= maxW) {
        if (room.roomIdx < 2) {
          room.state = 'room_clear';
          io.to(rid).emit('roomClear', { roomIdx: room.roomIdx });
        } else {
          room.state = 'win';
          io.to(rid).emit('win', { kills: room.enemies.length });
        }
      } else {
        room.state = 'wave_clear';
        io.to(rid).emit('waveClear', { waveIdx: room.waveIdx });
      }
    }

    io.to(rid).emit('tick', {
      enemies:  room.enemies,
      eBullets: room.eBullets,
      players:  room.players,
    });
  }, 1000 / 30);
}

function killPlayer(room, rid, p) {
  p.alive = false;
  io.to(rid).emit('playerDied', { id: p.id, role: p.role });

  if (p.role === 'esref') {
    // Eşref öldü → oyun bitti
    room.state = 'gameover';
    io.to(rid).emit('gameOver', { reason: 'Eşref düştü!' });
    return;
  }
  // Tüm sivillerin ölüp ölmediğini kontrol et
  const civilians = Object.values(room.players).filter(x => x.role !== 'esref');
  if (civilians.every(c => !c.alive)) {
    room.state = 'gameover';
    io.to(rid).emit('gameOver', { reason: 'Tüm siviller öldü!' });
  }
}

// ---- SOCKET OLAYLARI ----
io.on('connection', socket => {
  console.log('+ Bağlandı:', socket.id);

  socket.on('joinRoom', ({ roomId }) => {
    if (!rooms[roomId]) createRoom(roomId);
    const room = rooms[roomId];
    const count = Object.keys(room.players).length;
    if (count >= 4) { socket.emit('roomFull'); return; }

    // Rol ata (Eşref henüz atanmadı, oyun başlayınca atanacak)
    const civIdx = count; // 0-3
    room.players[socket.id] = {
      id: socket.id,
      slot: civIdx,
      role: null,       // oyun başlayınca atanır
      x: 200 + (civIdx % 2) * 80,
      y: 140 + Math.floor(civIdx / 2) * 60,
      angle: 0,
      hp: 100, maxHp: 100,
      ammo: 12, maxAmmo: 12,
      reloading: 0,
      invT: 0,
      alive: true,
      score: 0,
    };

    socket.join(roomId);
    socket.emit('joined', { slot: civIdx, roomId, playerCount: count + 1 });
    io.to(roomId).emit('lobbyUpdate', {
      count: Object.keys(room.players).length,
      slots: Object.values(room.players).map(p => ({ slot: p.slot, id: p.id })),
    });
  });

  socket.on('startGame', () => {
    const res = getRoomOf(socket.id);
    if (!res) return;
    const { room, rid } = res;
    if (Object.keys(room.players).length < 1) return; // en az 1 kişi

    // Rastgele Eşref seç
    const pids = Object.keys(room.players);
    const esrefId = pids[Math.floor(Math.random() * pids.length)];
    const civRoles = [...CIVILIAN_ROLES];
    for (const [sid, p] of Object.entries(room.players)) {
      if (sid === esrefId) {
        p.role = 'esref';
      } else {
        p.role = civRoles.shift();
      }
    }

    room.state = 'playing';
    spawnWave(room);
    startTick(rid);

    // Her oyuncuya kendi rolünü bildir
    for (const [sid, p] of Object.entries(room.players)) {
      io.to(sid).emit('roleAssigned', { role: p.role, esrefId });
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
    p.ammo--;
    if (p.ammo === 0) p.reloading = 90;

    const bx = p.x + Math.cos(angle) * 15;
    const by = p.y + Math.sin(angle) * 15;
    const vx = Math.cos(angle) * 7.5;
    const vy = Math.sin(angle) * 7.5;

    // Çarpışma
    for (const e of room.enemies) {
      if (e.dead) continue;
      let tx = bx, ty = by;
      let hit = false;
      for (let s = 0; s < 55; s++) {
        tx += vx / 7.5; ty += vy / 7.5;
        if (Math.hypot(tx - e.x, ty - e.y) < e.r + 4) { hit = true; break; }
      }
      if (hit) {
        const dmg = p.role === 'esref' ? 28 : 18;
        e.hp -= dmg;
        if (e.hp <= 0) {
          e.dead = true;
          p.score += e.type === 'kadir' ? 500 : e.type === 'shooter' ? 80 : 40;
          if (e.type === 'kadir') io.to(rid).emit('dialog', { speaker: 'Eşref', text: 'Kadir! Artık bitti.' });
        }
        io.to(rid).emit('hit', { ex: e.x, ey: e.y, dead: e.dead, type: e.type });
        break;
      }
    }
    io.to(rid).emit('bullet', { x: bx, y: by, vx, vy, owner: socket.id, role: p.role });
  });

  socket.on('reload', () => {
    const res = getRoomOf(socket.id);
    if (!res) return;
    const p = res.room.players[socket.id];
    if (p && p.reloading === 0 && p.ammo < p.maxAmmo) p.reloading = 90;
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
    console.log('- Ayrıldı:', socket.id);
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
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  let localIP = 'localhost';
  for (const iface of Object.values(nets)) {
    for (const n of iface) {
      if (n.family === 'IPv4' && !n.internal) { localIP = n.address; break; }
    }
  }
  console.log(`🎮 Eşref Rüya Multiplayer`);
  console.log(`   Bu PC:    http://localhost:${PORT}`);
  console.log(`   Ağdaki cihazlar: http://${localIP}:${PORT}`);
});
