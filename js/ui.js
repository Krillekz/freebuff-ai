/* FreeBuff AI — interface controller
   Builds the builder, the deck rater and the single-fighter duel arena. */

(function (FB) {
  "use strict";

  var S = FB.STATS;
  var KEYS = FB.KEYS;
  var T = FB.TIERS;
  var R = FB.RARITIES;

  var state = {
    tab: "builder",
    scope: null,          // null = random over the whole roster, else a series name
    scopeMode: "random",  // random | series
    deck: [null, null, null, null, null],
    offer: null,
    offerSerial: 0,
    rerolls: 1,
    awake: false,
    sealed: false,
    session: 1,
    lastLocked: -1,
    renderedOffer: -1,
    pulls: [],
    duel: { player: null, ai: null, result: null }
  };

  var duelPicker = null;
  var sigilSeq = 0;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function esc(v) {
    return String(v).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function pad(n, len) { return String(n).padStart(len || 2, "0"); }
  function pad3(n) { return String(n).padStart(3, "0"); }

  function rarityInk(i) { return i === 7 ? "#dbe2ea" : R[i].color; }
  function rarityStyle(i) { return "--rar-ink:" + rarityInk(i) + ";--rar:" + R[i].color + ";"; }
  function rarityName(i) { return R[i] ? R[i].name : ""; }

  function mods() {
    return { awake: state.awake, passive: state.awake ? FB.dominantStat(state.deck) : null };
  }

  function filled() { return state.deck.filter(Boolean).length; }

  /* ── portraits ─────────────────────────────────────────────────────── */

  function portraitHTML(char, cls, priority, defer) {
    var entry = FB.portraits ? FB.portraits.get(char.id) : null;
    var src = entry && entry.url ? entry.url : "";
    var retry = !!(entry && entry.fail);
    if (FB.portraits && !defer) FB.portraits.request(char, priority);
    return '<div class="portrait ' + cls + (retry ? " is-retry" : "") + '" data-portrait-id="' + char.id + '" style="' + rarityStyle(char.rarity) + '"' +
      (retry ? ' title="Portrait unavailable — click to retry"' : "") + ">" +
      '<div class="portrait-crest" aria-hidden="true">' + sigil(char) + '</div>' +
      '<img class="portrait-img" alt="" decoding="async"' + (src ? ' src="' + esc(src) + '"' : "") + " />" +
      '<span class="portrait-screen" aria-hidden="true"></span>' +
    "</div>";
  }

  function hydratePortraits(root) {
    $$(".portrait-img", root || document).forEach(function (img) {
      var box = img.parentElement;
      if (!box) return;
      img.onload = function () { box.classList.add("is-loaded"); };
      img.onerror = function () { box.classList.add("is-failed"); };
      if (img.getAttribute("src") && img.complete && img.naturalWidth) box.classList.add("is-loaded");
    });
  }

  function paintPortraits() {
    $$(".portrait").forEach(function (box) {
      var entry = FB.portraits && FB.portraits.get(Number(box.getAttribute("data-portrait-id")));
      if (!entry) return;
      if (entry.fail) {
        box.classList.add("is-retry");
        box.title = "Portrait unavailable — click to retry";
        return;
      }
      box.classList.remove("is-retry");
      box.removeAttribute("title");
      if (!entry.url) return;
      var img = box.querySelector(".portrait-img");
      if (!img) return;
      if (img.getAttribute("src") !== entry.url) {
        box.classList.remove("is-failed");
        img.src = entry.url;
      }
      img.onload = function () { box.classList.add("is-loaded"); };
      img.onerror = function () { box.classList.add("is-failed"); };
      if (img.complete && img.naturalWidth) box.classList.add("is-loaded");
    });
  }

  /* ── printed crest (fallback art) ──────────────────────────────────── */

  function sigil(char) {
    var rnd = FB.rng(char.seed);
    var uid = "sg" + char.id + "-" + (++sigilSeq);
    var col = rarityInk(char.rarity);
    var shards = "";
    for (var i = 0; i < 4; i++) {
      var cx = 38 + rnd() * 46;
      var cy = 46 + rnd() * 62;
      var scale = 13 + rnd() * 25;
      var n = 3 + Math.floor(rnd() * 2);
      var pts = [];
      for (var k = 0; k < n; k++) {
        var a = (k / n) * Math.PI * 2 + rnd() * 0.9;
        var rr = scale * (0.55 + rnd() * 0.9);
        pts.push((cx + Math.cos(a) * rr).toFixed(1) + "," + (cy + Math.sin(a) * rr).toFixed(1));
      }
      shards += '<polygon points="' + pts.join(" ") + '" fill="' + col + '" opacity="' + (0.05 + rnd() * 0.09).toFixed(2) + '"/>';
    }

    var words = char.name.replace(/[^A-Za-z'\- ]/g, " ").split(/\s+/).filter(Boolean);
    var initials = ((words[0] || "?")[0] + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();

    var ticks = "";
    for (var t = 0; t < 9; t++) {
      ticks += '<line x1="' + (26 + t * 8) + '" y1="137" x2="' + (26 + t * 8) + '" y2="' + (t % 3 === 0 ? 143 : 140) + '" stroke="' + col + '" stroke-opacity=".35"/>';
    }

    return '<svg viewBox="0 0 120 148" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">' +
      '<defs>' +
        '<linearGradient id="' + uid + 'g" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="' + col + '" stop-opacity=".2"/>' +
          '<stop offset="1" stop-color="' + col + '" stop-opacity="0"/>' +
        "</linearGradient>" +
        '<pattern id="' + uid + 'd" width="5" height="5" patternUnits="userSpaceOnUse">' +
          '<circle cx="1.1" cy="1.1" r=".85" fill="' + col + '" fill-opacity=".3"/>' +
        "</pattern>" +
        '<clipPath id="' + uid + 'c"><polygon points="0,120 120,74 120,148 0,148"/></clipPath>' +
      "</defs>" +
      '<rect width="120" height="148" fill="#07090b"/>' +
      '<rect width="120" height="148" fill="url(#' + uid + 'g)"/>' +
      shards +
      '<rect x="0" y="72" width="120" height="76" fill="url(#' + uid + 'd)" clip-path="url(#' + uid + 'c)"/>' +
      '<g fill="none" stroke="' + col + '" stroke-opacity=".24">' +
        '<circle cx="60" cy="70" r="31" stroke-dasharray="1 5"/>' +
        '<path d="M60 30v80M24 70h72" stroke-opacity=".12"/>' +
      "</g>" +
      '<path d="M60 36 82 58 60 80 38 58Z" fill="none" stroke="' + col + '" stroke-opacity=".34"/>' +
      '<text x="60" y="76" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="27" font-weight="600" letter-spacing="1" fill="#ffffff" fill-opacity=".16">' + esc(initials) + "</text>" +
      '<path d="M0 120h120" stroke="' + col + '" stroke-opacity=".2"/>' +
      ticks +
      '<rect x=".5" y=".5" width="119" height="147" fill="none" stroke="' + col + '" stroke-opacity=".14"/>' +
    "</svg>";
  }

  /* ── deck slots ─────────────────────────────────────────────────────── */

  function emptySlot(i) {
    var stat = S[i];
    return '<div class="slot is-empty">' +
      '<div class="slot-empty-icon" aria-hidden="true">' + stat.icon + "</div>" +
      '<div class="slot-empty-main">' +
        '<span class="slot-stat">' + stat.label + "</span>" +
        '<span class="slot-await">Awaiting lock</span>' +
      "</div>" +
      '<span class="slot-code">SLOT ' + pad(i + 1) + "</span>" +
    "</div>";
  }

  function filledSlot(char, i, m, flash) {
    var sc = FB.scoreSlot(char, KEYS[i], m);
    return '<div class="slot is-filled' + (flash ? " slot-just-locked" : "") + '" style="' + rarityStyle(char.rarity) + '">' +
      '<div class="slot-art">' + portraitHTML(char, "portrait-slot") + '<span class="slot-code">' + S[i].code + "</span></div>" +
      '<div class="slot-main">' +
        '<span class="slot-name">' + esc(char.name) + "</span>" +
        '<span class="slot-series">' + esc(char.series) + "</span>" +
      "</div>" +
      '<div class="slot-readout">' +
        '<span class="slot-tier"' + (sc.mismatch ? ' title="Off-meta placement: evaluates as E"' : "") + ">" +
          T[sc.rank].label + (sc.star ? '<span class="star">*</span>' : "") +
          (sc.mismatch ? '<span class="flag">\u2193</span>' : "") +
        "</span>" +
        '<span class="slot-rarity">' + rarityName(char.rarity) + "</span>" +
        '<span class="slot-power">' + sc.value + " pwr</span>" +
      "</div>" +
    "</div>";
  }

  function renderDeck() {
    var el = $("#deck-list");
    if (!el) return;
    var m = mods();
    var flash = state.lastLocked;
    state.lastLocked = -1;
    el.innerHTML = state.deck.map(function (c, i) {
      return c ? filledSlot(c, i, m, flash === i) : emptySlot(i);
    }).join("");
  }

  /* ── stage ───────────────────────────────────────────────────────────── */

  function dial() {
    var ticks = "";
    for (var i = 0; i < 60; i++) {
      var a = (i / 60) * Math.PI * 2 - Math.PI / 2;
      var long = i % 5 === 0;
      var r1 = long ? 88 : 91;
      var x1 = 120 + Math.cos(a) * r1, y1 = 120 + Math.sin(a) * r1;
      var x2 = 120 + Math.cos(a) * 96, y2 = 120 + Math.sin(a) * 96;
      ticks += '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" stroke="#eaf0f6" stroke-opacity="' + (long ? ".38" : ".16") + '"/>';
    }
    return '<div class="dial">' +
      '<svg viewBox="0 0 240 240" aria-hidden="true">' +
        '<circle cx="120" cy="120" r="104" fill="none" stroke="#ff5c45" stroke-opacity=".22"/>' +
        '<circle cx="120" cy="120" r="70" fill="none" stroke="#ff5c45" stroke-opacity=".12"/>' +
        '<g class="dial-spin">' +
          '<circle cx="120" cy="120" r="94" fill="none" stroke="#ff5c45" stroke-opacity=".85" stroke-width="2" stroke-dasharray="118 472" stroke-linecap="round" transform="rotate(-90 120 120)"/>' +
        "</g>" +
        '<g class="dial-spin-rev">' + ticks + "</g>" +
        '<path d="M120 24 216 120 120 216 24 120Z" fill="none" stroke="#ff5c45" stroke-opacity=".3"/>' +
        '<path d="M120 52 188 120 120 188 52 120Z" fill="none" stroke="#eaf0f6" stroke-opacity=".08"/>' +
      "</svg>" +
      '<div class="dial-core">' +
        '<span class="dial-num">' + activePool().length + "</span>" +
        '<span class="dial-cap">' + (state.scope ? "fighters in " + esc(state.scope) : "series in pool") + "</span>" +
      "</div>" +
    "</div>";
  }

  function introHTML() {
    return '<div class="stage-intro">' +
      dial() +
      '<div class="stage-side">' +
        '<span class="kicker">Slots ' + pad(filled()) + " / 05 — pull phase</span>" +
        '<h3>Roll five.<br>File them <em>blind.</em></h3>' +
        '<p class="micro">' + (state.scope
          ? "Every pull is an independent draw from " + esc(state.scope) + " only — " + activePool().length + " fighters on file."
          : "Every pull is an independent lookup across all 500 series. No pity, no guarantees, no reels.") + "</p>" +
        '<ul class="rule-list">' +
          "<li>Lock each card into <b>one</b> attribute slot</li>" +
          "<li>Canon peaks are <b>never</b> disclosed before the lock</li>" +
          "<li>Peak placement stamps <b>*</b> and multiplies output</li>" +
          "<li>Off-meta placements evaluate as <b>E</b></li>" +
          "<li><b>1</b> free reroll per session</li>" +
        "</ul>" +
        '<button class="btn btn-primary btn-block" type="button" data-action="roll">Roll character <kbd>R</kbd></button>' +
      "</div>" +
    "</div>";
  }

  function offerHTML() {
    var c = state.offer;
    var isNew = state.offerSerial !== state.renderedOffer;

    var canon = S.map(function (stat) {
      return "<span><i aria-hidden=\"true\">" + stat.icon + "</i><b></b></span>";
    }).join("");

    var assign = S.map(function (stat, i) {
      var taken = !!state.deck[i];
      return '<button type="button" class="assign' + (taken ? " is-locked" : "") + '"' +
        ' data-action="assign" data-slot="' + i + '"' + (taken ? " disabled" : "") +
        ' aria-label="Lock ' + esc(c.name) + " into " + esc(stat.label) + ' slot.">' +
        '<span class="assign-icon" aria-hidden="true">' + stat.icon + "</span>" +
        '<span class="assign-main">' +
          '<span class="assign-label">' + stat.label + "</span>" +
          '<span class="assign-sub">' + (taken ? "slot occupied" : "slot " + pad(i + 1)) + "</span>" +
        "</span>" +
        '<span class="assign-mark" aria-hidden="true">\u2192</span>' +
      "</button>";
    }).join("");

    return '<div class="offer">' +
      '<div class="card' + (isNew ? " is-new" : "") + (c.rarity === 7 ? " is-secret" : "") + '" style="' + rarityStyle(c.rarity) + '">' +
        '<div class="card-media">' +
          portraitHTML(c, "portrait-card", true) +
          '<span class="card-rar">' + rarityName(c.rarity) + "</span>" +
          '<span class="card-seal">canon sealed</span>' +
        "</div>" +
        '<div class="card-body">' +
          '<div class="card-title">' +
            '<div class="card-name">' + esc(c.name) + "</div>" +
            '<div class="card-series">' + esc(c.series) + " · no." + pad3(c.id) + "</div>" +
          "</div>" +
          '<div class="canon" role="img" aria-label="Canonical stat readout sealed until placement">' +
            '<div class="canon-head"><span>Canon readout</span><span>sealed</span></div>' +
            '<div class="canon-grid">' + canon + "</div>" +
          "</div>" +
          '<div class="card-lines">' +
            "<span><b>SIG</b> " + esc(c.signature || "unrecorded") + "</span>" +
            "<span><b>ARCH</b> " + esc(c.archLabel) + "</span>" +
            "<span><b>TRAIT</b> " + esc(c.trait) + (c.traps ? " · " + c.traps + " trap" + (c.traps > 1 ? "s" : "") : " · no traps") + "</span>" +
          "</div>" +
        "</div>" +
      "</div>" +
      '<div class="offer-side">' +
        '<div class="assign-head"><b>Assign to slot</b><span>blind placement</span></div>' +
        '<div class="assign-list">' + assign + "</div>" +
        '<div class="offer-actions">' +
          '<button class="btn" type="button" data-action="reroll"' + (state.rerolls ? "" : " disabled") + ">Reroll <span class=\"count\">" + state.rerolls + " left</span></button>" +
        "</div>" +
        '<p class="micro offer-note">The peak attribute stays sealed. Read the name, series, signature and archetype, then commit — a perfect fit appends <strong>*</strong> and multiplies output, a disjoint one collapses to <strong>E</strong>.</p>' +
      "</div>" +
    "</div>";
  }

  function sealedHTML() {
    var m = mods();
    var scores = FB.slotScores(state.deck, m);
    var peaks = scores.filter(function (s) { return s && s.star; }).length;
    var total = scores.reduce(function (sum, s) { return sum + (s ? s.value : 0); }, 0);
    var rating = FB.rateDeck(state.deck, m);
    return '<div class="sealed">' +
      '<div class="seal-mark" aria-hidden="true">VS</div>' +
      '<h3 class="seal-title">Deck sealed</h3>' +
      '<p class="micro">Five slots locked. The audit is instant — no turn order, no combat loop.</p>' +
      '<div class="seal-stats">' +
        '<div class="seal-stat user"><small>Output</small><b>' + total + "</b></div>" +
        '<div class="seal-stat ai"><small>Peaks</small><b>' + peaks + " / 5</b></div>" +
      "</div>" +
      '<p class="micro">Desk grade <strong>' + rating.grade + "</strong> · " + rating.gradeLine + "</p>" +
      '<div class="seal-actions">' +
        '<button class="btn btn-primary" type="button" data-action="to-rater">Rate the deck <span aria-hidden="true">\u2192</span></button>' +
        '<button class="btn" type="button" data-action="to-duel">Take it to 1v1</button>' +
        '<button class="btn" type="button" data-action="reset">New session</button>' +
      "</div>" +
    "</div>";
  }

  function renderStage() {
    var el = $("#stage");
    var meta = $("#stage-meta");
    if (!el) return;
    if (state.sealed) {
      el.innerHTML = sealedHTML();
      if (meta) meta.textContent = "deck sealed";
      state.renderedOffer = state.offerSerial;
      return;
    }
    if (state.offer) {
      el.innerHTML = offerHTML();
      if (meta) meta.textContent = "draw · " + rarityName(state.offer.rarity).toLowerCase();
      state.renderedOffer = state.offerSerial;
      return;
    }
    el.innerHTML = introHTML();
    if (meta) meta.textContent = "pure random";
  }

  /* ── session tape / odds strip / chrome ────────────────────────────── */

  function renderTape() {
    var list = $("#tape-list");
    var count = $("#tape-count");
    if (!list) return;
    var m = mods();
    if (count) count.textContent = pad(state.pulls.length) + (state.pulls.length === 1 ? " pull" : " pulls");
    if (!state.pulls.length) {
      list.innerHTML = '<span class="tape-empty">No draws yet — the tape logs every pull, reroll and lock this session.</span>';
      return;
    }
    list.innerHTML = state.pulls.map(function (p, i) {
      var score = p.slot == null ? null : FB.scoreSlot(p.char, KEYS[p.slot], m);
      var tail = p.rerolled ? "rerolled"
        : p.slot == null ? "open"
        : "\u2192 " + S[p.slot].label + " · " + T[score.rank].label + (score.star ? "*" : "");
      return '<span class="tape-item' + (p.rerolled ? " is-rerolled" : "") + '" style="' + rarityStyle(p.char.rarity) + '">' +
        "<b>" + pad(i + 1) + "</b>" +
        '<span class="tape-name">' + esc(p.char.name) + "</span>" +
        "<i>" + rarityName(p.char.rarity) + "</i>" +
        "<em>" + tail + "</em>" +
      "</span>";
    }).join('<span class="tape-sep" aria-hidden="true">/</span>');
  }

  function renderDist() {
    var el = $("#dist");
    if (!el) return;
    var pool = activePool();
    var counts = R.map(function (_, i) {
      return pool.filter(function (c) { return c.rarity === i; }).length;
    });
    el.innerHTML = '<span class="dist-title">' + (state.scope ? "Pool bands" : "Gacha pool") + "</span>" +
      R.map(function (r, i) {
        return '<span class="dist-chip" title="' + r.name + " · " + counts[i] + " of " + pool.length + ' fighters">' +
          '<i class="dist-dot' + (i === 7 ? " is-secret" : "") + '" style="--c:' + r.color + '" aria-hidden="true"></i>' +
          r.name.slice(0, 3) + ' <span class="dist-pct">' + (pool.length ? (counts[i] / pool.length * 100).toFixed(1) : "0.0") + "%</span></span>";
      }).join("");
  }

  /* ── draft pool: random or one series ───────────────────────────────── */

  function activePool() {
    return FB.draftPool ? FB.draftPool(state.scope) : FB.pool;
  }

  function renderPool() {
    var bar = $("#pool-bar");
    if (!bar) return;
    var picker = $("#pool-picker");
    if (picker) picker.hidden = state.scopeMode !== "series";
    var note = $("#pool-note");
    if (note) note.hidden = state.scopeMode === "series";
    $$("[data-pool-mode]", bar).forEach(function (btn) {
      var on = btn.getAttribute("data-pool-mode") === state.scopeMode;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-checked", on ? "true" : "false");
    });

    var name = $("#pool-current-name");
    if (name) name.textContent = state.scope || "Choose an anime";
    var cap = $("#pool-current-count");
    if (cap) {
      cap.textContent = state.scope
        ? activePool().length + " fighters"
        : (FB.draftableCount ? FB.draftableCount() : 0) + " draftable";
    }

    var meta = $("#pool-meta");
    if (meta) {
      meta.textContent = state.scope
        ? state.scope + " only · " + activePool().length + " fighters"
        : "Random · " + FB.poolCount + " series";
    }
    var metric = $("#builder-metric");
    if (metric) {
      metric.textContent = state.scope
        ? state.scope + " · " + activePool().length + " fighters · 05 slots · 01 reroll"
        : FB.poolCount + " series · 05 slots · 01 reroll · 00 pity";
    }
    bar.classList.toggle("is-locked", !!state.scope);
  }

  function renderPoolList() {
    var list = $("#pool-list");
    if (!list || !FB.seriesCatalog) return;
    var input = $("#pool-search");
    var term = (input && input.value || "").trim().toLowerCase();
    var rows = FB.seriesCatalog().filter(function (s) {
      return !term || s.series.toLowerCase().indexOf(term) >= 0;
    });
    if (!rows.length) {
      list.innerHTML = '<p class="pool-empty">No anime matches that search.</p>';
      return;
    }
    var draftable = rows.filter(function (s) { return s.draftable; }).length;
    list.innerHTML = rows.map(function (s) {
      var on = state.scope === s.series;
      return '<button type="button" class="pool-opt' + (s.draftable ? " is-open" : " is-thin") + (on ? " is-active" : "") + '"' +
        ' role="option" aria-selected="' + (on ? "true" : "false") + '"' +
        (s.draftable ? "" : " disabled") +
        ' data-pool-series="' + esc(s.series) + '">' +
        '<span class="pool-opt-name">' + esc(s.series) + "</span>" +
        '<span class="pool-opt-count">' + (s.draftable ? s.count + " fighters" : s.count + " fighter · needs 5") + "</span>" +
      "</button>";
    }).join("");
    var hint = $("#pool-hint");
    if (hint) {
      hint.textContent = term
        ? draftable + " of " + rows.length + " matches can host a draft."
        : (FB.draftableCount ? FB.draftableCount() : 0) + " anime have five or more fighters on file. Switching pool starts a new session.";
    }
    var active = list.querySelector(".pool-opt.is-active");
    if (active && list.scrollHeight > list.clientHeight) {
      var top = active.offsetTop - list.clientHeight / 2 + active.offsetHeight / 2;
      list.scrollTop = Math.max(0, top);
    }
  }

  function setPoolOpen(open) {
    var menu = $("#pool-menu");
    var btn = $("#pool-current");
    if (!menu || !btn) return;
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    $("#pool-bar").classList.toggle("is-open", open);
    if (!open) return;
    renderPoolList();
    var input = $("#pool-search");
    if (input) { input.value = ""; input.focus(); }
  }

  function chooseScope(series) {
    var next = series || null;
    if (next === state.scope) { setPoolOpen(false); return; }
    state.scope = next;
    if (filled() > 0 || state.sealed) resetSession();
    renderDist();
    renderPool();
    renderAll();
    setPoolOpen(false);
    announce(next
      ? "Draft pool locked to " + next + ". New session, " + activePool().length + " fighters available."
      : "Random pool restored. New session across all " + FB.poolCount + " series.");
  }

  function setScopeMode(mode) {
    if (mode === state.scopeMode) { if (mode === "series") setPoolOpen(true); return; }
    state.scopeMode = mode;
    if (mode === "random" && state.scope) {
      chooseScope(null);
      return;
    }
    renderPool();
    if (mode === "series") setPoolOpen(true);
    announce(mode === "series" ? "Series lock armed. Pick an anime to draft from." : "Random pool selected.");
  }

  function gradeOf() {
    return state.sealed ? FB.rateDeck(state.deck, mods()) : null;
  }

  function renderStatus() {
    var m = mods();
    var n = filled();
    var rating = gradeOf();
    var set = function (id, text) { var el = $("#" + id); if (el) el.textContent = text; };
    set("tel-session", pad(state.pulls.length));
    set("tel-roster", FB.poolCount);
    set("tel-deck", pad(n) + " / 05");
    set("tel-rerolls", state.rerolls);
    set("user-count", pad(n) + " / 05 filed");
    set("total-now", pad3(FB.deckTotal(state.deck, m)));
    set("awake-state", state.awake ? "ON" : "OFF");
    set("builder-tag", state.sealed ? "Deck sealed" : state.offer ? "Card on board" : n ? pad(n) + " of 05 filed" : "Board open");
    set("ticker-deck", rating ? "GRADE " + rating.grade : n ? "BUILDING" : "UNRATED");
    var toggle = $("#awake-toggle");
    if (toggle) toggle.setAttribute("aria-checked", state.awake ? "true" : "false");
    document.body.classList.toggle("awake", state.awake);
  }

  function announce(msg) {
    var el = $("#announcer");
    if (el) el.textContent = msg;
  }

  /* ── deck rater ─────────────────────────────────────────────────────── */

  function raterEmptyHTML() {
    var n = filled();
    return '<div class="rater-empty">' +
      '<span class="empty-num">02</span>' +
      "<h2>The audit opens after the seal</h2>" +
      '<p class="micro">A deck is rated only when all five attribute slots are filed. Canon accuracy, rarity curve and placement losses are all read from a complete core.</p>' +
      '<div class="bar"><i style="width:' + (n / 5 * 100) + '%"></i></div>' +
      '<span class="micro"><strong>' + pad(n) + " / 05</strong> slots filed</span>" +
      '<button class="btn btn-primary" type="button" data-action="to-builder">Back to the board <span aria-hidden="true">\u2192</span></button>' +
    "</div>";
  }

  function gradeWord(g) {
    return { S: "HEADLINER", A: "CONTENDER", B: "SOLID CARD", C: "MID-CARD", D: "PRELIM", E: "OPEN CALL" }[g] || "UNRATED";
  }

  function raterHTML(rating) {
    var subs = rating.subs.map(function (sub) {
      return '<div class="sub-row">' +
        "<span>" + sub.label + "</span>" +
        '<span class="sub-track"><i class="sub-fill" style="width:' + sub.value + '%"></i></span>' +
        "<em>" + esc(sub.note) + "</em>" +
      "</div>";
    }).join("");

    var slots = rating.slots.map(function (slot) {
      var tagClass = slot.verdict === "peak" ? "is-peak" : slot.verdict === "penalised" ? "is-pen" : "";
      var tag = slot.verdict === "empty" ? "empty" : slot.verdict === "penalised" ? "penalised" : slot.verdict === "peak" ? "perfect" : "off-peak";
      return '<div class="sr-row">' +
        '<span class="sr-slot">' + slot.slot + "</span>" +
        '<span class="sr-name">' + (slot.card ? esc(slot.card.name) : "—") + "</span>" +
        '<span class="sr-tier">' + (slot.score ? T[slot.score.rank].label + (slot.score.star ? '<span class="star">*</span>' : "") + "<b>" + slot.score.value + "</b>" : "—") + "</span>" +
        '<span class="sr-tag ' + tagClass + '">' + tag + "</span>" +
      "</div>";
    }).join("");

    var curve = R.map(function (r, i) {
      var count = rating.rarityCounts[i];
      return '<div class="rc-row" style="--rar:' + r.color + '">' +
        "<span>" + r.name + "</span>" +
        '<span class="rc-track"><i class="rc-fill" style="width:' + (count / 5 * 100) + '%"></i></span>' +
        "<b>" + count + "</b>" +
      "</div>";
    }).join("");

    var canon = rating.canon.map(function (row) {
      var mark = row.matched ? "perfect" : row.mismatch ? "misfiled" : "off-peak";
      var markClass = row.matched ? "is-perfect" : row.mismatch ? "is-miss" : "";
      return '<div class="cr-row">' +
        '<span class="cr-name">' + row.name + "</span>" +
        '<span class="cr-peak">peak ' + row.peak + "</span>" +
        "<span>" + row.rank + "</span>" +
        '<span class="cr-mark ' + markClass + '">' + mark + "</span>" +
      "</div>";
    }).join("");

    var notes = rating.strengths.map(function (line) {
      return '<div class="note-row"><b>+</b><span>' + line + "</span></div>";
    }).concat(rating.concerns.map(function (line) {
      return '<div class="note-row is-warn"><b>!</b><span>' + line + "</span></div>";
    })).join("");

    return '<div class="rater-grid">' +
      '<div class="grade-panel">' +
        '<div class="grade-kicker">Deck rating · sealed core</div>' +
        '<div class="grade-letter">' + rating.grade + "</div>" +
        '<div class="grade-word">' + gradeWord(rating.grade) + "</div>" +
        '<p class="grade-line">' + esc(rating.gradeLine) + "</p>" +
        '<div class="grade-score"><b>' + rating.rating + "</b><span>/ 100 rating</span></div>" +
        '<div class="subs">' + subs + "</div>" +
        '<div class="pct-box">' +
          '<div class="pct-head"><span>vs peak-built cores</span><span>beats ' + rating.percentile + "%</span></div>" +
          '<div class="pct-track"><i class="pct-fill" style="width:' + rating.percentile + '%"></i></div>' +
          "<small>" + rating.total + " total output · " + rating.peaks + " perfect · " + rating.offMeta + " penalised</small>" +
        "</div>" +
      "</div>" +
      '<section class="panel report-panel">' +
        '<div class="report-block">' +
          '<h3>Slot audit <span>canon vs filed</span></h3>' +
          slots +
        "</div>" +
        '<div class="report-block">' +
          '<h3>Rarity curve <span>five cards</span></h3>' +
          '<div class="rarity-curve">' + curve + "</div>" +
        "</div>" +
        '<div class="report-block">' +
          '<h3>Canon readout <span>post-seal</span></h3>' +
          '<div class="canon-list">' + canon + "</div>" +
        "</div>" +
        '<div class="report-block">' +
          '<h3>Desk notes <span>what moved the grade</span></h3>' +
          '<div class="notes">' + notes + "</div>" +
        "</div>" +
        '<div class="report-actions">' +
          '<button class="btn btn-primary" type="button" data-action="rater-duel">1v1 with the anchor</button>' +
          '<button class="btn" type="button" data-action="to-builder">Adjust the core</button>' +
          '<button class="btn" type="button" data-action="copy-grade">Copy grade</button>' +
        "</div>" +
      "</section>" +
    "</div>";
  }

  function renderRater() {
    var root = $("#rater-root");
    if (!root) return;
    var tag = $("#rater-tag");
    if (!state.sealed || filled() < 5) {
      root.innerHTML = raterEmptyHTML();
      if (tag) tag.textContent = "Awaiting seal";
      return;
    }
    var rating = FB.rateDeck(state.deck, mods());
    if (tag) tag.textContent = "Graded " + rating.grade;
    root.innerHTML = raterHTML(rating);
    hydratePortraits(root);
  }

  /* ── fighter cards for the duel ─────────────────────────────────────── */

  function peakLabel(char) { return S[KEYS.indexOf(char.peak)].label; }

  function fighterPanel(char, side, options) {
    options = options || {};
    if (!char) {
      return '<article class="fighter-panel is-ai is-unknown">' +
        '<div class="fighter-art"><div class="fighter-unknown" aria-hidden="true">?</div></div>' +
        '<div class="fighter-info">' +
          '<span class="fighter-tag">' + (options.tag || "Opponent") + "</span>" +
          '<h3 class="fighter-name">Drawn at the bell</h3>' +
          '<div class="fighter-series">The relay keeps the card face down.</div>' +
          '<div class="fighter-foot"><span class="fighter-arch">SEALED</span></div>' +
        "</div>" +
      "</article>";
    }
    var rank = T[char.tiers[char.peak]];
    return '<article class="fighter-panel ' + side + '" style="' + rarityStyle(char.rarity) + '">' +
      '<div class="fighter-art">' + portraitHTML(char, "portrait-duel") + "</div>" +
      '<div class="fighter-info">' +
        '<span class="fighter-tag">' + (options.tag || (side === "is-user" ? "Operator" : "AI")) + "</span>" +
        '<h3 class="fighter-name">' + esc(char.name) + "</h3>" +
        '<div class="fighter-series">' + esc(char.series) + "</div>" +
        '<div class="fighter-foot">' +
          '<span class="fighter-rar" style="--rar:' + R[char.rarity].color + '">' + rarityName(char.rarity) + "</span>" +
          '<span class="fighter-arch">' + esc(char.archLabel) + "</span>" +
          '<span class="fighter-rank" title="Canon peak tier">' + rank.label + "</span>" +
        "</div>" +
      "</div>" +
    "</article>";
  }

  /* One five-line comparison table. Works for 1v1 AI, live rooms and the desk. */
  function duelTable(res, a, b, options) {
    options = options || {};
    var labelA = options.labelA || "A";
    var labelB = options.labelB || "B";
    var rows = res.rows.map(function (row) {
      var wa = row.winner === "a";
      var wb = row.winner === "b";
      var scale = 150;
      var aw = Math.min(100, Math.round(row.a.value / scale * 100));
      var bw = Math.min(100, Math.round(row.b.value / scale * 100));
      var point = row.winner === "a" ? labelA + " +1" : row.winner === "b" ? labelB + " +1" : "even";
      return '<div class="drow' + (wa ? " is-a" : wb ? " is-b" : "") + '" role="row">' +
        '<div class="dside a' + (wa ? " winner" : wb ? " loser" : "") + '">' +
          '<span class="dtier">' + T[row.a.rank].label + (row.a.star ? '<span class="dstar">*</span>' : "") + "</span>" +
          '<span class="dval">' + row.a.value + "</span>" +
        "</div>" +
        '<div class="dmid">' +
          '<span class="dstat"><span aria-hidden="true">' + row.stat.icon + "</span>" + row.stat.code + "</span>" +
          '<div class="dbar"><span class="half a"><i class="seg a" data-w="' + aw + '"></i></span><span class="half"><i class="seg b" data-w="' + bw + '"></i></span></div>' +
          '<span class="dpoint">' + point + "</span>" +
        "</div>" +
        '<div class="dside' + (wb ? " winner" : wa ? " loser" : "") + '">' +
          '<span class="dtier">' + T[row.b.rank].label + (row.b.star ? '<span class="dstar">*</span>' : "") + "</span>" +
          '<span class="dval">' + row.b.value + "</span>" +
        "</div>" +
      "</div>";
    }).join("");

    var isDraw = res.verdict === "draw";
    var winner = res.verdict === "a" ? a : res.verdict === "b" ? b : null;
    var stampText = isDraw ? "DRAW" : options.you ? (res.verdict === "a" ? "WIN" : "LOSS") : (res.verdict === "a" ? labelA : labelB);
    var stampClass = isDraw ? " is-draw" : options.you && res.verdict === "b" ? " is-loss" : "";
    var title = isDraw
      ? "Dead heat. <span>No decisive edge.</span>"
      : esc(winner.name) + " takes it <span>+" + Math.abs(res.aTotal - res.bTotal) + " output.</span>";
    var titleClass = isDraw ? " is-loss" : options.you && res.verdict === "b" ? " is-loss" : "";
    var sub = "Total output " + res.aTotal + " — " + res.bTotal +
      " · attribute points " + res.aPoints + " — " + res.bPoints;

    var actions = "";
    if (options.actions) actions = '<div class="verdict-actions">' + options.actions + "</div>";

    return '<div class="duel-table" role="table" aria-label="Attribute comparison">' + rows + "</div>" +
      '<div class="verdict">' +
        '<div class="stamp' + stampClass + '"><strong>' + stampText + "</strong><small>" + (isDraw ? "output supremacy" : "output supremacy") + "</small></div>" +
        '<div class="vmain">' +
          '<h3 class="vtitle' + titleClass + '">' + title + "</h3>" +
          '<div class="vsub">' + sub + "</div>" +
          '<div class="vscore">' +
            '<div><b class="a">' + res.aTotal + "</b><small>" + esc(labelA) + "</small></div>" +
            '<div><b class="b">' + res.bTotal + "</b><small>" + esc(labelB) + "</small></div>" +
          "</div>" +
          '<p class="micro" style="margin-top:10px">Peaks · ' + esc(a.name) + ": " + peakLabel(a) + " — " + esc(b.name) + ": " + peakLabel(b) + ". Total output decides the bout; the five line points are read-outs, not the verdict.</p>" +
          actions +
        "</div>" +
      "</div>";
  }

  /* Five-slot deck versus five-slot deck — used by live rooms. */
  function deckDuelTable(res, options) {
    options = options || {};
    var labelA = options.labelA || "Red";
    var labelB = options.labelB || "Blue";

    var rows = res.rows.map(function (row, i) {
      var ca = res.a && res.a[i] ? res.a[i] : null;
      var cb = res.b && res.b[i] ? res.b[i] : null;
      var wa = row.winner === "a";
      var wb = row.winner === "b";
      var aw = Math.min(100, Math.round(row.a.value / 220 * 100));
      var bw = Math.min(100, Math.round(row.b.value / 220 * 100));
      var point = row.winner === "a" ? labelA + " +1" : row.winner === "b" ? labelB + " +1" : "even";
      return '<div class="drow deck-row' + (wa ? " is-a" : wb ? " is-b" : "") + '" role="row">' +
        '<div class="dside a' + (wa ? " winner" : wb ? " loser" : "") + '">' +
          '<span class="dname">' + esc(ca ? ca.name : "—") + "</span>" +
          '<span class="dtier">' + T[row.a.rank].label + (row.a.star ? '<span class="dstar">*</span>' : "") + "</span>" +
          '<span class="dval">' + row.a.value + "</span>" +
        "</div>" +
        '<div class="dmid">' +
          '<span class="dstat"><span aria-hidden="true">' + row.stat.icon + "</span>" + row.stat.code + "</span>" +
          '<div class="dbar"><span class="half a"><i class="seg a" data-w="' + aw + '"></i></span><span class="half"><i class="seg b" data-w="' + bw + '"></i></span></div>' +
          '<span class="dpoint">' + point + "</span>" +
        "</div>" +
        '<div class="dside' + (wb ? " winner" : wa ? " loser" : "") + '">' +
          '<span class="dname">' + esc(cb ? cb.name : "—") + "</span>" +
          '<span class="dtier">' + T[row.b.rank].label + (row.b.star ? '<span class="dstar">*</span>' : "") + "</span>" +
          '<span class="dval">' + row.b.value + "</span>" +
        "</div>" +
      "</div>";
    }).join("");

    var isDraw = res.verdict === "draw";
    var winnerName = res.verdict === "a" ? res.aName : res.verdict === "b" ? res.bName : null;
    var stampText = isDraw ? "DRAW" : res.verdict === "a" ? labelA : labelB;
    var stampClass = isDraw ? " is-draw" : "";
    var title = isDraw
      ? "Dead heat. <span>No decisive edge.</span>"
      : esc(winnerName) + " takes it <span>+" + Math.abs(res.aTotal - res.bTotal) + " output.</span>";

    return '<div class="live-result-head">' +
        "<span><b>Red</b> · " + esc(options.aName || labelA) + "</span>" +
        '<span class="mode">' + esc(options.mode || "Live room") + "</span>" +
        "<span><b>Blue</b> · " + esc(options.bName || labelB) + "</span>" +
      "</div>" +
      '<div class="duel-table deck-table" role="table" aria-label="Deck comparison">' + rows + "</div>" +
      '<div class="verdict">' +
        '<div class="stamp' + stampClass + '"><strong>' + stampText + "</strong><small>output supremacy</small></div>" +
        '<div class="vmain">' +
          '<h3 class="vtitle">' + title + "</h3>" +
          '<div class="vsub">Total output ' + res.aTotal + " — " + res.bTotal +
            " · attribute points " + res.aPoints + " — " + res.bPoints +
            " · peaks " + res.aPeaks + " — " + res.bPeaks + "</div>" +
          '<div class="vscore">' +
            '<div><b class="a">' + res.aTotal + "</b><small>" + esc(labelA) + " · " + esc(options.aName || "") + "</small></div>" +
            '<div><b class="b">' + res.bTotal + "</b><small>" + esc(labelB) + " · " + esc(options.bName || "") + "</small></div>" +
          "</div>" +
          (options.actions ? '<div class="verdict-actions">' + options.actions + "</div>" : "") +
        "</div>" +
      "</div>";
  }

  function paintBars(root) {
    var paint = function () {
      $$(".seg", root).forEach(function (seg) {
        seg.style.width = seg.getAttribute("data-w") + "%";
      });
    };
    if (reduceMotion) paint();
    else setTimeout(paint, 30);
  }

  /* ── 1v1 AI ─────────────────────────────────────────────────────────── */

  function duelEmptyHTML() {
    return '<div class="arena-empty">' +
      "<h2>Call out a fighter</h2>" +
      '<p class="micro">Search the 500 above, or hit the dice. One fighter each, five attributes, one verdict.</p>' +
    "</div>";
  }

  function duelPreviewHTML() {
    var player = state.duel.player;
    return '<div class="duel-cards">' +
      fighterPanel(player, "is-user", { tag: "Your corner" }) +
      '<div class="vs-plate"><b>VS</b><span>BO1 · 5 LINES</span></div>' +
      fighterPanel(null, "is-ai", { tag: "AI corner" }) +
    "</div>" +
    '<div class="duel-run"><button class="btn btn-primary" type="button" data-action="duel-run">Ring the bell <span class="count">BO1</span></button></div>' +
    '<p class="micro" style="text-align:center">The AI draws its fighter the moment the bell rings. No re-rolls, no scouting.</p>';
  }

  function duelResultHTML() {
    var player = state.duel.player;
    var ai = state.duel.ai;
    var res = state.duel.result;
    return '<div class="duel-cards">' +
      fighterPanel(player, "is-user", { tag: "Your corner" }) +
      '<div class="vs-plate"><b>VS</b><span>FINAL</span></div>' +
      fighterPanel(ai, "is-ai", { tag: "AI corner" }) +
    "</div>" +
    duelTable(res, player, ai, {
      labelA: "You",
      labelB: "AI",
      you: true,
      actions: '<button class="btn btn-primary" type="button" data-action="duel-rematch">Draw a new opponent</button>' +
        '<button class="btn" type="button" data-action="duel-change">Change fighter</button>' +
        (state.sealed ? '<button class="btn" type="button" data-action="to-rater">Rate your core</button>' : '<button class="btn" type="button" data-action="to-builder">Build a core</button>')
    });
  }

  function renderDuel() {
    var root = $("#duel-root");
    if (!root) return;
    var btn = $("#duel-fight");
    if (btn) btn.disabled = !state.duel.player;
    if (state.duel.result && state.duel.ai && state.duel.player) {
      root.innerHTML = duelResultHTML();
    } else if (state.duel.player) {
      root.innerHTML = duelPreviewHTML();
    } else {
      root.innerHTML = duelEmptyHTML();
    }
    hydratePortraits(root);
    if (state.duel.result) paintBars(root);
  }

  function runDuel() {
    if (!state.duel.player) return;
    var used = {};
    used[state.duel.player.id] = true;
    var ai = FB.randomCharacter(used);
    state.duel.ai = ai;
    state.duel.result = FB.duelOne(state.duel.player, ai);
    renderDuel();
    announce(state.duel.player.name + " versus " + ai.name + ". " +
      (state.duel.result.verdict === "a" ? state.duel.player.name + " wins." : state.duel.result.verdict === "b" ? ai.name + " wins." : "Draw."));
  }

  function clearDuel() {
    state.duel.player = null;
    state.duel.ai = null;
    state.duel.result = null;
    if (duelPicker) duelPicker.clear();
    renderDuel();
  }

  /* ── builder actions ────────────────────────────────────────────────── */

  function roll() {
    if (state.sealed || state.offer) return;
    var used = {};
    state.deck.forEach(function (c) { if (c) used[c.id] = true; });
    var pool = activePool();
    if (!pool.some(function (c) { return !used[c.id]; })) {
      announce("Every fighter in this pool is on the board. Seal the deck or pick another pool.");
      return;
    }
    state.offer = FB.randomCharacter(used, state.scope);
    state.offerSerial++;
    state.pulls.push({ char: state.offer, slot: null, rerolled: false });
    announce("Rolled " + state.offer.name + " from " + state.offer.series + ". " + rarityName(state.offer.rarity) + " rarity. Peak attribute sealed.");
    renderAll();
  }

  function reroll() {
    if (!state.offer || state.rerolls < 1) return;
    var used = {};
    state.deck.forEach(function (c) { if (c) used[c.id] = true; });
    used[state.offer.id] = true;
    var pool = activePool();
    if (!pool.some(function (c) { return !used[c.id]; })) {
      announce("No unused fighters left in this pool to reroll into.");
      return;
    }
    var prior = state.pulls[state.pulls.length - 1];
    if (prior && prior.char.id === state.offer.id && prior.slot == null) prior.rerolled = true;
    state.rerolls--;
    state.offer = FB.randomCharacter(used, state.scope);
    state.offerSerial++;
    state.pulls.push({ char: state.offer, slot: null, rerolled: false });
    announce("Reroll spent. " + state.offer.name + " — " + rarityName(state.offer.rarity) + " rarity.");
    renderAll();
  }

  function assign(slot) {
    if (!state.offer || state.deck[slot]) return;
    var c = state.offer;
    var sc = FB.scoreSlot(c, KEYS[slot], null);
    state.deck[slot] = c;
    for (var entry = state.pulls.length - 1; entry >= 0; entry--) {
      if (state.pulls[entry].char.id === c.id && state.pulls[entry].slot == null && !state.pulls[entry].rerolled) {
        state.pulls[entry].slot = slot;
        break;
      }
    }
    state.offer = null;
    state.lastLocked = slot;
    var done = state.deck.every(Boolean);
    if (done) state.sealed = true;
    announce(c.name + " locked into " + S[slot].label + (sc.star ? " as a perfect placement" : sc.mismatch ? " off-meta, evaluated as E" : "") + ". " + (done ? "Deck sealed." : ""));
    renderAll();
    if (done) {
      renderRater();
      renderStatus();
      announce("Deck sealed. Open the deck rater for the full audit.");
    }
  }

  function resetSession() {
    state.deck = [null, null, null, null, null];
    state.offer = null;
    state.offerSerial++;
    state.rerolls = 1;
    state.sealed = false;
    state.lastLocked = -1;
    state.pulls = [];
    state.session++;
    state.duel = { player: null, ai: null, result: null };
    if (duelPicker) duelPicker.clear();
    if (typeof FB.go === "function") FB.go("builder");
    announce("Session reset. One reroll restored.");
    renderAll();
    renderRater();
    renderDuel();
  }

  function toggleAwake() {
    state.awake = !state.awake;
    announce(state.awake ? "Awakening engaged." : "Awakening disengaged.");
    renderAll();
    renderRater();
    var brief = $("#brief-snap-meta");
    if (brief) brief.textContent = state.awake ? "Awakening engaged" : "Awakening standby";
  }

  function renderAll() {
    renderPool();
    renderDeck();
    renderStage();
    renderStatus();
    renderTape();
    hydratePortraits();
    paintPortraits();
    if (state.offer && FB.portraits) FB.portraits.request(state.offer, true);
  }

  /* ── shared click handling ──────────────────────────────────────────── */

  function onAction(action, target) {
    if (action === "roll") roll();
    else if (action === "reroll") reroll();
    else if (action === "assign") assign(Number(target.getAttribute("data-slot")));
    else if (action === "reset") resetSession();
    else if (action === "to-builder") { if (typeof FB.go === "function") FB.go("builder"); }
    else if (action === "to-rater") { if (typeof FB.go === "function") FB.go("rater"); }
    else if (action === "to-duel") { if (typeof FB.go === "function") FB.go("duel"); }
    else if (action === "duel-run") runDuel();
    else if (action === "duel-rematch") runDuel();
    else if (action === "duel-change") { clearDuel(); if (duelPicker) duelPicker.focus(); }
    else if (action === "rater-duel") {
      var m = mods();
      var best = null;
      var bestValue = -1;
      state.deck.forEach(function (c, i) {
        if (!c) return;
        var v = FB.scoreSlot(c, KEYS[i], m).value;
        if (v > bestValue) { bestValue = v; best = c; }
      });
      if (best) {
        state.duel.player = best;
        state.duel.ai = null;
        state.duel.result = null;
        if (duelPicker) duelPicker.set(best);
        renderDuel();
        if (typeof FB.go === "function") FB.go("duel");
        announce(best.name + " is in your corner.");
      }
    } else if (action === "copy-grade") {
      var rating = FB.rateDeck(state.deck, mods());
      var line = "FreeBuff AI — grade " + rating.grade + " (" + rating.rating + "/100), " + rating.total + " output, " + rating.peaks + "/5 peaks, " + rating.percentile + "th-percentile vs peak-built cores.";
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(line).then(function () {
          announce("Grade copied to clipboard.");
        }, function () { announce("Clipboard unavailable."); });
      } else {
        announce("Clipboard unavailable.");
      }
    }
  }

  document.addEventListener("click", function (e) {
    var target = e.target instanceof Element ? e.target.closest("[data-action]") : null;
    if (!target) return;
    onAction(target.getAttribute("data-action"), target);
  });

  /* ── boot ───────────────────────────────────────────────────────────── */

  function boot() {
    renderDist();
    renderAll();
    renderRater();
    renderDuel();

    var host = $("#duel-picker");
    if (host && FB.mountPicker) {
      duelPicker = FB.mountPicker(host, {
        placeholder: "Type a fighter or a series…",
        onPick: function (card) {
          state.duel.player = card;
          state.duel.ai = null;
          state.duel.result = null;
          renderDuel();
          announce(card.name + " steps into your corner.");
        },
        onClear: function () {
          state.duel.player = null;
          state.duel.ai = null;
          state.duel.result = null;
          renderDuel();
        }
      });
    }

    var fight = $("#duel-fight");
    if (fight) fight.addEventListener("click", runDuel);

    /* draft pool controls */
    $$("[data-pool-mode]").forEach(function (btn) {
      btn.addEventListener("click", function () { setScopeMode(btn.getAttribute("data-pool-mode")); });
    });
    var poolCurrent = $("#pool-current");
    if (poolCurrent) {
      poolCurrent.addEventListener("click", function () {
        setPoolOpen($("#pool-menu").hidden);
      });
    }
    var poolSearch = $("#pool-search");
    if (poolSearch) poolSearch.addEventListener("input", renderPoolList);
    var poolList = $("#pool-list");
    if (poolList) {
      poolList.addEventListener("click", function (e) {
        var row = e.target.closest("[data-pool-series]");
        if (!row || row.disabled) return;
        chooseScope(row.getAttribute("data-pool-series"));
      });
    }
    var poolBar = $("#pool-bar");
    if (poolBar) {
      document.addEventListener("click", function (e) {
        if (!poolBar.classList.contains("is-open")) return;
        if (poolBar.contains(e.target)) return;
        setPoolOpen(false);
      });
      poolBar.addEventListener("keydown", function (e) {
        var menu = $("#pool-menu");
        if (!menu || menu.hidden) return;
        if (e.key === "Escape") {
          e.stopPropagation();
          setPoolOpen(false);
          poolCurrent.focus();
          return;
        }
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        var opts = Array.prototype.slice.call(poolList.querySelectorAll(".pool-opt.is-open"));
        if (!opts.length) return;
        e.preventDefault();
        var at = opts.indexOf(document.activeElement);
        var target = e.key === "ArrowDown"
          ? (at < 0 ? 0 : Math.min(opts.length - 1, at + 1))
          : (at < 0 ? opts.length - 1 : Math.max(0, at - 1));
        opts[target].focus();
      });
    }

    if (FB.portraits) FB.portraits.subscribe(paintPortraits);

    /* A portrait that could not be resolved offers a manual retry; the same
       click also forces the queue so the empty card is not stuck for a minute. */
    document.addEventListener("click", function (e) {
      var box = e.target && e.target.closest ? e.target.closest(".portrait.is-retry") : null;
      if (!box || !FB.portraits) return;
      e.preventDefault();
      var id = Number(box.getAttribute("data-portrait-id"));
      FB.portraits.retry(id);
      var c = FB.lookupCharacter ? FB.lookupCharacter(id) : FB.characterById(id);
      box.classList.remove("is-retry");
      box.removeAttribute("title");
      if (c) FB.portraits.request(c, true);
    });
  }

  FB.ui = {
    state: state,
    boot: boot,
    renderAll: renderAll,
    renderRater: renderRater,
    renderDuel: renderDuel,
    renderStatus: renderStatus,
    toggleAwake: toggleAwake,
    resetSession: resetSession,
    roll: roll,
    reroll: reroll,
    assign: assign,
    runDuel: runDuel,
    duelTable: duelTable,
    deckDuelTable: deckDuelTable,
    slotMarkup: function (char, i, flash) {
      return char ? filledSlot(char, i, { awake: false }, flash) : emptySlot(i);
    },
    fighterPanel: fighterPanel,
    portraitHTML: portraitHTML,
    hydratePortraits: hydratePortraits,
    requestPortraits: function (root) {
      if (!FB.portraits) return;
      $$("[data-portrait-id]", root || document).forEach(function (box) {
        var id = Number(box.getAttribute("data-portrait-id"));
        var c = FB.lookupCharacter ? FB.lookupCharacter(id) : FB.characterById(id);
        if (c) FB.portraits.request(c);
      });
    },
    mods: mods,
    filled: filled,
    gradeOf: gradeOf,
    rarityName: rarityName,
    rarityStyle: rarityStyle,
    peakLabel: peakLabel,
    paintBars: paintBars,
    esc: esc
  };
})(window.FB);
