/* FreeBuff AI — deck rating
   Scores a sealed five-slot deck against a deterministic peak-built benchmark. */

(function (FB) {
  "use strict";

  var KEYS = FB.KEYS;
  var S = FB.STATS;
  var T = FB.TIERS;
  var R = FB.RARITIES;

  var benchCache = null;

  function peakDeck(rnd) {
    var picked = [];
    var used = {};
    while (picked.length < 5) {
      var c = FB.pool[Math.floor(rnd() * FB.poolCount)];
      if (used[c.id]) continue;
      used[c.id] = true;
      picked.push(c);
    }
    var deck = [null, null, null, null, null];
    picked.forEach(function (card) {
      var slot = KEYS.indexOf(card.peak);
      if (deck[slot]) {
        slot = -1;
        for (var i = 0; i < 5; i++) {
          if (!deck[i]) {
            if (slot < 0 || FB.scoreSlot(card, KEYS[i], null).value > FB.scoreSlot(card, KEYS[slot], null).value) slot = i;
          }
        }
      }
      deck[slot] = card;
    });
    return FB.deckTotal(deck, null);
  }

  function benchmark() {
    if (benchCache) return benchCache;
    var rnd = FB.rng(0x51f7c0de);
    var totals = [];
    for (var i = 0; i < 800; i++) totals.push(peakDeck(rnd));
    totals.sort(function (a, b) { return a - b; });
    benchCache = totals;
    return totals;
  }

  function percentile(total) {
    var totals = benchmark();
    var lo = 0, hi = totals.length;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (totals[mid] < total) lo = mid + 1;
      else hi = mid;
    }
    return Math.round((lo / totals.length) * 100);
  }

  FB.rateDeck = function (deck, mods) {
    var filled = deck.filter(Boolean).length;
    var scores = FB.slotScores(deck, mods);
    var total = scores.reduce(function (s, v) { return s + (v ? v.value : 0); }, 0);
    var peaks = scores.filter(function (v) { return v && v.star; }).length;
    var offMeta = scores.filter(function (v) { return v && v.mismatch; }).length;

    var rarityCounts = R.map(function (_, i) {
      return deck.filter(function (c) { return c && c.rarity === i; }).length;
    });
    var rarityAvg = deck.reduce(function (sum, c) { return sum + (c ? c.rarity : 0); }, 0) / Math.max(1, filled);
    var rarityScore = Math.round((rarityAvg / 7) * 100);
    var outputScore = Math.min(100, Math.round((total / 360) * 100));
    var peakScore = filled ? Math.round((peaks / filled) * 100) : 0;
    var rating = filled ? Math.round(outputScore * 0.55 + peakScore * 0.3 + rarityScore * 0.15) : 0;

    var grade = rating >= 92 ? "S" : rating >= 84 ? "A" : rating >= 73 ? "B" : rating >= 63 ? "C" : rating >= 53 ? "D" : "E";
    var gradeLine = {
      S: "Broadcast gold. This deck is a headline.",
      A: "Contender. One clean adjustment from elite.",
      B: "Solid card. The ceiling is there, the details are not.",
      C: "Mid-card. Canon accuracy is leaving points on the table.",
      D: "Preliminary bout. The slots are fighting the placements.",
      E: "Open call. Rebuild the desk."
    }[grade];

    var slots = S.map(function (stat, i) {
      var c = deck[i];
      var sc = scores[i];
      return {
        slot: stat.label,
        code: stat.code,
        icon: stat.icon,
        card: c || null,
        score: sc,
        verdict: !sc ? "empty" : sc.mismatch ? "penalised" : sc.star ? "peak" : "clean"
      };
    });

    var canon = deck.map(function (c, i) {
      if (!c) return null;
      return {
        slot: S[i].label,
        name: c.name,
        peak: S[KEYS.indexOf(c.peak)].label,
        matched: c.peak === KEYS[i],
        mismatch: !!scores[i].mismatch,
        rank: T[scores[i].rank].label + (scores[i].star ? "*" : ""),
        value: scores[i].value
      };
    }).filter(Boolean);

    var strengths = [];
    var concerns = [];

    var best = slots.filter(function (s) { return s.card; }).sort(function (a, b) { return b.score.value - a.score.value; })[0];
    var worst = slots.filter(function (s) { return s.card; }).sort(function (a, b) { return a.score.value - b.score.value; })[0];

    if (best) strengths.push(best.card.name + " at " + best.slot + " is the anchor — " + best.score.value + " output.");
    if (peaks >= 4) strengths.push(peaks + " of 5 placements hit the canonical peak.");
    if (rarityCounts[5] + rarityCounts[6] + rarityCounts[7] >= 2) strengths.push("Multiple Mythical-or-better pulls in the deck.");
    if (total >= 300) strengths.push("Raw output is main-event calibre.");

    if (offMeta) concerns.push(offMeta + " placement" + (offMeta > 1 ? "s" : "") + " collapsed to E — the largest source of lost output.");
    if (peaks <= 2) concerns.push("Only " + peaks + " peak placement" + (peaks === 1 ? "" : "s") + "; the canon read is costing points.");
    if (rarityCounts[5] + rarityCounts[6] + rarityCounts[7] === 0) concerns.push("No Mythical-or-better card in the five.");
    if (worst) concerns.push(worst.slot + " is the soft slot at " + worst.score.value + " output.");
    if (!concerns.length) concerns.push("No structural weakness detected. This is a clean sheet.");

    return {
      filled: filled,
      complete: filled === 5,
      total: total,
      peaks: peaks,
      offMeta: offMeta,
      rating: rating,
      grade: grade,
      gradeLine: gradeLine,
      percentile: filled ? percentile(total) : 0,
      subs: [
        { label: "Output", value: outputScore, note: total + " pwr" },
        { label: "Canon", value: peakScore, note: peaks + " / " + filled + " peaks" },
        { label: "Rarity", value: rarityScore, note: "avg " + rarityAvg.toFixed(1) + " / 7" }
      ],
      slots: slots,
      canon: canon,
      rarityCounts: rarityCounts,
      strengths: strengths,
      concerns: concerns
    };
  };

  FB.benchmarkPercentile = percentile;
})(window.FB = window.FB || {});
