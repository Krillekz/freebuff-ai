/* PEAKLINE — analyst desk
   A local, rules-aware analyst: conversation, two-fighter matchups and a
   briefing sheet. No network model, no cloud, no key. */

(function (FB) {
  "use strict";

  var state = { busy: false, seeded: false, tab: "main" };
  var whoA = null;
  var whoB = null;
  var whoResult = null;
  var pickerA = null;
  var pickerB = null;

  var $ = function (sel) { return document.querySelector(sel); };

  function esc(v) {
    return String(v).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function norm(v) {
    return String(v || "").toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ").trim();
  }

  function now() {
    return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function appState() { return FB.ui.state; }
  function mods() { return FB.ui.mods(); }

  function anchor() {
    var st = appState();
    var best = null;
    var bestValue = -1;
    st.deck.forEach(function (c, i) {
      if (!c) return;
      var sc = FB.scoreSlot(c, FB.KEYS[i], mods());
      if (sc.value > bestValue) { bestValue = sc.value; best = { card: c, value: sc.value, slot: i }; }
    });
    return best;
  }

  function rating() {
    var st = appState();
    if (!st.sealed || FB.ui.filled() < 5) return null;
    return FB.rateDeck(st.deck, mods());
  }

  /* ── pool search ─────────────────────────────────────────────────────── */

  function findCharacter(phrase) {
    var q = norm(phrase);
    if (!q) return null;
    var best = null;
    var bestScore = 0;
    var qt = q.split(" ").filter(function (t) { return t.length > 2; });
    FB.pool.forEach(function (c) {
      var name = norm(c.name);
      var series = norm(c.series);
      var score = 0;
      if (name === q) score = 100;
      else if (name.indexOf(q) === 0) score = 78 + (q.length / name.length) * 12;
      else if (q.indexOf(name) === 0) score = 70;
      else if (name.indexOf(q) >= 0) score = 58;
      else if (series === q) score = 54;
      else if (series.indexOf(q) >= 0) score = 34;
      else if (qt.length) {
        var nt = name.split(" ");
        var hits = qt.filter(function (t) { return nt.indexOf(t) >= 0; }).length;
        if (hits && (hits >= Math.min(2, qt.length) || nt.length === 1)) score = 18 + hits * 4;
      }
      if (score > bestScore) { bestScore = score; best = c; }
    });
    return bestScore >= 18 ? best : null;
  }

  function pairFromText(text) {
    var cleaned = text.replace(/[?!.,]/g, " ").replace(/\s{2,}/g, " ").trim();

    var parts = cleaned.split(/\s+(?:vs\.?|versus|against|or)\s+/i);
    if (parts.length >= 2) {
      var a = findCharacter(parts[0].replace(/^.*?(?:who\s+wins|between|compare)\s+/i, ""));
      var b = findCharacter(parts.slice(1).join(" "));
      if (a && b && a.id !== b.id) return [a, b];
    }

    var m = cleaned.match(/between\s+(.+?)\s+and\s+(.+)$/i);
    if (m) {
      var c = findCharacter(m[1]);
      var d = findCharacter(m[2]);
      if (c && d && c.id !== d.id) return [c, d];
    }

    if (/\b(compare|who\s+wins|who\s+would\s+win|who\s+takes)\b/i.test(cleaned)) {
      var andParts = cleaned.split(/\s+and\s+/i);
      if (andParts.length === 2) {
        var left = findCharacter(andParts[0].replace(/^.*?(?:compare|who\s+wins|who\s+would\s+win|who\s+takes)\s+/i, ""));
        var right = findCharacter(andParts[1]);
        if (left && right && left.id !== right.id) return [left, right];
      }
    }

    /* Only scan the sentence for names when it is clearly a matchup request.
       Without this guard, one-letter handles like "D" match any stray "d". */
    if (!/\b(who\s+wins|who\s+would\s+win|who\s+takes|matchup|compare|fight)\b/i.test(cleaned)) return null;
    var padded = " " + norm(cleaned) + " ";
    var hits = FB.pool.filter(function (c) {
      var n = norm(c.name);
      if (n.length < 3) return false;
      return padded.indexOf(" " + n + " ") >= 0;
    }).sort(function (x, y) { return y.name.length - x.name.length; });
    if (hits.length >= 2 && hits[0].id !== hits[1].id) return [hits[0], hits[1]];
    return null;
  }

  /* ── answer engine ───────────────────────────────────────────────────── */

  function deckLine() {
    var st = appState();
    var n = FB.ui.filled();
    if (!n) return "Your board is empty — five pulls, filed blind.";
    if (!st.sealed) return "Core is " + n + "/5. I can't grade a partial board; that is the rule. Lock five and ask again.";
    var r = rating();
    var a = anchor();
    return "Grade <b>" + r.grade + "</b> (" + r.rating + "/100) · " + r.total + " output · " +
      r.peaks + " perfect, " + r.offMeta + " penalised. Anchor: <b>" + esc(a.card.name) + "</b> at " + r.slots[a.slot].slot + " for " + a.value + ".";
  }

  function rateAnswer() {
    var r = rating();
    if (!r) return deckLine();
    var a = anchor();
    var lines = [
      deckLine(),
      r.strengths[0] ? esc(r.strengths[0]) : "",
      r.concerns[0] ? "Watch: " + esc(r.concerns[0]) : "",
      "Top " + (100 - r.percentile) + "% of peak-built cores."
    ].filter(Boolean);
    return lines.join("<br>");
  }

  function oddsAnswer() {
    var rows = FB.RARITIES.map(function (r, i) {
      return r.name + " " + (FB.rarityCounts[i] / FB.poolCount * 100).toFixed(1) + "%";
    });
    return "Flat pool, no pity: " + rows.join(" · ") +
      ".<br>Mythical or better is " + (FB.rarityCounts.slice(5).reduce(function (a, b) { return a + b; }, 0) / FB.poolCount * 100).toFixed(0) + "% per pull.";
  }

  function readCharacter(c) {
    var st = appState();
    var bits = [
      "<b>" + esc(c.name) + "</b> — " + esc(c.series) + ".",
      "<b>" + FB.ui.rarityName(c.rarity) + "</b> · " + esc(c.archLabel) + " · SIG " + esc(c.signature || "unrecorded") + ".",
      "Trait: " + esc(c.trait) + (c.traps ? " · " + c.traps + " trap slot" + (c.traps > 1 ? "s" : "") : " · no traps") + "."
    ];
    if (st.sealed) {
      bits.push("Canon peak: <b>" + FB.ui.peakLabel(c) + "</b> at " + FB.TIERS[c.tiers[c.peak]].label + ".");
    } else {
      bits.push("Peak is sealed until your core is locked. Read the archetype, not the colour.");
    }
    return bits.join("<br>");
  }

  function placementAnswer(c) {
    var st = appState();
    if (st.sealed) return readCharacter(c);
    var hint = {
      brawler: "Strength",
      speedster: "Speed",
      caster: "Abilities",
      genius: "IQ",
      tank: "Durability",
      duelist: "the line that fits the signature"
    }[c.arch];
    var note = st.offer && st.offer.id === c.id
      ? " That is the card on your board right now."
      : "";
    return "<b>" + esc(c.name) + "</b> reads as a " + esc(c.archLabel) + "." + note +
      "<br>The archetype points at <b>" + hint + "</b>, but the card will not confirm the peak before the seal.";
  }

  function matchupAnswer(a, b) {
    var res = FB.duelOne(a, b);
    var winner = res.verdict === "a" ? a : res.verdict === "b" ? b : null;
    var aPeak = FB.ui.peakLabel(a);
    var bPeak = FB.ui.peakLabel(b);
    var body;
    if (!winner) {
      body = "Dead heat — " + res.aTotal + " to " + res.bTotal + ". " +
        "Neither corner owns a clean edge.";
    } else {
      body = "<b>" + esc(winner.name) + "</b> takes it, " +
        Math.max(res.aTotal, res.bTotal) + " to " + Math.min(res.aTotal, res.bTotal) + ". " +
        "Attribute points " + res.aPoints + "–" + res.bPoints + ".<br>" +
        esc(a.name) + " peaks on <b>" + aPeak + "</b>; " + esc(b.name) + " peaks on <b>" + bPeak + "</b>.";
    }
    return body + '<button type="button" class="btn btn-sm" data-desk-pair="' + a.id + "," + b.id + '">Open the full card</button>';
  }

  function strongestAnswer() {
    var top = FB.pool.slice().sort(function (a, b) {
      return FB.scoreSlot(b, b.peak, null).value - FB.scoreSlot(a, a.peak, null).value;
    }).slice(0, 3);
    return "On canon output: " + top.map(function (c, i) {
      return (i + 1) + ". <b>" + esc(c.name) + "</b> (" + FB.ui.rarityName(c.rarity) + ")";
    }).join(" · ") + ".<br>Peaks stay sealed until you have a core.";
  }

  function rarestAnswer() {
    var secrets = FB.pool.filter(function (c) { return c.rarity === 7; });
    var pick = secrets[Math.floor(Math.random() * secrets.length)];
    return "The Secret band is " + secrets.length + " of 500 — 5%. It is flat odds, no pity.<br>One of them: <b>" + esc(pick.name) + "</b> — " + esc(pick.series) + ".";
  }

  function recommendAnswer() {
    var st = appState();
    if (st.offer) {
      return "You have <b>" + esc(st.offer.name) + "</b> on the board: " + esc(st.offer.archLabel) +
        ", SIG " + esc(st.offer.signature || "unrecorded") + ". The archetype is the only honest read before the seal.";
    }
    var open = FB.STATS.filter(function (_, i) { return !st.deck[i]; });
    if (open.length) {
      return "Open lines: " + open.map(function (s) { return s.label; }).join(", ") +
        ". Roll until the archetype and signature agree, then file it.";
    }
    return rateAnswer();
  }

  function awakeningAnswer() {
    var st = appState();
    if (!st.awake) return "Awakening is off. Toggle it in the top strip. It scales the deck's dominant attribute +1 rank and all output ×1.15.";
    var passive = FB.awakening(st.deck);
    return "Awakening is on. " + (passive
      ? "<b>" + esc(passive.name) + "</b> — " + esc(passive.note) + "."
      : "No dominant attribute yet — file a core and it syncs.");
  }

  function howAnswer() {
    return "<b>The short version.</b><br>Roll. Read the archetype and signature, not the colour. File into one of five slots. Lock five and the seal opens. Then rate the deck, take one fighter into 1v1 AI, or open a room against a friend.<br>Peaks stay hidden until the fifth lock. A perfect file stamps <b>*</b>; an off-meta file collapses to <b>E</b>.";
  }

  function modeAnswer() {
    return "<b>1v1 AI</b> — you pick one fighter, the AI draws blind, five attributes decide the lines and total output decides the bout.<br>" +
      "<b>1v1 Live</b> — open a room, share the code, or use the public queue. Run <b>node server.js</b> first; the relay is local.<br>" +
      "<b>Analyst</b> — that is me. Ratings, reads, matchups.";
  }

  function greeting() {
    var st = appState();
    var r = rating();
    var status = r ? "Your core is graded <b>" + r.grade + "</b>." : "Core is " + FB.ui.filled() + "/5.";
    return "Desk is open. " + status + " Ask for a rating, a read on a pull, or a matchup — I only call what I can see.";
  }

  function answer(text) {
    var q = norm(text);
    var st = appState();
    var pair = pairFromText(text);

    if (!q) return "You are on the mic. Say something.";

    if (pair) return matchupAnswer(pair[0], pair[1]);

    if (/\b(who wins|who would win|who takes|settle|matchup)\b/.test(q)) {
      return "Name two fighters and I will call it — for example <b>Levi vs Guts</b>.";
    }

    if (/\b(hi|hello|hey|yo|sup|morning|evening)\b/.test(q) && q.split(" ").length <= 4) return greeting();

    if (/\b(rate|grade|rating|score|how good|audit)\b/.test(q)) return rateAnswer();

    if (/\b(anchor|best pull|carrying|strongest pull)\b/.test(q)) {
      var anc = anchor();
      if (!anc) return "No cards filed yet. The anchor is whichever slot carries the most output — roll and file five, then ask again.";
      var r2 = rating();
      return "<b>" + esc(anc.card.name) + "</b> is the anchor: " + FB.STATS[anc.slot].label + " for " + anc.value + " output." +
        (r2 ? " The core grades <b>" + r2.grade + "</b>." : " Seal the core for the full audit.");
    }

    if (/\b(deck|core|board|slots|lineup)\b/.test(q) && /\b(my|this|current|what)\b/.test(q)) return deckLine();

    if (/\b(odds|chance|probability|percentage|pull rate)\b/.test(q)) return oddsAnswer();

    if (/\b(secret|rarest|rarity|mythical|divine)\b/.test(q)) return rarestAnswer();

    if (/\b(strongest|best character|top card|most powerful)\b/.test(q)) return strongestAnswer();

    if (/\b(peak|belong|where|which (stat|slot)|position)\b/.test(q)) {
      var words = q.replace(/\b(where|should|does|do|i|belong|put|place|file|which|stat|slot|is|the|a|an|peak|of|for|go|goes)\b/g, " ");
      var subject = findCharacter(words);
      if (!subject && st.offer) subject = st.offer;
      if (subject) return placementAnswer(subject);
      var archWord = q.match(/\b(brawler|speedster|caster|tank|genius|tactician|duelist)\b/);
      if (archWord) {
        var map = { brawler: "Strength", speedster: "Speed", caster: "Abilities", tank: "Durability", genius: "IQ", tactician: "IQ", duelist: "the line that matches the signature" };
        return "A <b>" + archWord[1].toUpperCase() + "</b> paper points at <b>" + map[archWord[1]] + "</b>. The card will not confirm the peak before the seal; that is the read.";
      }
      return "Peaks are sealed before the fifth lock. After the seal, the deck rater prints every peak and whether you filed it clean.<br>Before then: archetype, signature, trait. That is the whole read.";
    }

    if (/\b(recommend|suggest|what should i|help me pick|advice)\b/.test(q)) return recommendAnswer();

    if (/\b(awaken|awakening|passive|buff)\b/.test(q)) return awakeningAnswer();

    if (/\b(how (do|does|to)|rules|play|tutorial|explain)\b/.test(q)) return howAnswer();

    if (/\b(1v1|live|multiplayer|friend|room|queue|server)\b/.test(q)) return modeAnswer();

    if (/\b(who are you|what are you)\b/.test(q)) {
      return "A local analyst. No cloud, no key — I read this board, the 500-entry pool and the same rulebook you do.";
    }

    if (/\b(what can you do|help|commands)\b/.test(q)) {
      return "<b>On the desk:</b> rate a sealed core, read a pull, explain peaks, print the odds, name the strongest card, or settle any two fighters.<br>Try <b>Kirito vs Asuna</b> — or ask me where a card belongs.";
    }

    if (/\b(favorite|favourite)\b/.test(q)) {
      var a = anchor();
      return a ? "Today? <b>" + esc(a.card.name) + "</b>. It is carrying " + a.value + " output in your core." : "Whoever files clean. The board has no sentiment.";
    }

    if (/\b(thanks|thank you|appreciate|cheers)\b/.test(q)) return "Anytime. Keep the board honest.";
    if (/\b(bye|later|goodnight|see you)\b/.test(q)) return "Bell's yours.";
    if (/^(ok|okay|k|cool|nice|lol|haha|yeah|yep|sure)$/.test(q)) return "Noted. Want a matchup or a read?";
    if (/\b(joke|funny)\b/.test(q)) return "Two Commons walk into a bar. Bartender says, “No peaks?” They get filed into Strength anyway. E-rank.";

    var named = findCharacter(text);
    if (named) return readCharacter(named);

    if (/\b(anime|manga|series|show|watch)\b/.test(q)) {
      return "I keep to the 500 on the board. Name one and I will read the card, or put two in the ring.";
    }

    if (st.offer) {
      return "I can only call what is on the desk. You have <b>" + esc(st.offer.name) + "</b> waiting — ask where the archetype points, or name any two fighters for a matchup.";
    }
    return "I can work with names, matchups, your core or the odds. Try <b>Levi vs Guts</b>, <b>rate my core</b>, or <b>where does a caster belong?</b>";
  }

  /* ── chat rendering ──────────────────────────────────────────────────── */

  function chatAppend(role, html, stamp) {
    var log = $("#chat-log");
    if (!log) return null;
    var el = document.createElement("div");
    el.className = "msg " + role;
    el.innerHTML =
      '<span class="msg-avatar" aria-hidden="true">' + (role === "user" ? "YOU" : "P") + "</span>" +
      '<div class="msg-body">' + html + '<span class="msg-time">' + (stamp || now()) + "</span></div>";
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  function send(text) {
    if (state.busy) return;
    var clean = String(text || "").trim().slice(0, 400);
    if (!clean) return;
    state.busy = true;
    chatAppend("user", esc(clean));
    var input = $("#chat-input");
    if (input) input.value = "";
    var button = $("#chat-form button");
    if (button) button.disabled = true;

    var typing = chatAppend("ai", '<span class="typing" aria-label="Analyst is typing"><i></i><i></i><i></i></span>');
    var reply = answer(clean);
    var wait = 380 + Math.min(720, reply.length * 3);

    setTimeout(function () {
      if (typing && typing.parentNode) typing.parentNode.removeChild(typing);
      chatAppend("ai", reply);
      state.busy = false;
      if (button) button.disabled = false;
      refresh();
      if (input) input.focus();
    }, wait);
  }

  function seed() {
    if (state.seeded) return;
    state.seeded = true;
    chatAppend("ai", "Desk is open. I read the board, the pool and the rulebook — no cloud model behind this curtain.<br>Ask for a rating, a matchup, or a read on a pull. Peaks stay sealed until your core is locked.", now());
  }

  /* ── snapshot / briefing ─────────────────────────────────────────────── */

  function snapshotHTML() {
    var st = appState();
    var r = rating();
    var a = anchor();
    var passive = st.awake ? FB.awakening(st.deck) : null;
    return [
      ["Core", FB.ui.filled() + " / 5"],
      ["Grade", r ? r.grade + " · " + r.rating + "/100" : "Not sealed"],
      ["Anchor", a ? esc(a.card.name) : "—"],
      ["Rerolls", String(st.rerolls)],
      ["Awakening", st.awake ? (passive ? esc(passive.name) : "on · unsynced") : "off"],
      ["Pull tape", FB.ui.state.pulls.length + " draws"]
    ].map(function (row) {
      return '<div class="snap-row"><span>' + row[0] + "</span><b>" + row[1] + "</b></div>";
    }).join("");
  }

  function renderSnapshot() {
    var el = $("#chat-snapshot");
    if (el) el.innerHTML = snapshotHTML();
    var meta = $("#brief-snap-meta");
    if (meta) {
      var r = rating();
      meta.textContent = r ? "Graded " + r.grade : appState().sealed ? "Sealed" : "Fresh session";
    }
    var cells = [
      ["Roster", String(FB.poolCount)],
      ["Slots filed", FB.ui.filled() + " / 5"],
      ["Grade", rating() ? rating().grade : "—"],
      ["Draws", String(appState().pulls.length)]
    ];
    var box = $("#brief-snapshot");
    if (box) {
      box.innerHTML = cells.map(function (c) {
        return '<div class="snap-cell"><small>' + c[0] + "</small><b>" + c[1] + "</b></div>";
      }).join("");
    }
  }

  function renderOdds() {
    var el = $("#brief-odds");
    if (!el) return;
    var total = FB.poolCount;
    el.innerHTML = FB.RARITIES.map(function (r, i) {
      var count = FB.rarityCounts[i];
      return '<div class="odds-row" style="--rar:' + r.color + '">' +
        "<span>" + r.name + "</span>" +
        '<span class="odds-track"><i class="odds-fill" style="width:' + (count / total * 100 / 20 * 100) + '%"></i></span>' +
        "<b>" + (count / total * 100).toFixed(1) + "%</b>" +
      "</div>";
    }).join("");
  }

  function renderSuggestions() {
    var el = $("#chat-suggest");
    if (!el) return;
    var prompts = [
      "Rate my core.",
      "Levi vs Guts — who wins?",
      "Which pull is my anchor?",
      "How do I get a Secret?",
      "Where does a caster belong?"
    ];
    el.innerHTML = prompts.map(function (p) {
      return '<button type="button" data-suggest="' + esc(p) + '">' + p + "</button>";
    }).join("");
  }

  function refresh() {
    renderSnapshot();
  }

  /* ── who wins desk ───────────────────────────────────────────────────── */

  function whoCardHTML(card) {
    if (!card) return '<span class="who-card-empty">No fighter selected.</span>';
    return '<div class="rp-art">' + FB.ui.portraitHTML(card, "portrait-duel") + "</div>" +
      '<div style="min-width:0">' +
        '<div class="rp-fighter-name">' + esc(card.name) + "</div>" +
        '<div class="rp-fighter-series">' + esc(card.series) + "</div>" +
        '<div class="fighter-foot">' +
          '<span class="fighter-rar" style="--rar:' + FB.RARITIES[card.rarity].color + '">' + FB.ui.rarityName(card.rarity) + "</span>" +
          '<span class="fighter-arch">' + esc(card.archLabel) + "</span>" +
        "</div>" +
      "</div>";
  }

  function paintWho() {
    var ca = $("#who-card-a");
    var cb = $("#who-card-b");
    if (ca) ca.innerHTML = whoCardHTML(whoA);
    if (cb) cb.innerHTML = whoCardHTML(whoB);
    FB.ui.hydratePortraits($("#ana-who"));
    var btn = $("#who-fight");
    if (btn) btn.disabled = !(whoA && whoB && whoA.id !== whoB.id);
  }

  function fightWho(quiet) {
    if (!whoA || !whoB || whoA.id === whoB.id) return;
    whoResult = FB.duelOne(whoA, whoB);
    var root = $("#who-result");
    if (!root) return;
    root.innerHTML = FB.ui.duelTable(whoResult, whoA, whoB, {
      labelA: "Red",
      labelB: "Blue",
      actions: '<button class="btn btn-primary" type="button" data-who-action="ask">Ask the desk</button>' +
        '<button class="btn" type="button" data-who-action="swap">Swap corners</button>' +
        '<button class="btn" type="button" data-who-action="random">New pair</button>'
    });
    FB.ui.paintBars(root);
    if (!quiet) refresh();
  }

  function randomPair() {
    var a = FB.pool[Math.floor(Math.random() * FB.poolCount)];
    var b = FB.randomCharacter({ [a.id]: true });
    whoA = a;
    whoB = b;
    if (pickerA) pickerA.set(a);
    if (pickerB) pickerB.set(b);
    paintWho();
    fightWho(true);
  }

  function swapWho() {
    var a = whoA;
    whoA = whoB;
    whoB = a;
    if (pickerA) pickerA.set(whoA || null);
    if (pickerB) pickerB.set(whoB || null);
    paintWho();
    if (whoA && whoB) fightWho(true);
  }

  function clearWho() {
    whoA = null;
    whoB = null;
    whoResult = null;
    if (pickerA) pickerA.clear();
    if (pickerB) pickerB.clear();
    var root = $("#who-result");
    if (root) root.innerHTML = "";
    paintWho();
  }

  /* ── init ────────────────────────────────────────────────────────────── */

  function init() {
    seed();
    renderSuggestions();
    renderOdds();
    refresh();

    var form = $("#chat-form");
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var input = $("#chat-input");
        if (input) send(input.value);
      });
    }

    var suggest = $("#chat-suggest");
    if (suggest) {
      suggest.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-suggest]");
        if (!btn) return;
        send(btn.getAttribute("data-suggest"));
      });
    }

    var log = $("#chat-log");
    if (log) {
      log.addEventListener("click", function (e) {
        var pairBtn = e.target.closest("[data-desk-pair]");
        if (!pairBtn) return;
        var ids = pairBtn.getAttribute("data-desk-pair").split(",").map(Number);
        whoA = FB.characterById(ids[0]);
        whoB = FB.characterById(ids[1]);
        if (pickerA) pickerA.set(whoA || null);
        if (pickerB) pickerB.set(whoB || null);
        paintWho();
        var sub = document.getElementById("subtab-who");
        if (sub) sub.click();
        fightWho(true);
      });
    }

    var hostA = $("#who-picker-a");
    var hostB = $("#who-picker-b");
    if (hostA && FB.mountPicker) {
      pickerA = FB.mountPicker(hostA, {
        placeholder: "Red corner…",
        onPick: function (c) { whoA = c; paintWho(); },
        onClear: function () { whoA = null; paintWho(); }
      });
    }
    if (hostB && FB.mountPicker) {
      pickerB = FB.mountPicker(hostB, {
        placeholder: "Blue corner…",
        onPick: function (c) { whoB = c; paintWho(); },
        onClear: function () { whoB = null; paintWho(); }
      });
    }

    var fight = $("#who-fight");
    if (fight) fight.addEventListener("click", function () { fightWho(false); });

    var actions = document.querySelector(".who-actions");
    if (actions) {
      actions.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-action]");
        if (!btn) return;
        var action = btn.getAttribute("data-action");
        if (action === "who-swap") swapWho();
        else if (action === "who-random") randomPair();
        else if (action === "who-clear") clearWho();
      });
    }

    var result = $("#who-result");
    if (result) {
      result.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-who-action]");
        if (!btn) return;
        var action = btn.getAttribute("data-who-action");
        if (action === "swap") swapWho();
        else if (action === "random") randomPair();
        else if (action === "ask") {
          if (!whoA || !whoB) return;
          var sub = document.getElementById("subtab-main");
          if (sub) sub.click();
          send("Who wins between " + whoA.name + " and " + whoB.name + "?");
        }
      });
    }

    paintWho();
  }

  function enter() {
    seed();
    refresh();
    paintWho();
    var input = $("#chat-input");
    if (input && window.innerWidth > 720) setTimeout(function () { input.focus(); }, 60);
  }

  function subtab(name) {
    state.tab = name;
    if (name === "brief") { renderOdds(); refresh(); }
    if (name === "who") paintWho();
  }

  FB.analyst = {
    init: init,
    enter: enter,
    subtab: subtab,
    refresh: refresh,
    send: send,
    answer: answer
  };
})(window.FB);
