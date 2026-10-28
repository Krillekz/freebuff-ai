/* PEAKLINE — local match server
   Serves the app and runs live 1v1 draft rooms over HTTP. No dependencies.
   Start: node server.js   (PORT=8123 by default)

   A room is a five-slot blind draft, same rules as the solo builder:
   the server deals every roll, stores both cores, and only reveals the
   opponent's cards after both players have sealed. */

"use strict";

var http = require("http");
var fs = require("fs");
var path = require("path");
var os = require("os");
var vm = require("vm");
var crypto = require("crypto");

var ROOT = __dirname;
var PORT = Number(process.env.PORT) || 8123;
var HOST = process.env.HOST || "0.0.0.0";

/* ── shared game engine ───────────────────────────────────────────────── */

var shared = {};
var sandbox = { window: { FB: shared }, FB: shared, console: console, Math: Math, Date: Date };
vm.createContext(sandbox);
["js/series.js", "js/data.js", "js/engine.js"].forEach(function (file) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), sandbox, { filename: file });
});
var FB = sandbox.window.FB;

var byId = new Map();
FB.pool.forEach(function (c) { byId.set(c.id, c); });
(FB.modeCards || []).forEach(function (c) { byId.set(c.id, c); });

var SLOTS = 5;

/* ── room store ───────────────────────────────────────────────────────── */

var rooms = new Map();
var queue = [];
var tickets = new Map();

function uid() { return crypto.randomUUID(); }

function makeCode() {
  var alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (var attempt = 0; attempt < 40; attempt++) {
    var out = "";
    var bytes = crypto.randomBytes(4);
    for (var i = 0; i < 4; i++) out += alphabet[bytes[i] % alphabet.length];
    if (!rooms.has(out)) return out;
  }
  return "R" + String(Date.now()).slice(-3);
}

function cleanName(v, fallback) {
  var name = String(v || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 18);
  return name || fallback;
}

function modeFor(series) {
  var key = String(series || "").trim();
  if (key && key !== "all") {
    var pool = FB.modePool(key);
    if (pool && pool.length >= SLOTS) {
      return { series: key, label: key + " only", count: pool.length };
    }
  }
  return { series: null, label: "All anime", count: FB.poolCount };
}

function poolFor(room) {
  return room.mode.series ? FB.modePool(room.mode.series) : FB.pool;
}

function newPlayer(name) {
  return {
    id: uid(),
    token: uid(),
    name: cleanName(name, "PLAYER"),
    deck: [null, null, null, null, null],
    offerId: null,
    rerolls: 1,
    sealed: false,
    pulls: 0
  };
}

