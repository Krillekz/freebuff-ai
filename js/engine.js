/* FreeBuff AI — simulation engine
   Pure random gacha, fixed 5-slot deck, strict rarity/tier ladder. */

(function (FB) {
  "use strict";

  var KEYS = FB.STATS.map(function (s) { return s.key; });
  var TIERS = FB.TIERS;
  var RARITIES = FB.RARITIES;
  var ARCH = FB.ARCHETYPES;

  /* ---------- deterministic helpers ---------- */

  function hash(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  /* The 11 series without a curated champion still get a stable identity
     drawn from the series title itself. */
  function shortHandle(title) {
    var t = title
      .replace(/\([^)]*\)/g, " ")
      .replace(/\s*[:!]\s*(Season\s*\d+|The Movie.*|Movie:.*).*$/i, "")
      .replace(/\s+(Season\s*\d+|The Movie.*)$/i, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    t = t.replace(/^The\s+/i, "");
    return t || title;
  }

  /* ---------- pool construction ---------- */

  var raw = FB.SERIES.map(function (series, i) {
    var c = FB.CURATED[series];
    var name, peak, caliber, fame;
    if (c) {
      name = c[0]; peak = c[1]; caliber = c[2]; fame = c[3];
    } else {
      var h = hash(series);
      name = shortHandle(series);
      peak = KEYS[(h >>> 3) % 5];
      caliber = 3 + ((h >>> 7) % 3);
      fame = 0;
    }
    return {
      index: i,
      series: series,
      name: name,
      peak: peak,
      caliber: caliber,
      fame: fame,
      seed: hash(series + "::" + name)
    };
  });

  /* The authored caliber ladder is relative, so the displayed E → X ladder is
     a percentile cut of the whole 500-character pool. This keeps every tier and
     every rarity band populated instead of stacking the roster at SSS+. */
  /* Friendlier top end: Secret 5%, Divine 8%, Mythical 12%. Still no pity. */
  var CUTS = [25, 40, 60, 75, 85, 85, 65, 40]; // X, SSS+, SSS, SS, S, A, B, C
  var order = raw.slice().sort(function (a, b) {
    return (b.caliber - a.caliber) || (b.fame - a.fame) || (a.seed - b.seed) || (a.index - b.index);
  });

  var tierByPos = new Array(order.length);
  var pos = 0;
  for (var ti = 8; ti >= 1; ti--) {
    var count = CUTS[8 - ti];
    for (var k = 0; k < count && pos < order.length; k++) tierByPos[pos++] = ti;
  }
  while (pos < order.length) tierByPos[pos++] = 0;

  var RARITY_BY_TIER = [0, 0, 1, 2, 3, 4, 5, 6, 7];

  var POOL = order.map(function (c, p) {
    var tier = tierByPos[p];
    var arch = FB.STAT_ARCHETYPE[c.peak];
    var offs = ARCH[arch];
    var others = KEYS.filter(function (key) { return key !== c.peak; });
    var weak = others[(c.seed >>> 13) % others.length];
    var tiers = {};
    KEYS.forEach(function (key) {
      var off = offs[key] - (key === weak ? 1 : 0);
      tiers[key] = clamp(tier + off, 0, 8);
    });
    tiers[c.peak] = tier;

    /* Card profile: trap slots are the placements that would evaluate as E. */
    var traps = 0;
    var second = 0;
    others.forEach(function (key) {
      if (tier >= 5 && (tier - tiers[key]) >= 3) traps++;
      if (tiers[key] > second) second = tiers[key];
    });
    var low = Math.min.apply(null, KEYS.map(function (key) { return tiers[key]; }));
    var trait = traps >= 2 ? "HIGH RISK"
      : (tier - second) >= 2 ? "SPECIALIST"
      : (tier - low) <= 2 ? "ALL-ROUNDER"
      : "HYBRID";

    return {
      id: c.index + 1,
      series: c.series,
      name: c.name,
      peak: c.peak,
      arch: arch,
      archLabel: FB.ARCHETYPE_LABEL[arch],
      weak: weak,
      rarity: RARITY_BY_TIER[tier],
      tier: tier,
      tiers: tiers,
      traps: traps,
      trait: trait,
      signature: FB.SIGNATURES[c.name] || null,
      seed: c.seed
    };
  });

  var BY_ID = {};
  POOL.forEach(function (c) { BY_ID[c.id] = c; });

  /* ---------- host modes: series-only live pools ---------- */

  var MODE_BY_SERIES = {};
  var MODE_BY_ID = {};
  var MODE_CARDS = [];
  var modeSeq = 1000;

  Object.keys(FB.MODE_ROSTERS || {}).forEach(function (series) {
    var cards = [];
    var champion = null;
    for (var ci = 0; ci < POOL.length; ci++) {
      if (POOL[ci].series === series) { champion = POOL[ci]; break; }
    }
    if (champion) cards.push(champion);

    (FB.MODE_ROSTERS[series] || []).forEach(function (row) {
      var name = row[0];
      var peak = row[1];
      var tier = clamp(Math.round(Number(row[2]) || 5), 0, 8);
      var sig = row[3] || FB.SIGNATURES[name] || null;
      var arch = FB.STAT_ARCHETYPE[peak];
      var offs = ARCH[arch];
      var seed = hash(series + "::" + name + "::mode");
      var others = KEYS.filter(function (key) { return key !== peak; });
      var weak = others[(seed >>> 13) % others.length];
      var tiers = {};
      KEYS.forEach(function (key) {
        var off = offs[key] - (key === weak ? 1 : 0);
        tiers[key] = clamp(tier + off, 0, 8);
      });
      tiers[peak] = tier;

      var traps = 0;
      var second = 0;
      others.forEach(function (key) {
        if (tier >= 5 && (tier - tiers[key]) >= 3) traps++;
        if (tiers[key] > second) second = tiers[key];
      });
      var low = Math.min.apply(null, KEYS.map(function (key) { return tiers[key]; }));
      var trait = traps >= 2 ? "HIGH RISK"
        : (tier - second) >= 2 ? "SPECIALIST"
        : (tier - low) <= 2 ? "ALL-ROUNDER"
        : "HYBRID";

      MODE_CARDS.push({
        id: ++modeSeq,
        series: series,
        name: name,
        peak: peak,
        arch: arch,
        archLabel: FB.ARCHETYPE_LABEL[arch],
        weak: weak,
        rarity: RARITY_BY_TIER[tier],
        tier: tier,
        tiers: tiers,
        traps: traps,
        trait: trait,
        signature: sig,
        seed: seed
      });
      cards.push(MODE_CARDS[MODE_CARDS.length - 1]);
    });

    if (cards.length) MODE_BY_SERIES[series] = cards;
    cards.forEach(function (c) { MODE_BY_ID[c.id] = c; });
  });

  FB.modePools = MODE_BY_SERIES;
  FB.modeCards = MODE_CARDS;
  FB.modePool = function (series) { return MODE_BY_SERIES[series] || null; };
  FB.modeCharacterById = function (id) { return MODE_BY_ID[id] || BY_ID[id] || null; };
  FB.lookupCharacter = function (id) { return BY_ID[id] || MODE_BY_ID[id] || null; };
  FB.MODES = Object.keys(MODE_BY_SERIES).filter(function (series) {
    return MODE_BY_SERIES[series].length >= 5;
  }).map(function (series) {
    return { series: series, label: series + " only", count: MODE_BY_SERIES[series].length };
  });

  /* ---------- public: pool + gacha ---------- */

  FB.pool = POOL;
  FB.poolCount = POOL.length;
  FB.rarityCounts = RARITIES.map(function (_, r) {
    return POOL.filter(function (c) { return c.rarity === r; }).length;
  });

  FB.randomCharacter = function (excludeIds) {
    var skip = excludeIds || {};
    for (var attempt = 0; attempt < 60; attempt++) {
      var c = POOL[Math.floor(Math.random() * POOL.length)];
      if (!skip[c.id]) return c;
    }
    return POOL[Math.floor(Math.random() * POOL.length)];
  };

  /* ---------- scoring ---------- */

  function rarityOf(c) { return RARITIES[c.rarity]; }

  /**
   * Score one slot. `mods` carries { awake, passive }.
   * - Perfect placement (canonical peak attribute) appends * and multiplies hard.
   * - Off-meta placement (<under 50>) is capped regardless of rarity.
   */
  FB.scoreSlot = function (char, key, mods) {
    var awake = !!(mods && mods.awake);
    var passive = mods && mods.passive;
    var base = char.tiers[key];
    var peakBase = char.tiers[char.peak];
    var idx = base;
    if (awake && passive === key) idx = Math.min(8, idx + 1);

    var perfect = char.peak === key;
    var mismatch = peakBase >= 5 && (peakBase - base) >= 3;

    var value = TIERS[idx].value * rarityOf(char).mult;
    if (perfect) value *= FB.PERFECT_MULT;
    if (awake) value *= FB.AWAKEN_MULT;
    /* Off-meta placement is not a soft cap: the slot evaluates strictly as an
       E rank value in both the deck total and the Tab 2 comparison. */
    if (mismatch) value = TIERS[0].value;

    value = Math.round(value);
    return {
      key: key,
      tierIdx: idx,
      baseTierIdx: base,
      tierLabel: TIERS[idx].label,
      star: perfect,
      perfect: perfect,
      mismatch: mismatch,
      value: value,
      rank: mismatch ? 0 : idx
    };
  };

  FB.slotScores = function (deck, mods) {
    return deck.map(function (c, i) {
      return c ? FB.scoreSlot(c, KEYS[i], mods) : null;
    });
  };

  FB.deckTotal = function (deck, mods) {
    return FB.slotScores(deck, mods).reduce(function (sum, s) {
      return sum + (s ? s.value : 0);
    }, 0);
  };

  /** One awakening buff, keyed to the deck's dominant attribute. */
  FB.dominantStat = function (deck) {
    var best = null, bestCount = -1, bestRarity = -1;
    KEYS.forEach(function (key) {
      var members = deck.filter(function (c) { return c && c.peak === key; });
      if (!members.length) return;
      var rarity = members.reduce(function (m, c) { return Math.max(m, c.rarity); }, -1);
      if (members.length > bestCount || (members.length === bestCount && rarity > bestRarity)) {
        best = key; bestCount = members.length; bestRarity = rarity;
      }
    });
    return best;
  };

  FB.awakening = function (deck) {
    var key = FB.dominantStat(deck);
    return key ? FB.AWAKENING[key] : null;
  };

  /* ---------- AI opponent ---------- */

  FB.buildAiDeck = function () {
    var picked = [], used = {}, deck = [null, null, null, null, null];
    while (picked.length < 5) {
      var c = FB.randomCharacter(used);
      used[c.id] = true;
      picked.push(c);
    }
    var slots = [0, 1, 2, 3, 4];
    for (var i = slots.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = slots[i]; slots[i] = slots[j]; slots[j] = tmp;
    }
    slots.forEach(function (slot) {
      var key = KEYS[slot];
      var pickAt = -1;
      for (var i = 0; i < picked.length; i++) {
        if (picked[i].peak === key) { pickAt = i; break; }
      }
      /* The core lines its peak up 72% of the time; otherwise it takes the
         strongest remaining card for the slot instead of sabotaging itself. */
      if (pickAt < 0 || Math.random() > 0.72) {
        pickAt = 0;
        for (var b = 1; b < picked.length; b++) {
          if (FB.scoreSlot(picked[b], key, null).value > FB.scoreSlot(picked[pickAt], key, null).value) pickAt = b;
        }
      }
      deck[slot] = picked.splice(pickAt, 1)[0];
    });
    return deck;
  };

  /* ---------- matchup ---------- */

  FB.matchup = function (userDeck, aiDeck, awake) {
    var passive = awake ? FB.dominantStat(userDeck) : null;
    var mods = { awake: !!awake, passive: passive };
    var rows = KEYS.map(function (key, i) {
      var u = FB.scoreSlot(userDeck[i], key, mods);
      var a = FB.scoreSlot(aiDeck[i], key, null);
      var winner;
      if (u.rank !== a.rank) winner = u.rank > a.rank ? "user" : "ai";
      /* A penalised slot never beats even an E-rank opponent: the demotion carries
         the automatic mechanical disadvantage described by the rules. */
      else if (u.mismatch !== a.mismatch) winner = u.mismatch ? "ai" : "user";
      else if (u.star !== a.star) winner = u.star ? "user" : "ai";
      else if (u.value !== a.value) winner = u.value > a.value ? "user" : "ai";
      else winner = "tie";
      return { key: key, stat: FB.STATS[i], user: u, ai: a, winner: winner };
    });

    var userTotal = rows.reduce(function (s, r) { return s + r.user.value; }, 0);
    var aiTotal = rows.reduce(function (s, r) { return s + r.ai.value; }, 0);
    var userPoints = rows.filter(function (r) { return r.winner === "user"; }).length;
    var aiPoints = rows.filter(function (r) { return r.winner === "ai"; }).length;

    var verdict = "draw";
    if (userTotal > aiTotal) verdict = "user";
    else if (aiTotal > userTotal) verdict = "ai";

    return {
      rows: rows,
      userTotal: userTotal,
      aiTotal: aiTotal,
      userPoints: userPoints,
      aiPoints: aiPoints,
      verdict: verdict,
      passive: passive,
      awakening: passive ? FB.AWAKENING[passive] : null,
      userPeaks: userDeck.filter(function (c, i) { return c && c.peak === KEYS[i]; }).length,
      aiPeaks: aiDeck.filter(function (c, i) { return c && c.peak === KEYS[i]; }).length
    };
  };

  /* ---------- single-fighter duel (1v1 AI + live rooms) ---------- */

  FB.duelOne = function (a, b) {
    var rows = KEYS.map(function (key, i) {
      var sa = FB.scoreSlot(a, key, null);
      var sb = FB.scoreSlot(b, key, null);
      var winner;
      if (sa.rank !== sb.rank) winner = sa.rank > sb.rank ? "a" : "b";
      else if (sa.mismatch !== sb.mismatch) winner = sa.mismatch ? "b" : "a";
      else if (sa.star !== sb.star) winner = sa.star ? "a" : "b";
      else if (sa.value !== sb.value) winner = sa.value > sb.value ? "a" : "b";
      else winner = "tie";
      return { key: key, stat: FB.STATS[i], a: sa, b: sb, winner: winner };
    });

    var aTotal = rows.reduce(function (s, r) { return s + r.a.value; }, 0);
    var bTotal = rows.reduce(function (s, r) { return s + r.b.value; }, 0);
    var aPoints = rows.filter(function (r) { return r.winner === "a"; }).length;
    var bPoints = rows.filter(function (r) { return r.winner === "b"; }).length;

    return {
      rows: rows,
      aTotal: aTotal,
      bTotal: bTotal,
      aPoints: aPoints,
      bPoints: bPoints,
      verdict: aTotal > bTotal ? "a" : bTotal > aTotal ? "b" : "draw"
    };
  };

  /* ---------- shared helpers ---------- */

  FB.KEYS = KEYS;
  FB.hash = hash;
  FB.rng = mulberry32;
  FB.rarityOf = rarityOf;
  FB.characterById = function (id) { return BY_ID[id]; };
})(window.FB = window.FB || {});
