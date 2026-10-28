/* PEAKLINE — live 1v1 client
   A two-player room that runs the exact 01 builder loop: five server-dealt
   rolls, blind filing, one reroll each, then a sealed deck-vs-deck result.
   Rooms are hosted on the local relay (server.js) with a code or public queue.
   The app stays fully playable when the relay is not running. */

(function (FB) {
  "use strict";

  var KEY = "fb.room.v1";
  var NAME_KEY = "fb.handle.v1";
  var MODE_KEY = "fb.hostmode.v1";

  var state = {
    online: null,
    mode: "entry",        // entry | queue | room
    room: null,           // { code, playerId, token }
    view: null,
    ticket: null,
    series: "",
    queueMode: null,
    error: "",
    notice: "",
    loading: false,
    renderedOfferId: null,
    stageSig: "",
    deckSig: "",
    resultSig: "",
    lastLocked: -1
  };

  var timer = null;

  var $ = function (sel) { return document.querySelector(sel); };

  function esc(v) {
    return String(v).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function pad(n) { return String(n).padStart(2, "0"); }
  function pad3(n) { return String(n).padStart(3, "0"); }

  function handle() {
    var saved = "";
    try { saved = localStorage.getItem(NAME_KEY) || ""; } catch (e) { saved = ""; }
    return String(saved || "PLAYER 01").slice(0, 18);
  }

  function setHandle(v) {
    try { localStorage.setItem(NAME_KEY, String(v || "").slice(0, 18)); } catch (e) { /* ignore */ }
  }

  function loadMode() {
    var saved = "";
    try { saved = localStorage.getItem(MODE_KEY) || ""; } catch (e) { saved = ""; }
    if (!saved) return "";
    return findMode(saved) ? saved : "";
  }

  function saveMode() {
    try { localStorage.setItem(MODE_KEY, state.series || ""); } catch (e) { /* ignore */ }
  }

  function findMode(series) {
    if (!series || !FB.MODES) return null;
    for (var i = 0; i < FB.MODES.length; i++) {
      if (FB.MODES[i].series === series) return FB.MODES[i];
    }
    return null;
  }

  function modeLabel(series) {
    var m = findMode(series);
    return m ? m.label : "All anime";
  }

  function modeCount(series) {
    var m = findMode(series);
    return m ? m.count : FB.poolCount;
  }

  function api(path, options) {
    var opts = options || {};
    var init = {
      method: opts.method || "GET",
      cache: "no-store",
      headers: { "Content-Type": "application/json" }
    };
    if (opts.body) init.body = JSON.stringify(opts.body);
    return fetch(path, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) {
          var err = new Error(body.error || "HTTP " + res.status);
          err.status = res.status;
          throw err;
        }
        return body;
      });
    });
  }

  function saveRoom() {
    try { sessionStorage.setItem(KEY, JSON.stringify(state.room)); } catch (e) { /* ignore */ }
  }

  function loadRoom() {
    try {
      var raw = sessionStorage.getItem(KEY);
      if (!raw) return null;
      var room = JSON.parse(raw);
      if (room && room.code && room.playerId && room.token) return room;
    } catch (e) { /* ignore */ }
    return null;
  }

  function clearRoom() {
    try { sessionStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  function stopTimer() {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  function versionOf(view) {
    return view && view.updatedAt ? view.updatedAt : 0;
  }

  /* Late poll responses must never roll the board backwards. */
  function applyView(view) {
    if (!view) return;
    if (state.view && versionOf(view) && versionOf(state.view) && versionOf(view) < versionOf(state.view)) return;
    state.view = view;
    renderRoomView();
  }

  /* ── relay status ────────────────────────────────────────────────────── */

  function applyOnline(online) {
    var pill = $("#server-status");
    if (pill) {
      pill.textContent = online === true ? "SERVER · ONLINE" : online === false ? "SERVER · OFFLINE" : "SERVER · CHECKING";
      pill.classList.toggle("is-off", online === false);
    }
    var banner = $("#mp-offline");
    if (banner) banner.hidden = online !== false;
    var metric = $("#live-metric");
    if (metric) {
      metric.textContent = online === true ? "Local relay · rooms + queue" : online === false ? "Relay offline" : "Checking the relay…";
    }
    var status = $("#mp-status");
    if (status) {
      status.textContent = online === true ? "RELAY ONLINE" : online === false ? "RELAY OFFLINE" : "CHECKING RELAY";
      status.classList.toggle("is-off", online === false);
    }
    var buttons = document.querySelectorAll("#live-root [data-needs-relay]");
    Array.prototype.forEach.call(buttons, function (btn) { btn.disabled = online === false; });
  }

  function probe() {
    return api("/api/health").then(function (body) {
      state.online = true;
      applyOnline(true);
      return body;
    }).catch(function () {
      state.online = false;
      applyOnline(false);
      return null;
    });
  }

  /* ── mode chrome ─────────────────────────────────────────────────────── */

  function modeOptions() {
    var out = '<option value=""' + (state.series ? "" : " selected") + ">All anime · " + FB.poolCount + " series</option>";
    (FB.MODES || []).forEach(function (m) {
      out += '<option value="' + esc(m.series) + '"' + (m.series === state.series ? " selected" : "") + ">" +
        esc(m.series) + " only · " + m.count + " fighters</option>";
    });
    return out;
  }

  function modeNote() {
    if (!state.series) {
      return "All anime — the full " + FB.poolCount + "-series pool. Every champion is eligible.";
    }
    var m = findMode(state.series);
    return esc(state.series) + " only — " + (m ? m.count : 0) + " fighters. Both seats draft from this pool.";
  }

  function paintModeUI() {
    var note = $("#mp-mode-note");
    if (note) note.innerHTML = modeNote();
    var create = $("#mp-create-mode");
    if (create) create.textContent = modeLabel(state.series);
    var queue = $("#mp-queue-mode");
    if (queue) queue.textContent = modeLabel(state.series);
  }

  /* ── entry ───────────────────────────────────────────────────────────── */

  function renderEntry() {
    stopTimer();
    state.mode = "entry";
    state.view = null;
    var root = $("#live-root");
    if (!root) return;

    var prefill = "";
    try {
      var params = new URLSearchParams(location.search);
      prefill = (params.get("room") || "").toUpperCase().slice(0, 4);
    } catch (e) { prefill = ""; }

    var disabled = state.online === false ? " disabled" : "";

    root.innerHTML =
      '<section class="panel mp-lobby" aria-labelledby="mp-lobby-title">' +
        '<div class="panel-head"><span class="panel-no">A</span><h2 id="mp-lobby-title">Host the room</h2><span class="panel-meta">Mode locks on open</span></div>' +
        '<div class="live-card-body mp-setup">' +
          '<div class="field mp-name-field">' +
            '<label for="mp-handle">Your handle</label>' +
            '<input id="mp-handle" type="text" maxlength="18" autocomplete="off" value="' + esc(handle()) + '" placeholder="PLAYER 01">' +
          "</div>" +
          '<div class="field mp-mode-field">' +
            '<label for="mp-mode">Draft pool</label>' +
            '<select id="mp-mode">' + modeOptions() + "</select>" +
            '<p class="mp-mode-note" id="mp-mode-note">' + modeNote() + "</p>" +
          "</div>" +
          '<span class="server-pill' + (state.online === false ? " is-off" : "") + '" id="mp-status">' +
            (state.online === false ? "RELAY OFFLINE" : state.online ? "RELAY ONLINE" : "CHECKING RELAY") +
          "</span>" +
        "</div>" +
      "</section>" +
      '<div class="live-entry-grid">' +
        '<section class="panel live-card">' +
          '<div class="panel-head"><span class="panel-no">B</span><h2>Open a room</h2><span class="panel-meta">Private</span></div>' +
          '<div class="live-card-body">' +
            '<p class="mode-target"><span>Mode</span><b id="mp-create-mode">' + esc(modeLabel(state.series)) + "</b></p>" +
            '<p class="micro">A four-character code and two seats. The host picks the pool; a joiner cannot change it.</p>' +
            '<button class="btn btn-primary btn-block" type="button" data-mp-action="create" data-needs-relay' + disabled + ">Create room</button>" +
          "</div>" +
        "</section>" +
        '<section class="panel live-card">' +
          '<div class="panel-head"><span class="panel-no">C</span><h2>Join with a code</h2><span class="panel-meta">Host mode</span></div>' +
          '<div class="live-card-body">' +
            '<form data-mp="join">' +
              '<div class="field">' +
                '<label for="mp-code">Room code</label>' +
                '<input class="code-input" id="mp-code" name="code" maxlength="4" autocomplete="off" spellcheck="false" value="' + esc(prefill) + '" placeholder="ABCD">' +
              "</div>" +
              '<p class="micro" style="margin:8px 0 0">You draft in <b>the host\'s mode</b> — the code carries the pool.</p>' +
              '<button class="btn btn-block" type="submit" data-needs-relay style="margin-top:10px"' + disabled + ">Join room</button>" +
            "</form>" +
          "</div>" +
        "</section>" +
        '<section class="panel live-card">' +
          '<div class="panel-head"><span class="panel-no">D</span><h2>Public queue</h2><span class="panel-meta">Same mode</span></div>' +
          '<div class="live-card-body">' +
            '<p class="mode-target"><span>Queueing</span><b id="mp-queue-mode">' + esc(modeLabel(state.series)) + "</b></p>" +
            '<p class="micro">Pairs only with a player waiting in the same pool. Five blind slots, one reroll, one bout.</p>' +
            '<button class="btn btn-block" type="button" data-mp-action="queue" data-needs-relay' + disabled + ">Find a match</button>" +
          "</div>" +
        "</section>" +
      "</div>" +
      (state.error ? '<p class="mp-error" style="margin-top:12px">' + esc(state.error) + "</p>" : "") +
      '<p class="mp-note" style="margin-top:12px">Run <b>node server.js</b> in this folder. Same machine: <b>127.0.0.1:8123</b>; a friend on your LAN uses the address the relay prints. Host modes cover the featured series rosters plus <b>All anime</b>. Nothing leaves the network.</p>';

    applyOnline(state.online);
    var code = $("#mp-code");
    if (code && prefill) code.focus();
  }

  /* ── create / join / queue ───────────────────────────────────────────── */

  function enterRoom(payload) {
    stopTimer();
    state.mode = "room";
    state.error = "";
    state.room = { code: payload.code, playerId: payload.playerId, token: payload.token };
    state.view = payload.view || null;
    if (state.view && state.view.mode) {
      state.series = state.view.mode.series || "";
      saveMode();
    }
    saveRoom();
    buildRoom();
    if (!state.view) resumeRoom();
    startRoomPoll();
  }

  function createRoom() {
    if (state.online === false || state.loading) return;
    state.loading = true;
    state.error = "";
    api("/api/rooms", { method: "POST", body: { name: handle(), series: state.series } })
      .then(function (payload) { state.loading = false; enterRoom(payload); })
      .catch(function (err) {
        state.loading = false;
        state.error = "Could not open a room. " + err.message + ".";
        renderEntry();
      });
  }

  function joinRoom(code) {
    code = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
    if (code.length !== 4) {
      state.error = "A room code is four characters.";
      renderEntry();
      return;
    }
    if (state.online === false || state.loading) return;
    state.loading = true;
    state.error = "";
    api("/api/rooms/" + encodeURIComponent(code) + "/join", { method: "POST", body: { name: handle() } })
      .then(function (payload) { state.loading = false; enterRoom(payload); })
      .catch(function (err) {
        state.loading = false;
        state.error = err.status === 404 ? "That room no longer exists." : err.status === 409 ? "That room is already full." : "Could not join. " + err.message + ".";
        renderEntry();
        var input = $("#mp-code");
        if (input) { input.value = code; input.focus(); }
      });
  }

  function queueUp() {
    if (state.online === false || state.loading) return;
    state.loading = true;
    state.error = "";
    api("/api/queue", { method: "POST", body: { name: handle(), series: state.series } })
      .then(function (payload) {
        state.loading = false;
        if (payload.status === "matched") {
          enterRoom(payload);
          return;
        }
        state.mode = "queue";
        state.ticket = payload.ticket;
        state.queueMode = payload.mode || null;
        renderQueue();
        pollQueue();
      })
      .catch(function (err) {
        state.loading = false;
        state.error = "Queue unavailable. " + err.message + ".";
        renderEntry();
      });
  }

  function pollQueue() {
    stopTimer();
    timer = setTimeout(function () {
      if (state.mode !== "queue" || !state.ticket) return;
      api("/api/queue/" + encodeURIComponent(state.ticket))
        .then(function (payload) {
          if (payload.status === "matched") {
            state.ticket = null;
            enterRoom(payload);
            return;
          }
          pollQueue();
        })
        .catch(function (err) {
          state.ticket = null;
          state.mode = "entry";
          state.error = err.status === 404 ? "The queue ticket expired. Try again." : "Lost the queue. " + err.message + ".";
          renderEntry();
        });
    }, 1300);
  }

  function cancelQueue() {
    var ticket = state.ticket;
    state.ticket = null;
    stopTimer();
    if (ticket) api("/api/queue/" + encodeURIComponent(ticket), { method: "DELETE" }).catch(function () { /* best effort */ });
    state.mode = "entry";
    renderEntry();
    probe();
  }

  function renderQueue() {
    var root = $("#live-root");
    if (!root) return;
    var mode = state.queueMode || { label: modeLabel(state.series), count: modeCount(state.series) };
    root.innerHTML =
      '<div class="queue-view">' +
        '<div class="queue-spinner" aria-hidden="true"></div>' +
        "<h2>Searching · " + esc(mode.label) + "</h2>" +
        '<p class="micro">Waiting for a second player queueing <b>' + esc(mode.label) + "</b> · " + (mode.count || modeCount(state.series)) + " fighters in the pool.</p>" +
        '<span class="live-tag live-dot-tag">In queue · ' + esc(handle()) + "</span>" +
        '<button class="btn" type="button" data-mp-action="cancel-queue">Leave queue</button>' +
      "</div>" +
      (state.error ? '<p class="mp-error" style="margin-top:12px">' + esc(state.error) + "</p>" : "");
  }

  /* ── room shell ──────────────────────────────────────────────────────── */

  function buildRoom() {
    var root = $("#live-root");
    if (!root || !state.room) return;
    root.innerHTML =
      '<div id="room-head"></div>' +
      '<div class="live-rivals" id="room-players"></div>' +
      '<div class="builder live-builder" id="live-board">' +
        '<section class="panel draft-panel" aria-labelledby="live-board-title">' +
          '<div class="panel-head">' +
            '<span class="panel-no">A</span>' +
            '<h2 id="live-board-title">The board</h2>' +
            '<span class="panel-meta" id="live-stage-meta">Awaiting pull</span>' +
          "</div>" +
          '<div class="stage" id="live-stage"></div>' +
          '<div class="stage-foot">' +
            '<span class="dist-title" id="live-mode-note">LIVE ROOM</span>' +
            '<div class="keyhints"><span><kbd>R</kbd> Roll</span><span><kbd>W</kbd> Reroll</span><span><kbd>1</kbd>–<kbd>5</kbd> File</span></div>' +
          "</div>" +
        "</section>" +
        '<section class="panel deck-panel" aria-labelledby="live-deck-title">' +
          '<div class="panel-head">' +
            '<span class="panel-no">B</span>' +
            '<h2 id="live-deck-title">Your core</h2>' +
            '<span class="panel-meta" id="live-count">00 / 05 filed</span>' +
          "</div>" +
          '<div class="slot-list" id="live-deck"></div>' +
          '<div class="total-bar"><span>Output total</span><b id="live-total">000</b></div>' +
        "</section>" +
      "</div>" +
      '<div class="room-result" id="room-result"></div>' +
      '<div id="room-error"></div>';

    state.stageSig = "";
    state.deckSig = "";
    state.resultSig = "";
    state.renderedOfferId = null;
    state.lastLocked = -1;
    renderRoomView();
  }

  function roomStateLabel(view) {
    if (!view) return "CONNECTING";
    if (view.status === "result") return "RESULT";
    if (view.players.length < 2) return "WAITING";
    return "DRAFTING";
  }

  function headMarkup(view) {
    var mode = view && view.mode ? view.mode : { label: modeLabel(state.series), count: modeCount(state.series) };
    var word = roomStateLabel(view);
    var sub = !view ? "Resuming the room…"
      : view.status === "result" ? "Both cores sealed · the relay settled the bout."
      : view.players.length < 2 ? "Share the code — one seat open."
      : (view.players[view.you] && view.players[view.you].sealed) ? "Your core is sealed. Waiting for the other corner."
      : "Server-dealt rolls. Peaks stay sealed.";

    return '<div class="room-head">' +
      '<div class="room-code">' +
        "<small>Room code</small>" +
        "<b>" + esc(state.room.code) + "</b>" +
        '<div class="code-copy">' +
          '<button class="icon-btn" type="button" data-mp-action="copy-code" title="Copy the room code" aria-label="Copy the room code">⧉</button>' +
          '<button class="icon-btn" type="button" data-mp-action="copy-link" title="Copy an invite link" aria-label="Copy an invite link">↗</button>' +
          '<span class="mp-note">' + (state.notice ? esc(state.notice) : "Invite one friend") + "</span>" +
        "</div>" +
      "</div>" +
      '<div class="room-head-mid">' +
        '<span class="room-mode">MODE · ' + esc(mode.label) + "</span>" +
        '<span class="mp-note">' + (mode.count || 0) + " fighters · " + word + " · " + sub + "</span>" +
      "</div>" +
      '<div class="room-head-actions">' +
        '<button class="btn btn-sm" type="button" data-mp-action="leave">Leave room</button>' +
      "</div>" +
    "</div>";
  }

  function rivalHTML(player, isYou, code) {
    if (!player) {
      return '<section class="live-rival is-open">' +
        '<div class="live-rival-top"><span class="live-rival-tag">Open seat</span><span class="ready-light">WAITING</span></div>' +
        '<span class="micro">Share code <b>' + esc(code) + "</b> — the room holds the empty corner.</span>" +
      "</section>";
    }
    var filed = Math.max(0, Math.min(5, player.slotsFiled || 0));
    return '<section class="live-rival' + (isYou ? " is-you" : "") + '">' +
      '<div class="live-rival-top">' +
        '<span class="live-rival-tag">' + (isYou ? "Your corner" : "Opponent") + "</span>" +
        '<span class="live-rival-name">' + esc(player.name) + "</span>" +
        '<span class="ready-light' + (player.sealed ? " is-ready" : "") + '">' + (player.sealed ? "SEALED" : filed + "/5 FILED") + "</span>" +
      "</div>" +
      '<div class="live-progress"><i style="width:' + Math.round(filed / 5 * 100) + '%"></i></div>' +
    "</section>";
  }

  function renderRoomView() {
    if (!state.room) return;
    var view = state.view;
    var head = $("#room-head");
    if (!head) return;

    head.innerHTML = headMarkup(view);
    var strip = $("#room-players");
    if (strip) {
      strip.innerHTML = view
        ? rivalHTML(view.players[view.you], true, view.code) + rivalHTML(view.players[1 - view.you], false, view.code)
        : rivalHTML(null, true, state.room.code) + rivalHTML(null, false, state.room.code);
    }

    var err = $("#room-error");
    if (err) err.innerHTML = state.error ? '<p class="mp-error">' + esc(state.error) + "</p>" : "";

    var board = $("#live-board");
    var result = $("#room-result");
    if (!board || !result) return;

    if (!view) {
      board.hidden = false;
      result.innerHTML = "";
      var emptyStage = $("#live-stage");
      if (emptyStage) emptyStage.innerHTML = '<div class="live-intro"><div class="live-intro-count"><span class="kicker">Room</span><b class="live-pool-num">' + esc(state.room.code) + '</b><span class="micro">connecting</span></div><div class="live-intro-body"><span class="kicker">Relay</span><h3>Reading the room.</h3><p class="micro">The seat is saved in this tab. Nothing to redraw.</p></div></div>';
      return;
    }

    var you = view.players[view.you] || null;
    var opp = view.players[1 - view.you] || null;

    if (view.result) {
      board.hidden = true;
      if (state.resultSig !== String(view.result.at)) {
        state.resultSig = String(view.result.at);
        result.innerHTML = resultHTML(view);
        FB.ui.paintBars(result);
      }
      return;
    }

    board.hidden = false;
    result.innerHTML = "";
    state.resultSig = "";

    if (!you) return;

    /* deck */
    var deck = you.deck || [];
    var deckSig = deck.map(function (c) { return c ? c.id : "-"; }).join("|") + "~" + (you.sealed ? 1 : 0) + "~" + state.lastLocked;
    if (deckSig !== state.deckSig) {
      state.deckSig = deckSig;
      var deckEl = $("#live-deck");
      if (deckEl) {
        deckEl.innerHTML = deck.map(function (c, i) {
          return FB.ui.slotMarkup(c || null, i, state.lastLocked === i);
        }).join("");
        FB.ui.hydratePortraits(deckEl);
      }
      state.lastLocked = -1;
    }

    var filed = deck.filter(Boolean).length;
    var count = $("#live-count");
    if (count) count.textContent = pad(filed) + " / 05 filed";
    var total = $("#live-total");
    if (total) total.textContent = pad3(FB.deckTotal(deck, null));

    var modeNote = $("#live-mode-note");
    if (modeNote) modeNote.textContent = "MODE · " + view.mode.label + " · " + view.poolCount + " FIGHTERS";

    /* stage is rebuilt only when visible state changes */
    var stageSig = [
      you.sealed ? 1 : 0,
      you.offer ? you.offer.id : "",
      you.rerolls,
      deck.map(function (c) { return c ? c.id : "-"; }).join("|"),
      view.updatedAt,
      state.loading ? 1 : 0,
      opp ? (opp.sealed ? 1 : 0) : -1,
      opp ? opp.slotsFiled : -1
    ].join("~");

    if (stageSig !== state.stageSig) {
      state.stageSig = stageSig;
      renderStage(view, you, opp);
    }
  }

  function resultHTML(view) {
    var res = view.result;
    var youAt = view.you;
    var aName = (res.aName || "RED") + (youAt === 0 ? " (you)" : "");
    var bName = (res.bName || "BLUE") + (youAt === 1 ? " (you)" : "");
    return FB.ui.deckDuelTable(res, {
      labelA: "Red",
      labelB: "Blue",
      aName: aName,
      bName: bName,
      mode: view.mode.label,
      actions: '<button class="btn btn-primary" type="button" data-mp-action="rematch">Rematch</button>' +
        '<button class="btn" type="button" data-mp-action="leave">Leave room</button>'
    });
  }

  /* ── stage ───────────────────────────────────────────────────────────── */

  function renderStage(view, you, opp) {
    var el = $("#live-stage");
    var meta = $("#live-stage-meta");
    if (!el) return;

    if (you.sealed) {
      el.innerHTML = sealedHTML(view, you, opp);
      if (meta) meta.textContent = "core sealed";
      state.renderedOfferId = null;
      FB.ui.hydratePortraits(el);
      return;
    }

    if (you.offer) {
      var isNew = state.renderedOfferId !== you.offer.id;
      el.innerHTML = offerHTML(you.offer, you, isNew);
      state.renderedOfferId = you.offer.id;
      if (meta) meta.textContent = "draw · " + FB.ui.rarityName(you.offer.rarity).toLowerCase();
      FB.ui.hydratePortraits(el);
      return;
    }

    el.innerHTML = introHTML(view, you);
    state.renderedOfferId = null;
    if (meta) meta.textContent = "pool · " + view.poolCount;
  }

  function introHTML(view, you) {
    var waiting = view.players.length < 2;
    var disabled = state.loading ? " disabled" : "";
    return '<div class="live-intro">' +
      '<div class="live-intro-count">' +
        '<span class="kicker">' + esc(view.mode.label) + "</span>" +
        '<b class="live-pool-num">' + view.poolCount + "</b>" +
        '<span class="micro">fighters in pool</span>' +
      "</div>" +
      '<div class="live-intro-body">' +
        '<span class="kicker">Live draft · 05 blind slots</span>' +
        "<h3>Roll five.<br>File them <em>blind.</em></h3>" +
        '<p class="micro">' + (waiting
          ? "Waiting for a challenger — you can start drafting now. Both cores stay hidden until both seats lock five."
          : "Server-dealt pulls from the host's pool. Both cores stay sealed until you have filed all five.") + "</p>" +
        '<ul class="rule-list">' +
          "<li>Server deals · <b>one</b> free reroll each</li>" +
          "<li>Peaks stay <b>sealed</b> until both cores lock</li>" +
          "<li>Perfect file stamps <b>*</b> · off-meta collapses to <b>E</b></li>" +
          "<li>Total output decides the bout</li>" +
        "</ul>" +
        '<button class="btn btn-primary btn-block" type="button" data-live-action="roll"' + disabled + ">" +
          (state.loading ? "Dealing…" : 'Roll character <kbd>R</kbd>') +
        "</button>" +
      "</div>" +
    "</div>";
  }

  function offerHTML(offer, you, isNew) {
    var char = {
      id: offer.id,
      name: offer.name,
      series: offer.series,
      rarity: offer.rarity,
      seed: offer.seed || ((FB.modeCharacterById(offer.id) || {}).seed) || offer.id
    };
    var canon = FB.STATS.map(function (stat) {
      return '<span><i aria-hidden="true">' + stat.icon + "</i><b></b></span>";
    }).join("");

    var assign = FB.STATS.map(function (stat, i) {
      var taken = !!(you.deck && you.deck[i]);
      return '<button type="button" class="assign' + (taken ? " is-locked" : "") + '" data-live-action="assign" data-slot="' + i + '"' +
        (taken || state.loading ? " disabled" : "") +
        ' aria-label="Lock ' + esc(offer.name) + " into " + esc(stat.label) + ' slot.">' +
        '<span class="assign-icon" aria-hidden="true">' + stat.icon + "</span>" +
        '<span class="assign-main">' +
          '<span class="assign-label">' + stat.label + "</span>" +
          '<span class="assign-sub">' + (taken ? "slot occupied" : "slot " + pad(i + 1)) + "</span>" +
        "</span>" +
        '<span class="assign-mark" aria-hidden="true">→</span>' +
      "</button>";
    }).join("");

    return '<div class="offer">' +
      '<div class="card' + (isNew ? " is-new" : "") + (offer.rarity === 7 ? " is-secret" : "") + '" style="' + FB.ui.rarityStyle(offer.rarity) + '">' +
        '<div class="card-media">' +
          FB.ui.portraitHTML(char, "portrait-card", true) +
          '<span class="card-rar">' + FB.ui.rarityName(offer.rarity) + "</span>" +
          '<span class="card-seal">canon sealed</span>' +
        "</div>" +
        '<div class="card-body">' +
          '<div class="card-title">' +
            '<div class="card-name">' + esc(offer.name) + "</div>" +
            '<div class="card-series">' + esc(offer.series) + " · no." + pad3(offer.id) + "</div>" +
          "</div>" +
          '<div class="canon" role="img" aria-label="Canonical stat readout sealed until placement">' +
            '<div class="canon-head"><span>Canon readout</span><span>sealed</span></div>' +
            '<div class="canon-grid">' + canon + "</div>" +
          "</div>" +
          '<div class="card-lines">' +
            "<span><b>SIG</b> " + esc(offer.signature || "unrecorded") + "</span>" +
            "<span><b>ARCH</b> " + esc(offer.archLabel || "—") + "</span>" +
            "<span><b>TRAIT</b> " + esc(offer.trait || "—") + (offer.traps ? " · " + offer.traps + " trap" + (offer.traps > 1 ? "s" : "") : " · no traps") + "</span>" +
          "</div>" +
        "</div>" +
      "</div>" +
      '<div class="offer-side">' +
        '<div class="assign-head"><b>Assign to slot</b><span>blind placement</span></div>' +
        '<div class="assign-list">' + assign + "</div>" +
        '<div class="offer-actions">' +
          '<button class="btn" type="button" data-live-action="reroll"' + (!you.rerolls || state.loading ? " disabled" : "") + ">Reroll <span class=\"count\">" + (you.rerolls || 0) + " left</span></button>" +
        "</div>" +
        '<p class="micro offer-note">The relay never sends the peak. Read the name, series, signature and archetype, then commit. A perfect file appends <strong>*</strong>; a disjoint one collapses to <strong>E</strong>.</p>' +
      "</div>" +
    "</div>";
  }

  function sealedHTML(view, you, opp) {
    var scores = FB.slotScores(you.deck, null);
    var total = scores.reduce(function (sum, s) { return sum + (s ? s.value : 0); }, 0);
    var peaks = scores.filter(function (s) { return s && s.star; }).length;
    var oppLine = opp
      ? (opp.sealed ? "The other core is sealed. The relay is settling the bout." : "Waiting for " + esc(opp.name) + " — " + opp.slotsFiled + "/5 filed.")
      : "Waiting for a challenger. Share code " + esc(view.code) + ".";

    return '<div class="sealed">' +
      '<div class="seal-mark" aria-hidden="true">VS</div>' +
      '<h3 class="seal-title">Core sealed</h3>' +
      '<p class="micro">Five slots locked. Your canon read-out is in the books and stays hidden from the other seat until both cores seal.</p>' +
      '<div class="seal-stats">' +
        '<div class="seal-stat user"><small>Output</small><b>' + total + "</b></div>" +
        '<div class="seal-stat ai"><small>Peaks</small><b>' + peaks + " / 5</b></div>" +
      "</div>" +
      '<p class="micro">' + oppLine + "</p>" +
      '<div class="seal-actions"><button class="btn" type="button" data-mp-action="leave">Leave room</button></div>' +
    "</div>";
  }

  /* ── actions ─────────────────────────────────────────────────────────── */

  function canAct() {
    return !!(state.room && state.view && state.mode === "room" && !state.loading && state.view.status !== "result");
  }

  function act(path, body, onDone) {
    if (!canAct()) return;
    state.loading = true;
    state.error = "";
    renderRoomView();
    return api("/api/rooms/" + encodeURIComponent(state.room.code) + path, {
      method: "POST",
      body: Object.assign({ playerId: state.room.playerId, token: state.room.token }, body || {})
    }).then(function (view) {
      state.loading = false;
      if (onDone) onDone();
      applyView(view);
      startRoomPoll();
    }).catch(function (err) {
      state.loading = false;
      state.error = err.message ? "Relay: " + err.message + "." : "The relay refused that move.";
      renderRoomView();
    });
  }

  function doRoll() {
    if (!canAct()) return;
    var you = state.view.players[state.view.you];
    if (!you || you.offer || you.sealed) return;
    act("/roll");
  }

  function doReroll() {
    if (!canAct()) return;
    var you = state.view.players[state.view.you];
    if (!you || !you.offer || !you.rerolls) return;
    act("/reroll");
  }

  function doAssign(slot) {
    if (!canAct()) return;
    var you = state.view.players[state.view.you];
    if (!you || !you.offer || (you.deck && you.deck[slot])) return;
    act("/assign", { slot: slot }, function () { state.lastLocked = slot; });
  }

  function rematch() {
    if (!state.room) return;
    state.loading = true;
    state.error = "";
    api("/api/rooms/" + encodeURIComponent(state.room.code) + "/rematch", {
      method: "POST",
      body: { playerId: state.room.playerId, token: state.room.token }
    }).then(function (view) {
      state.loading = false;
      state.stageSig = "";
      state.deckSig = "";
      state.resultSig = "";
      state.renderedOfferId = null;
      state.lastLocked = -1;
      applyView(view);
      startRoomPoll();
    }).catch(function (err) {
      state.loading = false;
      state.error = "Could not reset the room. " + err.message + ".";
      renderRoomView();
    });
  }

  function startRoomPoll() {
    stopTimer();
    timer = setTimeout(function poll() {
      if (state.mode !== "room" || !state.room) return;
      api("/api/rooms/" + encodeURIComponent(state.room.code) +
        "?playerId=" + encodeURIComponent(state.room.playerId) +
        "&token=" + encodeURIComponent(state.room.token))
        .then(function (view) {
          applyView(view);
          timer = setTimeout(poll, 1300);
        })
        .catch(function (err) {
          if (err.status === 404 || err.status === 403) {
            state.room = null;
            state.view = null;
            clearRoom();
            state.mode = "entry";
            state.error = "The room was closed. Open a new one.";
            renderEntry();
            return;
          }
          timer = setTimeout(poll, 2600);
        });
    }, 1200);
  }

  function resumeRoom() {
    if (!state.room) return;
    api("/api/rooms/" + encodeURIComponent(state.room.code) +
      "?playerId=" + encodeURIComponent(state.room.playerId) +
      "&token=" + encodeURIComponent(state.room.token))
      .then(function (view) {
        if (view && view.mode) {
          state.series = view.mode.series || "";
          saveMode();
        }
        applyView(view);
        startRoomPoll();
      })
      .catch(function () {
        state.room = null;
        state.view = null;
        clearRoom();
        state.mode = "entry";
        state.error = "That room has expired. Open a new one.";
        renderEntry();
      });
  }

  function leaveRoom() {
    var room = state.room;
    stopTimer();
    state.room = null;
    state.view = null;
    state.mode = "entry";
    state.error = "";
    state.notice = "";
    clearRoom();
    if (room) {
      api("/api/rooms/" + encodeURIComponent(room.code) + "/leave", {
        method: "POST",
        body: { playerId: room.playerId, token: room.token }
      }).catch(function () { /* best effort */ });
    }
    renderEntry();
    probe();
  }

  /* ── keyboard ────────────────────────────────────────────────────────── */

  function handleKey(key) {
    if (state.mode !== "room" || !state.view || state.view.status === "result") return false;
    var you = state.view.players[state.view.you];
    if (!you) return false;
    var k = String(key || "").toLowerCase();
    if (k === "r" && !you.offer && !you.sealed) { doRoll(); return true; }
    if (k === "w" && you.offer && you.rerolls) { doReroll(); return true; }
    if (/^[1-5]$/.test(k) && you.offer) { doAssign(Number(k) - 1); return true; }
    return false;
  }

  /* ── clipboard / boot ────────────────────────────────────────────────── */

  function flash(message) {
    state.notice = message;
    renderRoomView();
    setTimeout(function () {
      if (state.notice === message) { state.notice = ""; renderRoomView(); }
    }, 2200);
  }

  function copy(text, message) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { flash(message); }, function () { flash("Copy unavailable — select it manually."); });
    } else {
      flash("Copy unavailable — select it manually.");
    }
  }

  function enter() {
    if (state.mode === "room" && state.room) {
      if (!$("#room-head")) buildRoom();
      if (!state.view) resumeRoom();
      else renderRoomView();
      applyOnline(state.online);
      return;
    }
    if (state.mode === "queue" && state.ticket) {
      renderQueue();
      return;
    }
    renderEntry();
    probe();
  }

  function init() {
    var invite = "";
    try { invite = new URLSearchParams(location.search).get("room") || ""; } catch (e) { invite = ""; }
    state.room = invite ? null : loadRoom();
    if (invite) clearRoom();
    if (state.room) state.mode = "room";
    state.series = loadMode();
    state.online = null;
    renderEntry();
    probe();

    var root = $("#live-root");
    if (!root) return;

    root.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-mp-action]");
      if (btn) {
        var action = btn.getAttribute("data-mp-action");
        if (action === "create") createRoom();
        else if (action === "queue") queueUp();
        else if (action === "cancel-queue") cancelQueue();
        else if (action === "leave") leaveRoom();
        else if (action === "rematch") rematch();
        else if (action === "copy-code") copy(state.room ? state.room.code : "", "Code copied.");
        else if (action === "copy-link") {
          if (!state.room) return;
          var link = location.origin + location.pathname + "?room=" + state.room.code;
          copy(link, "Invite link copied.");
        }
        return;
      }

      var live = e.target.closest("[data-live-action]");
      if (!live) return;
      var move = live.getAttribute("data-live-action");
      if (move === "roll") doRoll();
      else if (move === "reroll") doReroll();
      else if (move === "assign") doAssign(Number(live.getAttribute("data-slot")));
    });

    root.addEventListener("submit", function (e) {
      var form = e.target.closest("form[data-mp='join']");
      if (!form) return;
      e.preventDefault();
      var input = form.querySelector("input[name='code']");
      joinRoom(input ? input.value : "");
    });

    root.addEventListener("input", function (e) {
      if (e.target && e.target.id === "mp-handle") setHandle(e.target.value);
    });

    root.addEventListener("change", function (e) {
      if (!e.target || e.target.id !== "mp-mode") return;
      state.series = e.target.value || "";
      saveMode();
      paintModeUI();
    });

    root.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" || !e.target || e.target.name !== "code") return;
      e.preventDefault();
      joinRoom(e.target.value);
    });
  }

  FB.multiplayer = {
    init: init,
    enter: enter,
    createRoom: createRoom,
    joinRoom: joinRoom,
    queueUp: queueUp,
    leaveRoom: leaveRoom,
    handleKey: handleKey,
    state: state
  };
})(window.FB);