function createRoom(hostName, series) {
  var host = newPlayer(hostName);
  var room = {
    code: makeCode(),
    mode: modeFor(series),
    status: "lobby",
    players: [host],
    result: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  rooms.set(room.code, room);
  console.log("[room " + room.code + "] opened by " + host.name + " · " + room.mode.label);
  return room;
}

function addPlayer(room, name) {
  var player = newPlayer(name || ("PLAYER " + (room.players.length + 1)));
  room.players.push(player);
  room.status = room.players.length >= 2 ? "building" : "lobby";
  room.updatedAt = Date.now();
  return player;
}

function findPlayer(room, playerId, token) {
  return room.players.find(function (p) { return p.id === playerId && p.token === token; }) || null;
}

function publicFighter(c) {
  return {
    id: c.id,
    name: c.name,
    series: c.series,
    rarity: c.rarity,
    archLabel: c.archLabel,
    signature: c.signature || null,
    trait: c.trait,
    traps: c.traps,
    seed: c.seed
  };
}

function fullFighter(c) {
  var out = publicFighter(c);
  out.peak = c.peak;
  out.tiers = c.tiers;
  return out;
}

function slotsFiled(player) {
  return player.deck.filter(Boolean).length;
}

function viewFor(room, player) {
  var you = room.players.indexOf(player);
  var reveal = room.status === "result";

  return {
    code: room.code,
    status: room.status,
    mode: room.mode,
    you: you,
    updatedAt: room.updatedAt,
    poolCount: room.mode.count,
    players: room.players.map(function (p, i) {
      var isYou = p.id === player.id;
      var visible = isYou || reveal;
      return {
        slot: i + 1,
        name: p.name,
        isYou: isYou,
        sealed: !!p.sealed,
        slotsFiled: slotsFiled(p),
        offer: isYou && p.offerId && byId.has(p.offerId) ? publicFighter(byId.get(p.offerId)) : null,
        rerolls: isYou ? p.rerolls : null,
        pulls: isYou ? p.pulls : null,
        deck: visible ? p.deck.map(function (c) { return c ? fullFighter(c) : null; }) : null
      };
    }),
    result: reveal ? room.result : null
  };
}

function settle(room) {
  if (room.players.length !== 2) return;
  var a = room.players[0];
  var b = room.players[1];
  if (!a.sealed || !b.sealed) return;

  var m = FB.matchup(a.deck, b.deck, false);
  room.result = {
    rows: m.rows.map(function (row) {
      return {
        key: row.key,
        stat: row.stat,
        a: row.user,
        b: row.ai,
        winner: row.winner === "user" ? "a" : row.winner === "ai" ? "b" : "tie"
      };
    }),
    aTotal: m.userTotal,
    bTotal: m.aiTotal,
    aPoints: m.userPoints,
    bPoints: m.aiPoints,
    verdict: m.verdict === "user" ? "a" : m.verdict === "ai" ? "b" : "draw",
    aPeaks: m.userPeaks,
    bPeaks: m.aiPeaks,
    a: a.deck.map(fullFighter),
    b: b.deck.map(fullFighter),
    aName: a.name,
    bName: b.name,
    at: Date.now()
  };
  room.status = "result";
  room.updatedAt = Date.now();
  console.log("[match " + room.code + "] " + a.name + " " + m.userTotal + " — " + b.name + " " + m.aiTotal + " · " + room.mode.label);
}

function resetRoom(room) {
  room.status = room.players.length >= 2 ? "building" : "lobby";
  room.result = null;
  room.players.forEach(function (p) {
    p.deck = [null, null, null, null, null];
    p.offerId = null;
    p.rerolls = 1;
    p.sealed = false;
    p.pulls = 0;
  });
  room.updatedAt = Date.now();
}

/* ── dealing ──────────────────────────────────────────────────────────── */

function dealCard(room, player, excludeOffer) {
  var pool = poolFor(room);
  var used = {};
  player.deck.forEach(function (c) { if (c) used[c.id] = true; });
  if (excludeOffer && player.offerId) used[player.offerId] = true;

  var free = pool.filter(function (c) { return !used[c.id]; });
  if (!free.length) return null;
  return free[Math.floor(Math.random() * free.length)];
}

/* ── http helpers ─────────────────────────────────────────────────────── */

function json(res, status, data) {
  var payload = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

function readJson(req) {
  return new Promise(function (resolve, reject) {
    var data = "";
    req.on("data", function (chunk) {
      data += chunk;
      if (data.length > 32768) { reject(new Error("payload too large")); req.destroy(); }
    });
    req.on("end", function () {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(new Error("invalid json")); }
    });
    req.on("error", reject);
  });
}

function routeParts(url) {
  return url.split("?")[0].split("/").filter(Boolean);
}

function query(url) {
  var q = {};
  var at = url.indexOf("?");
  if (at < 0) return q;
  url.slice(at + 1).split("&").forEach(function (pair) {
    var kv = pair.split("=");
    if (!kv[0]) return;
    q[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || "");
  });
  return q;
}

/* ── static files ─────────────────────────────────────────────────────── */

var MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2"
};

function serveStatic(req, res, pathname) {
  var rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  if (rel.includes("..") || rel.startsWith(".") || rel === "server.js" || rel.startsWith("server.")) {
    return json(res, 404, { error: "not found" });
  }
  var file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep)) return json(res, 404, { error: "not found" });
  var ext = path.extname(file).toLowerCase();
  if (!MIME[ext]) return json(res, 404, { error: "not found" });
  fs.readFile(file, function (err, buf) {
    if (err) return json(res, 404, { error: "not found" });
    res.writeHead(200, {
      "Content-Type": MIME[ext],
      "Cache-Control": ext === ".html" ? "no-store" : "no-cache",
      "Content-Length": buf.length
    });
    res.end(buf);
  });
}

/* ── request handler ──────────────────────────────────────────────────── */

