(function () {
  "use strict";

  /* =========================
     Emoji / Tokens
  ========================= */
  const EMOJI = {
    player: "🧙‍♂️",
    enemy: "😈",
    enemyAtk: "👿",
    boss: "👹",
    gem: "💎",
    heart: "❤️‍🩹",
    zap: "⚡",
    wall: "⬛",
    floor: "",
    door: "🚪"
  };

  /* =========================
     RNG helpers (seeded)
  ========================= */
  function xmur3(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      h ^= h >>> 16;
      return h >>> 0;
    };
  }
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeRng(seedStr) {
    const seedFn = xmur3(seedStr);
    return mulberry32(seedFn());
  }
  function randInt(rng, lo, hi) {
    return Math.floor(rng() * (hi - lo + 1)) + lo;
  }
  function choice(rng, arr) {
    return arr[Math.floor(rng() * arr.length)];
  }

  /* =========================
     DOM
  ========================= */
  const $ = (s) => document.querySelector(s);
  const boardEl = $("#board");
  const roomsListEl = $("#roomsList");
  const seedTxt = $("#seedTxt");
  const hpTxt = $("#hpTxt");
  const gemTxt = $("#gemTxt");
  const roomTxt = $("#roomTxt");
  const powTxt = $("#powTxt");
  const logEl = $("#log");

  const overlay = $("#overlay");
  const ovTitle = $("#ovTitle");
  const ovDesc = $("#ovDesc");

  const btnNew = $("#btnNew");
  const btnRestart = $("#btnRestart");
  const btnAgain = $("#btnAgain");
  const btnNew2 = $("#btnNew2");

  /* =========================
     Game constants
  ========================= */
  const W = 17;
  const H = 11;
  const ROOMS = 10;

  const DIRS = {
    U: { x: 0, y: -1, name: "N" },
    D: { x: 0, y: 1, name: "S" },
    L: { x: -1, y: 0, name: "W" },
    R: { x: 1, y: 0, name: "E" }
  };
  const OPP = { N: "S", S: "N", E: "W", W: "E" };

  /* =========================
     Game state
  ========================= */
  let G = null;
  let cells = [];
  let alive = true;

  function addLog(msg, cls) {
    G.log.push({ msg, cls: cls || "" });
    if (G.log.length > 80) G.log.shift();
    renderLog();
  }
  function renderLog() {
    logEl.innerHTML = G.log
      .map((it) => {
        const c = it.cls ? ` class="${it.cls}"` : "";
        return `<div${c}>${escapeHtml(it.msg)}</div>`;
      })
      .join("");
    logEl.scrollTop = logEl.scrollHeight;
  }
  function escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (m) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#039;"
        }[m])
    );
  }

  /* =========================
     Rooms layout
  ========================= */
  function keyXY(x, y) {
    return x + "," + y;
  }

  function buildRoomLayout(rng) {
    const placed = new Map();
    const coords = [];
    const rooms = [];

    function addRoom(x, y) {
      const id = rooms.length;
      placed.set(keyXY(x, y), id);
      coords.push({ x, y, id });
      rooms.push({
        id,
        x,
        y,
        neighbors: { N: null, S: null, E: null, W: null },
        doors: {},
        tiles: null,
        enemies: [],
        pickups: new Map(),
        cleared: false,
        visited: false,
        bossHere: false,
        freezeTurns: 0
      });
      return id;
    }

    addRoom(0, 0);

    const dirList = [
      { d: "N", dx: 0, dy: -1 },
      { d: "S", dx: 0, dy: 1 },
      { d: "W", dx: -1, dy: 0 },
      { d: "E", dx: 1, dy: 0 }
    ];

    while (rooms.length < ROOMS) {
      const base = choice(rng, coords);
      const pick = choice(rng, dirList);
      const nx = base.x + pick.dx;
      const ny = base.y + pick.dy;
      const k = keyXY(nx, ny);
      if (!placed.has(k)) {
        addRoom(nx, ny);
      }
    }

    for (const r of rooms) {
      const north = placed.get(keyXY(r.x, r.y - 1));
      const south = placed.get(keyXY(r.x, r.y + 1));
      const west = placed.get(keyXY(r.x - 1, r.y));
      const east = placed.get(keyXY(r.x + 1, r.y));
      r.neighbors.N = north === undefined ? null : north;
      r.neighbors.S = south === undefined ? null : south;
      r.neighbors.W = west === undefined ? null : west;
      r.neighbors.E = east === undefined ? null : east;
    }

    const dist = bfsDistances(rooms, 0);
    let bossId = 0,
      best = -1;
    for (const r of rooms) {
      const d = dist.get(r.id);
      if (d !== undefined && d > best) {
        best = d;
        bossId = r.id;
      }
    }
    rooms[bossId].bossHere = true;

    const pairDone = new Set();
    function pairKey(a, b) {
      return a < b ? a + "-" + b : b + "-" + a;
    }

    for (const r of rooms) {
      for (const dir of ["N", "S", "W", "E"]) {
        const nb = r.neighbors[dir];
        if (nb == null) continue;
        const pk = pairKey(r.id, nb);
        if (pairDone.has(pk)) continue;
        pairDone.add(pk);

        if (dir === "N" || dir === "S") {
          const x = randInt(rng, 2, W - 3);
          rooms[r.id].doors[dir] = { x, y: dir === "N" ? 0 : H - 1 };
          rooms[nb].doors[OPP[dir]] = { x, y: dir === "N" ? H - 1 : 0 };
        } else {
          const y = randInt(rng, 2, H - 3);
          rooms[r.id].doors[dir] = { x: dir === "W" ? 0 : W - 1, y };
          rooms[nb].doors[OPP[dir]] = { x: dir === "W" ? W - 1 : 0, y };
        }
      }
    }

    return rooms;
  }

  function bfsDistances(rooms, startId) {
    const q = [startId];
    const dist = new Map();
    dist.set(startId, 0);

    while (q.length) {
      const id = q.shift();
      const d = dist.get(id);
      const r = rooms[id];
      for (const dir of ["N", "S", "W", "E"]) {
        const nb = r.neighbors[dir];
        if (nb == null) continue;
        if (!dist.has(nb)) {
          dist.set(nb, d + 1);
          q.push(nb);
        }
      }
    }
    return dist;
  }

  /* =========================
     Room generation
  ========================= */
  function genRoom(room, seedStr) {
    const rng = makeRng(
      seedStr + "|room|" + room.id + "|" + room.x + "," + room.y
    );

    let tiles = [];
    for (let y = 0; y < H; y++) {
      const row = [];
      for (let x = 0; x < W; x++) {
        const border = x === 0 || y === 0 || x === W - 1 || y === H - 1;
        row.push(border ? 1 : 0);
      }
      tiles.push(row);
    }

    for (const dir of ["N", "S", "W", "E"]) {
      const dp = room.doors[dir];
      if (!dp) continue;
      tiles[dp.y][dp.x] = 0;
    }

    const tries = 30;
    for (let t = 0; t < tries; t++) {
      const cx = randInt(rng, 2, W - 3);
      const cy = randInt(rng, 2, H - 3);
      const shape = choice(rng, ["dot", "plus", "barH", "barV"]);
      const pts = [];
      pts.push([cx, cy]);
      if (shape === "plus") {
        pts.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
      } else if (shape === "barH") {
        pts.push([cx - 1, cy], [cx + 1, cy]);
      } else if (shape === "barV") {
        pts.push([cx, cy - 1], [cx, cy + 1]);
      }
      for (const [x, y] of pts) {
        if (x <= 1 || y <= 1 || x >= W - 2 || y >= H - 2) continue;
        tiles[y][x] = rng() < 0.75 ? 1 : tiles[y][x];
      }
    }

    const spawn = findGoodSpawn(tiles, room, rng);
    carveConnectivity(tiles, spawn, room);

    room.tiles = tiles;

    room.pickups.clear();

    const gemCount = randInt(rng, 3, 7);
    for (let i = 0; i < gemCount; i++) {
      const p = randomFloor(tiles, room, rng);
      if (!p) continue;
      room.pickups.set(keyXY(p.x, p.y), "gem");
    }

    const heartCount = rng() < 0.55 ? randInt(rng, 0, 2) : 0;
    for (let i = 0; i < heartCount; i++) {
      const p = randomFloor(tiles, room, rng);
      if (!p) continue;
      room.pickups.set(keyXY(p.x, p.y), "heart");
    }

    if (rng() < 0.35) {
      const p = randomFloor(tiles, room, rng);
      if (p) room.pickups.set(keyXY(p.x, p.y), "zap");
    }

    room.enemies = [];
    const baseEnemies = room.bossHere ? randInt(rng, 2, 4) : randInt(rng, 2, 6);

    for (let i = 0; i < baseEnemies; i++) {
      const p = randomFloor(tiles, room, rng, spawn);
      if (!p) continue;
      room.enemies.push({
        id: "e" + room.id + "_" + i,
        x: p.x,
        y: p.y,
        hp: room.bossHere ? 2 : randInt(rng, 1, 2),
        atk: 1,
        flash: 0,
        kind: "enemy"
      });
    }

    if (room.bossHere) {
      const p = randomFloor(tiles, room, rng, spawn);
      if (p) {
        room.enemies.push({
          id: "boss_" + room.id,
          x: p.x,
          y: p.y,
          hp: 10,
          atk: 2,
          flash: 0,
          kind: "boss"
        });
      }
    }

    room.cleared = room.enemies.length === 0;
    room.visited = false;

    return spawn;
  }

  function findGoodSpawn(tiles, room, rng) {
    for (let t = 0; t < 200; t++) {
      const x = randInt(rng, 2, W - 3);
      const y = randInt(rng, 2, H - 3);
      if (tiles[y][x] !== 0) continue;
      if (isDoorCell(room, x, y)) continue;
      return { x, y };
    }
    return { x: 2, y: 2 };
  }

  function isDoorCell(room, x, y) {
    for (const dir of ["N", "S", "W", "E"]) {
      const d = room.doors[dir];
      if (d && d.x === x && d.y === y) return true;
    }
    return false;
  }

  function carveConnectivity(tiles, spawn, room) {
    const reach = flood(tiles, spawn.x, spawn.y);

    for (const dir of ["N", "S", "W", "E"]) {
      const d = room.doors[dir];
      if (!d) continue;
      if (!reach.has(keyXY(d.x, d.y))) {
        let x = spawn.x,
          y = spawn.y;
        while (x !== d.x) {
          x += d.x > x ? 1 : -1;
          if (x > 0 && x < W - 1 && y > 0 && y < H - 1) tiles[y][x] = 0;
        }
        while (y !== d.y) {
          y += d.y > y ? 1 : -1;
          if (x > 0 && x < W - 1 && y > 0 && y < H - 1) tiles[y][x] = 0;
        }
      }
      tiles[d.y][d.x] = 0;
    }
  }

  function flood(tiles, sx, sy) {
    const q = [{ x: sx, y: sy }];
    const seen = new Set([keyXY(sx, sy)]);
    while (q.length) {
      const p = q.shift();
      const nbs = [
        { x: p.x + 1, y: p.y },
        { x: p.x - 1, y: p.y },
        { x: p.x, y: p.y + 1 },
        { x: p.x, y: p.y - 1 }
      ];
      for (const n of nbs) {
        if (n.x < 0 || n.y < 0 || n.x >= W || n.y >= H) continue;
        if (tiles[n.y][n.x] !== 0) continue;
        const k = keyXY(n.x, n.y);
        if (seen.has(k)) continue;
        seen.add(k);
        q.push(n);
      }
    }
    return seen;
  }

  function randomFloor(tiles, room, rng, avoid) {
    for (let t = 0; t < 500; t++) {
      const x = randInt(rng, 1, W - 2);
      const y = randInt(rng, 1, H - 2);
      if (tiles[y][x] !== 0) continue;
      if (avoid && manhattan(x, y, avoid.x, avoid.y) < 4) continue;
      if (isDoorCell(room, x, y)) continue;
      return { x, y };
    }
    return null;
  }

  function manhattan(ax, ay, bx, by) {
    return Math.abs(ax - bx) + Math.abs(ay - by);
  }

  /* =========================
     Rendering
  ========================= */
  function buildBoardDom() {
    boardEl.style.setProperty("--w", W);
    boardEl.innerHTML = "";
    cells = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d = document.createElement("div");
        d.className = "cell floor";
        d.textContent = "";
        d.dataset.x = x;
        d.dataset.y = y;
        boardEl.appendChild(d);
        cells.push(d);
      }
    }
  }
  function cellAt(x, y) {
    return cells[y * W + x];
  }

  function render() {
    const room = G.rooms[G.curRoom];
    const tiles = room.tiles;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = cellAt(x, y);
        const isWall = tiles[y][x] === 1;
        c.className = "cell " + (isWall ? "wall" : "floor");
        c.textContent = "";

        const doorDir = doorDirAt(room, x, y);
        if (doorDir) {
          const locked = !room.cleared;
          c.className = "cell " + (locked ? "lockedDoor" : "door");
          c.textContent = EMOJI.door;
        }
      }
    }

    for (const [k, type] of room.pickups.entries()) {
      const [xs, ys] = k.split(",");
      const x = +xs,
        y = +ys;
      const c = cellAt(x, y);
      if (!c) continue;
      if (type === "gem") c.textContent = EMOJI.gem;
      if (type === "heart") c.textContent = EMOJI.heart;
      if (type === "zap") {
        c.textContent = EMOJI.zap;
        c.classList.add("zap-item");
      }
    }

    for (const e of room.enemies) {
      const c = cellAt(e.x, e.y);
      if (!c) continue;
      if (e.flash > 0) {
        c.textContent = EMOJI.enemyAtk;
      } else {
        c.textContent = e.kind === "boss" ? EMOJI.boss : EMOJI.enemy;
      }
    }

    cellAt(G.player.x, G.player.y).textContent = EMOJI.player;

    hpTxt.textContent = `${G.player.hp}/${G.player.maxHp}`;
    gemTxt.textContent = `${EMOJI.gem} ${G.player.gems}`;
    roomTxt.textContent = `${G.curRoom + 1}/${ROOMS}`;
    const pow = G.player.hasZap ? `${EMOJI.zap} Ready (F)` : "None";
    const freeze = room.freezeTurns > 0 ? ` Freeze ${room.freezeTurns}` : "";
    powTxt.textContent = pow + freeze;

    renderRoomsList();

    for (const e of room.enemies) {
      if (e.flash > 0) e.flash--;
    }
  }

  function doorDirAt(room, x, y) {
    for (const dir of ["N", "S", "W", "E"]) {
      const d = room.doors[dir];
      if (d && d.x === x && d.y === y) return dir;
    }
    return null;
  }

  function renderRoomsList() {
    roomsListEl.innerHTML = "";
    for (const r of G.rooms) {
      const div = document.createElement("div");
      div.className = "roomItem";
      div.dataset.current = r.id === G.curRoom ? "true" : "false";

      const left = document.createElement("div");
      left.className = "left";

      const badge = document.createElement("div");
      badge.className = "badge";
      badge.textContent = r.id + 1;

      const name = document.createElement("div");
      name.className = "name";
      let label = r.bossHere ? "Boss Room" : "Room";
      if (!r.visited) label += " (unknown)";
      name.textContent = label;

      left.appendChild(badge);
      left.appendChild(name);

      const tag = document.createElement("div");
      tag.className = "tag";
      if (r.bossHere) {
        tag.classList.add("gold");
        tag.textContent = "👹";
      } else if (!r.visited) {
        tag.textContent = "???";
      } else if (r.cleared) {
        tag.classList.add("ok");
        tag.textContent = "Cleared";
      } else {
        tag.classList.add("bad");
        tag.textContent = `${r.enemies.length} 😈`;
      }

      div.appendChild(left);
      div.appendChild(tag);
      roomsListEl.appendChild(div);
    }
  }

  function setOverlay(open, title, desc) {
    overlay.dataset.open = open ? "true" : "false";
    if (title) ovTitle.textContent = title;
    if (desc) ovDesc.textContent = desc;
  }

  /* =========================
     Gameplay rules
  ========================= */
  function isBlocked(room, x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return true;
    if (room.tiles[y][x] === 1) return true;
    return false;
  }

  function enemyAt(room, x, y) {
    return room.enemies.find((e) => e.x === x && e.y === y) || null;
  }

  function pickupAt(room, x, y) {
    return room.pickups.get(keyXY(x, y)) || null;
  }

  function removePickup(room, x, y) {
    room.pickups.delete(keyXY(x, y));
  }

  function roomCleared(room) {
    return room.enemies.length === 0;
  }

  function onPlayerAction(dirKey) {
    if (!alive) return;
    const room = G.rooms[G.curRoom];
    room.visited = true;

    const dir = DIRS[dirKey];
    if (!dir) return;

    const tx = G.player.x + dir.x;
    const ty = G.player.y + dir.y;

    const ddir = doorDirAt(room, tx, ty);
    if (ddir) {
      if (!room.cleared) {
        addLog("Door is locked. Clear the room first.", "muted");
        enemiesTurn();
        afterTurn();
        return;
      }
      const nb = room.neighbors[ddir];
      if (nb == null) {
        addLog("That door leads nowhere. Weird.", "muted");
        enemiesTurn();
        afterTurn();
        return;
      }
      moveToRoom(nb, OPP[ddir]);
      enemiesTurn();
      afterTurn();
      return;
    }

    const e = enemyAt(room, tx, ty);
    if (e) {
      playerAttack(room, e);
      enemiesTurn();
      afterTurn();
      return;
    }

    if (!isBlocked(room, tx, ty) && !enemyAt(room, tx, ty)) {
      G.player.x = tx;
      G.player.y = ty;
      handlePickup(room);
    } else {
      addLog("Bonk. Can't move there.", "muted");
    }

    enemiesTurn();
    afterTurn();
  }

  function playerAttack(room, e) {
    const dmg = G.player.atk;
    e.hp -= dmg;
    addLog(
      `You bonk ${e.kind === "boss" ? "the boss" : "a demon"} for ${dmg}.`,
      "good"
    );

    if (e.hp <= 0) {
      addLog(`${e.kind === "boss" ? "Boss" : "Demon"} defeated.`, "good");

      if (Math.random() < 0.35) {
        room.pickups.set(keyXY(e.x, e.y), "gem");
        addLog("It drops a 💎.", "gold");
      }

      room.enemies = room.enemies.filter((x) => x !== e);
      if (roomCleared(room)) {
        room.cleared = true;
        addLog("Room cleared. Doors unlocked.", "gold");
        if (room.bossHere) {
          winGame();
        }
      }
    }
  }

  function enemiesTurn() {
    const room = G.rooms[G.curRoom];

    if (room.freezeTurns > 0) {
      room.freezeTurns--;
      addLog("Enemies are frozen.", "muted");
      return;
    }

    for (const e of room.enemies) {
      const wasAdj = isAdjacent(e.x, e.y, G.player.x, G.player.y);

      const step = stepToward(room, e.x, e.y, G.player.x, G.player.y);
      if (step) {
        if (!(step.x === G.player.x && step.y === G.player.y)) {
          const occ = enemyAt(room, step.x, step.y);
          if (!occ) {
            e.x = step.x;
            e.y = step.y;
          }
        }
      }

      const adj = isAdjacent(e.x, e.y, G.player.x, G.player.y);
      if (adj || wasAdj) {
        enemyAttack(e);
        if (!alive) return;
      }
    }
  }

  function enemyAttack(e) {
    e.flash = 3;
    const dmg = e.atk;
    G.player.hp -= dmg;

    addLog(
      `${e.kind === "boss" ? "Boss" : "Demon"} hits you for ${dmg}.`,
      "bad"
    );

    if (G.player.hp <= 0) {
      G.player.hp = 0;
      alive = false;
      setOverlay(
        true,
        "Game Over",
        `You were defeated in room ${G.curRoom + 1}. Press Restart or New Run.`
      );
    }
  }

  function isAdjacent(ax, ay, bx, by) {
    return Math.abs(ax - bx) + Math.abs(ay - by) === 1;
  }

  function stepToward(room, ex, ey, px, py) {
    const dx = px - ex;
    const dy = py - ey;

    const cand = [];
    if (Math.abs(dx) >= Math.abs(dy)) {
      cand.push(dx > 0 ? DIRS.R : DIRS.L);
      if (dy !== 0) cand.push(dy > 0 ? DIRS.D : DIRS.U);
    } else {
      cand.push(dy > 0 ? DIRS.D : DIRS.U);
      if (dx !== 0) cand.push(dx > 0 ? DIRS.R : DIRS.L);
    }

    cand.push(DIRS.U, DIRS.D, DIRS.L, DIRS.R);

    const seen = new Set();
    for (const d of cand) {
      const k = d.name;
      if (seen.has(k)) continue;
      seen.add(k);
      const nx = ex + d.x;
      const ny = ey + d.y;
      if (isBlocked(room, nx, ny)) continue;
      return { x: nx, y: ny };
    }
    return null;
  }

  function handlePickup(room) {
    const type = pickupAt(room, G.player.x, G.player.y);
    if (!type) return;

    if (type === "gem") {
      G.player.gems += 1;
      addLog("Picked up 💎.", "gold");
      removePickup(room, G.player.x, G.player.y);
      return;
    }

    if (type === "heart") {
      const heal = 2;
      const before = G.player.hp;
      G.player.hp = Math.min(G.player.maxHp, G.player.hp + heal);
      addLog(`Picked up ❤️‍🩹. Healed ${G.player.hp - before}.`, "good");
      removePickup(room, G.player.x, G.player.y);
      return;
    }

    if (type === "zap") {
      if (G.player.hasZap) {
        addLog("You already have ⚡. Can't carry another.", "muted");
        return;
      }
      G.player.hasZap = true;
      addLog("Picked up ⚡. Press F to freeze enemies for 3 turns.", "gold");
      removePickup(room, G.player.x, G.player.y);
      return;
    }
  }

  function useZap() {
    if (!alive) return;
    const room = G.rooms[G.curRoom];
    if (!G.player.hasZap) {
      addLog("No ⚡ to use.", "muted");
      return;
    }
    G.player.hasZap = false;
    room.freezeTurns = 3;
    addLog("⚡ used. All enemies frozen for 3 turns.", "gold");
    render();
  }

  function moveToRoom(roomId, enterFromDir) {
    const next = G.rooms[roomId];
    const dp = next.doors[enterFromDir];
    if (dp) {
      G.curRoom = roomId;
      G.player.x = dp.x;
      G.player.y = dp.y;
    } else {
      G.curRoom = roomId;
      G.player.x = 2;
      G.player.y = 2;
    }
    next.visited = true;
    handlePickup(next);
    addLog(`Entered room ${roomId + 1}.`, "muted");
  }

  function afterTurn() {
    const room = G.rooms[G.curRoom];
    room.cleared = roomCleared(room);
    render();
  }

  function winGame() {
    alive = false;
    setOverlay(
      true,
      "You Win",
      `Boss defeated. Final currency: ${G.player.gems} 💎. Start a new run?`
    );
  }

  /* =========================
     New run / restart
  ========================= */
  function randomSeed() {
    const a = Math.floor(Math.random() * 1e9).toString(36);
    const b = Math.floor(Math.random() * 1e9).toString(36);
    return (a + "-" + b).slice(0, 12);
  }

  function startRun(seedStr) {
    alive = true;
    setOverlay(false);

    const rng = makeRng(seedStr);
    const rooms = buildRoomLayout(rng);

    const spawns = new Map();
    for (const r of rooms) {
      const s = genRoom(r, seedStr);
      spawns.set(r.id, s);
    }

    const s0 = spawns.get(0) || { x: 2, y: 2 };

    G = {
      seed: seedStr,
      rooms,
      curRoom: 0,
      player: {
        x: s0.x,
        y: s0.y,
        hp: 10,
        maxHp: 10,
        atk: 1,
        gems: 0,
        hasZap: true
      },
      log: []
    };

    G.rooms[0].visited = true;
    seedTxt.textContent = seedStr;

    addLog("New run started.", "muted");
    addLog("Clear a room to unlock doors. Attack by walking into 😈.", "muted");
    addLog("Pick up ⚡ then press F to freeze enemies for 3 turns.", "muted");

    buildBoardDom();
    handlePickup(G.rooms[G.curRoom]);
    render();
  }

  function restartSameSeed() {
    startRun(G ? G.seed : randomSeed());
  }

  /* =========================
     Input
  ========================= */
  function onKey(e) {
    const k = e.key;

    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(k)) {
      e.preventDefault();
    }

    if (k === "r" || k === "R") {
      restartSameSeed();
      return;
    }

    if (k === "f" || k === "F") {
      useZap();
      return;
    }

    if (k === "ArrowUp") return onPlayerAction("U");
    if (k === "ArrowDown") return onPlayerAction("D");
    if (k === "ArrowLeft") return onPlayerAction("L");
    if (k === "ArrowRight") return onPlayerAction("R");
  }

  /* =========================
     Buttons
  ========================= */
  btnNew.addEventListener("click", () => startRun(randomSeed()));
  btnRestart.addEventListener("click", () => restartSameSeed());
  btnAgain.addEventListener("click", () => restartSameSeed());
  btnNew2.addEventListener("click", () => startRun(randomSeed()));

  window.addEventListener("keydown", onKey, { passive: false });

  /* =========================
     Boot
  ========================= */
  startRun(randomSeed());
})();