function handle(req, res) {
  var url = req.url || "/";
  var parts = routeParts(url);
  var q = query(url);

  if (parts[0] !== "api") return serveStatic(req, res, url.split("?")[0]);

  if (req.method === "GET" && parts[1] === "health") {
    return json(res, 200, {
      ok: true,
      rooms: rooms.size,
      queue: queue.length,
      roster: FB.poolCount,
      modes: (FB.MODES || []).length
    });
  }

  if (req.method === "POST" && parts[1] === "rooms" && !parts[2]) {
    return readJson(req).then(function (body) {
      var room = createRoom(body.name, body.series);
      var player = room.players[0];
      json(res, 201, {
        code: room.code,
        playerId: player.id,
        token: player.token,
        view: viewFor(room, player)
      });
    }).catch(function () { json(res, 400, { error: "bad request" }); });
  }

  if (req.method === "POST" && parts[1] === "rooms" && parts[2] && parts[3] === "join") {
    return readJson(req).then(function (body) {
      var room = rooms.get(String(parts[2]).toUpperCase());
      if (!room) return json(res, 404, { error: "room not found" });
      if (room.players.length >= 2) return json(res, 409, { error: "room full" });
      var player = addPlayer(room, body.name);
      console.log("[room " + room.code + "] " + player.name + " joined · " + room.mode.label);
      json(res, 200, {
        code: room.code,
        playerId: player.id,
        token: player.token,
        view: viewFor(room, player)
      });
    }).catch(function () { json(res, 400, { error: "bad request" }); });
  }

  if (req.method === "GET" && parts[1] === "rooms" && parts[2] && !parts[3]) {
    var room = rooms.get(String(parts[2]).toUpperCase());
    if (!room) return json(res, 404, { error: "room not found" });
    var player = findPlayer(room, q.playerId, q.token);
    if (!player) return json(res, 403, { error: "not in room" });
    return json(res, 200, viewFor(room, player));
  }

  if (req.method === "POST" && parts[1] === "rooms" && parts[2] && parts[3] === "roll") {
    return readJson(req).then(function (body) {
      var room = rooms.get(String(parts[2]).toUpperCase());
      if (!room) return json(res, 404, { error: "room not found" });
      var player = findPlayer(room, body.playerId, body.token);
      if (!player) return json(res, 403, { error: "not in room" });
      if (player.sealed) return json(res, 409, { error: "core already sealed" });
      if (player.offerId) return json(res, 409, { error: "assign or reroll the current draw" });
      var card = dealCard(room, player, false);
      if (!card) return json(res, 409, { error: "pool exhausted" });
      player.offerId = card.id;
      player.pulls++;
      room.updatedAt = Date.now();
      json(res, 200, viewFor(room, player));
    }).catch(function () { json(res, 400, { error: "bad request" }); });
  }

  if (req.method === "POST" && parts[1] === "rooms" && parts[2] && parts[3] === "reroll") {
    return readJson(req).then(function (body) {
      var room = rooms.get(String(parts[2]).toUpperCase());
      if (!room) return json(res, 404, { error: "room not found" });
      var player = findPlayer(room, body.playerId, body.token);
      if (!player) return json(res, 403, { error: "not in room" });
      if (!player.offerId) return json(res, 409, { error: "nothing to reroll" });
      if (player.rerolls < 1) return json(res, 409, { error: "no rerolls left" });
      var card = dealCard(room, player, true);
      if (!card) return json(res, 409, { error: "pool exhausted" });
      player.offerId = card.id;
      player.rerolls--;
      player.pulls++;
      room.updatedAt = Date.now();
      json(res, 200, viewFor(room, player));
    }).catch(function () { json(res, 400, { error: "bad request" }); });
  }

  if (req.method === "POST" && parts[1] === "rooms" && parts[2] && parts[3] === "assign") {
    return readJson(req).then(function (body) {
      var room = rooms.get(String(parts[2]).toUpperCase());
      if (!room) return json(res, 404, { error: "room not found" });
      var player = findPlayer(room, body.playerId, body.token);
      if (!player) return json(res, 403, { error: "not in room" });
      var slot = Number(body.slot);
      if (!Number.isInteger(slot) || slot < 0 || slot >= SLOTS) return json(res, 400, { error: "bad slot" });
      if (!player.offerId) return json(res, 409, { error: "nothing to assign" });
      if (player.deck[slot]) return json(res, 409, { error: "slot occupied" });
      var card = byId.get(player.offerId);
      if (!card) return json(res, 409, { error: "unknown card" });
      player.deck[slot] = card;
      player.offerId = null;
      if (player.deck.every(Boolean)) player.sealed = true;
      room.updatedAt = Date.now();
      settle(room);
      json(res, 200, viewFor(room, player));
    }).catch(function () { json(res, 400, { error: "bad request" }); });
  }

  if (req.method === "POST" && parts[1] === "rooms" && parts[2] && parts[3] === "rematch") {
    return readJson(req).then(function (body) {
      var room = rooms.get(String(parts[2]).toUpperCase());
      if (!room) return json(res, 404, { error: "room not found" });
      var player = findPlayer(room, body.playerId, body.token);
      if (!player) return json(res, 403, { error: "not in room" });
      if (room.status !== "result") return json(res, 409, { error: "match not finished" });
      resetRoom(room);
      json(res, 200, viewFor(room, player));
    }).catch(function () { json(res, 400, { error: "bad request" }); });
  }

  if (req.method === "POST" && parts[1] === "rooms" && parts[2] && parts[3] === "leave") {
    return readJson(req).then(function (body) {
      var room = rooms.get(String(parts[2]).toUpperCase());
      if (!room) return json(res, 200, { ok: true });
      var player = findPlayer(room, body.playerId, body.token);
      if (player) {
        room.players = room.players.filter(function (p) { return p !== player; });
        console.log("[room " + room.code + "] " + player.name + " left");
      }
      if (!room.players.length) rooms.delete(room.code);
      else resetRoom(room);
      json(res, 200, { ok: true });
    }).catch(function () { json(res, 400, { error: "bad request" }); });
  }

  /* ── public queue ───────────────────────────────────────────────────── */

  if (req.method === "POST" && parts[1] === "queue" && !parts[2]) {
    return readJson(req).then(function (body) {
      var name = cleanName(body.name, "PLAYER");
      var mode = modeFor(body.series);
      var key = mode.series || "all";

      var at = queue.findIndex(function (e) { return !e.matched && e.modeKey === key; });
      if (at >= 0) {
        var waiting = queue.splice(at, 1)[0];
        var room = createRoom(waiting.name, waiting.modeSeries);
        var host = room.players[0];
        host.id = waiting.playerId;
        host.token = waiting.token;
        var guest = addPlayer(room, name);
        waiting.matched = { code: room.code, playerId: waiting.playerId, token: waiting.token };
        console.log("[queue] paired " + waiting.name + " with " + guest.name + " · " + room.mode.label + " · " + room.code);
        return json(res, 200, {
          status: "matched",
          code: room.code,
          playerId: guest.id,
          token: guest.token,
          opponent: waiting.name,
          view: viewFor(room, guest)
        });
      }

      var entry = {
        ticket: uid(),
        playerId: uid(),
        token: uid(),
        name: name,
        modeSeries: mode.series,
        modeKey: key,
        at: Date.now(),
        matched: null
      };
      tickets.set(entry.ticket, entry);
      queue.push(entry);
      console.log("[queue] waiting: " + name + " · " + mode.label);
      json(res, 200, { status: "waiting", ticket: entry.ticket, mode: mode });
    }).catch(function () { json(res, 400, { error: "bad request" }); });
  }

  if (req.method === "GET" && parts[1] === "queue" && parts[2]) {
    var entry = tickets.get(parts[2]);
    if (!entry) return json(res, 404, { error: "ticket expired" });
    if (entry.matched) return json(res, 200, { status: "matched", ...entry.matched });
    if (queue.indexOf(entry) >= 0) return json(res, 200, { status: "waiting" });
    return json(res, 404, { error: "ticket expired" });
  }

  if (req.method === "DELETE" && parts[1] === "queue" && parts[2]) {
    var at = queue.findIndex(function (e) { return e.ticket === parts[2]; });
    if (at >= 0) queue.splice(at, 1);
    tickets.delete(parts[2]);
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: "not found" });
}

var server = http.createServer(function (req, res) {
  try {
    handle(req, res);
  } catch (e) {
    console.error("[error]", e && e.message);
    if (!res.headersSent) json(res, 500, { error: "server error" });
    else res.end();
  }
});

server.on("clientError", function (err, socket) {
  try { socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"); } catch (e) { /* ignore */ }
});

setInterval(function () {
  var cutoff = Date.now() - 45 * 60 * 1000;
  rooms.forEach(function (room, code) {
    if (room.updatedAt < cutoff) {
      rooms.delete(code);
      console.log("[room " + code + "] expired");
    }
  });
  var qcut = Date.now() - 5 * 60 * 1000;
  for (var i = queue.length - 1; i >= 0; i--) {
    if (queue[i].at < qcut && !queue[i].matched) queue.splice(i, 1);
  }
  tickets.forEach(function (t, key) {
    if (Date.now() - t.at > 10 * 60 * 1000) tickets.delete(key);
  });
}, 60000);

server.listen(PORT, HOST, function () {
  console.log("PEAKLINE match server on http://127.0.0.1:" + PORT);
  Object.keys(os.networkInterfaces()).forEach(function (name) {
    (os.networkInterfaces()[name] || []).forEach(function (iface) {
      if (iface.family === "IPv4" && !iface.internal) {
        console.log("  LAN: http://" + iface.address + ":" + PORT);
      }
    });
  });
  console.log("  Modes: " + (FB.MODES || []).map(function (m) { return m.series + " (" + m.count + ")"; }).join(" · "));
});
