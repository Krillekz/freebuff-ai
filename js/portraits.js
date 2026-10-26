/* FreeBuff AI — character portrait resolver
   AniList search is used on demand (only for cards actually on screen), matched
   against the roster series, then cached in localStorage. Any miss or offline
   error simply leaves the printed crest in place. */

(function (FB) {
  "use strict";

  var KEY = "fb.portraits.v4";
  var store = {};
  try { store = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { store = {}; }

  var subs = [];
  var queue = [];
  var busy = false;
  var lastAt = 0;
  var GAP = 850;
  /* Jikan is a useful second source but it goes down regularly. Once a request
     fails at the transport level, stop paying its timeout for every card. */
  var jikanDownUntil = 0;

  function norm(v) {
    return String(v || "").toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ").trim();
  }

  function words(v) {
    return norm(v).split(" ").filter(function (t) { return t.length > 2; });
  }

  /* AniList romanises long vowels as "Yuuji" / "Touji" / "Gojou"; roster
     spellings use "Yuji" / "Toji" / "Gojo". Collapse both to one form. */
  function loose(v) {
    return norm(v)
      .replace(/([aeiou])\1+/g, "$1")
      .replace(/ou/g, "o");
  }

  function coreTitle(v) {
    return String(v || "")
      .split(/[:(/]/)[0]
      .replace(/\bseason\s*\d+\b/gi, "")
      .replace(/\bthe movie\b/gi, "")
      .replace(/\bova\b/gi, "")
      .trim();
  }

  function overlap(a, b) {
    var A = words(coreTitle(a));
    var B = words(coreTitle(b));
    if (!A.length || !B.length) return 0;
    var hits = 0;
    A.forEach(function (t) {
      var hit = B.some(function (u) { return u === t || u.indexOf(t) >= 0 || t.indexOf(u) >= 0; });
      if (hit) hits++;
    });
    return hits / Math.max(A.length, B.length);
  }

  function matchScore(cand, char) {
    var candName = loose(cand.name && cand.name.full);
    var want = loose(char.name);
    var nameHit = 0;
    var score = 0;

    if (candName && candName === want) { nameHit = 2; score += 6; }
    else if (candName && want && (candName.indexOf(want) >= 0 || want.indexOf(candName) >= 0)) { nameHit = 1; score += 3; }
    else {
      var a = words(cand.name && cand.name.full);
      var b = words(char.name);
      if (a.length && b.length && a[a.length - 1] === b[b.length - 1]) score += 2;
    }

    var media = (cand.media && cand.media.nodes) || [];
    var best = 0;
    media.forEach(function (m) {
      var t = m.title || {};
      [t.romaji, t.english, t.native].forEach(function (title) {
        var o = overlap(title, char.series);
        if (o > best) best = o;
      });
    });
    return { score: score + best * 5, nameHit: nameHit, series: best };
  }

  /* Combined handles ("Sora & Shiro") rarely exist as a single AniList entry.
     Try the full handle, then the lead name, and only accept a partial-name hit
     when the candidate is actually from the same series. */
  function queriesFor(char) {
    var out = [char.name];
    var lead = String(char.name).split(/\s*(?:&|\/|\band\b)\s*/)[0].trim();
    if (lead && lead !== char.name) out.push(lead);
    return out;
  }

  function notify() {
    subs.forEach(function (fn) { try { fn(store); } catch (e) { /* ignore */ } });
  }

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* storage may be blocked */ }
  }

  /* A dead lookup must not hold the serial portrait queue hostage. Every
     request gets a hard ceiling, so a row falls through to its fallback. */
  function timedFetch(url, options, ms) {
    if (typeof AbortController !== "function") return fetch(url, options);
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, ms || 5000);
    var opts = Object.assign({}, options, { signal: controller.signal });
    return fetch(url, opts).then(function (res) {
      clearTimeout(timer);
      return res;
    }, function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  function search(name) {
    var query = "query($s:String){Page(perPage:8){characters(search:$s){name{full}image{large medium}siteUrl media(perPage:6){nodes{title{romaji english native}}}}}}";
    return timedFetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: query, variables: { s: name } })
    })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (json) {
        return (json && json.data && json.data.Page && json.data.Page.characters) || [];
      });
  }

  /* Jikan (MyAnimeList) is the second character source. It catches spelling
     variants and older/one-off characters AniList's search misses. */
  function searchJikan(name) {
    return timedFetch("https://api.jikan.moe/v4/characters?q=" + encodeURIComponent(name) + "&limit=6&order_by=favorites&sort=desc", null, 2500)
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (json) {
        return (json && json.data) || [];
      })
      .then(function (list) {
        return list.map(function (c) {
          var titles = [];
          (c.anime || []).forEach(function (a) {
            if (a && a.anime && a.anime.title) titles.push({ title: { romaji: a.anime.title, english: a.anime.title } });
          });
          return {
            name: { full: c.name },
            image: { large: c.images && c.images.jpg && c.images.jpg.image_url },
            siteUrl: c.url || null,
            media: { nodes: titles }
          };
        });
      });
  }

  /* Search the series' AniList cast directly. This catches romanisation gaps
     in the character endpoint ("Yuji" vs "Yuuji") and supporting characters. */
  function seriesCast(series) {
    var query = "query($s:String){Page(perPage:1){media(search:$s,type:ANIME,sort:SEARCH_MATCH){characters(perPage:25){nodes{name{full}image{large}siteUrl media(perPage:4){nodes{title{romaji english native}}}}}}}}";
    return timedFetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: query, variables: { s: series } })
    })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (json) {
        var media = json && json.data && json.data.Page && json.data.Page.media;
        var node = media && media[0];
        var chars = node && node.characters && node.characters.nodes;
        return chars || [];
      });
  }

  /* Last visual fallback: the series key art. A card never stays blank just
     because the character lookup could not be confirmed. */
  function seriesCover(series) {
    var query = "query($s:String){Page(perPage:4){media(search:$s,type:ANIME,sort:SEARCH_MATCH){bannerImage coverImage{extraLarge}}}}";
    return timedFetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: query, variables: { s: series } })
    })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (json) {
        var list = (json && json.data && json.data.Page && json.data.Page.media) || [];
        for (var i = 0; i < list.length; i++) {
          var m = list[i];
          if (m.bannerImage) return m.bannerImage;
          if (m.coverImage && m.coverImage.extraLarge) return m.coverImage.extraLarge;
        }
        throw new Error("no series art");
      });
  }

  function pick(list, char) {
    var best = null;
    var bestEval = null;
    list.forEach(function (cand) {
      var ev = matchScore(cand, char);
      if (!bestEval || ev.score > bestEval.score) { bestEval = ev; best = cand; }
    });
    if (!best || !bestEval) return null;
    /* A confident hit must agree on the series as well as the name. Without
       that, a common name like "Aura" or "King" would borrow a stranger's
       face from a different franchise. */
    var confident = (bestEval.nameHit === 2 && bestEval.series >= 0.24) ||
      (bestEval.nameHit === 1 && bestEval.series >= 0.3);
    return confident ? { cand: best, ev: bestEval } : null;
  }

  function fetchOne(char) {
    busy = true;
    var names = queriesFor(char);

    function attemptAniList(i) {
      if (i >= names.length) return Promise.reject(new Error("no anilist match"));
      return search(names[i]).then(function (list) {
        var hit = pick(list, char);
        return hit ? { cand: hit.cand, ev: hit.ev } : attemptAniList(i + 1);
      });
    }

    function attemptJikan(i) {
      if (i >= names.length) return Promise.reject(new Error("no jikan match"));
      if (Date.now() < jikanDownUntil) return Promise.reject(new Error("jikan cooling down"));
      return searchJikan(names[i]).catch(function (err) {
        jikanDownUntil = Date.now() + 10 * 60 * 1000;
        throw err;
      }).then(function (list) {
        var hit = pick(list, char);
        return hit ? { cand: hit.cand, ev: hit.ev } : attemptJikan(i + 1);
      });
    }

    function attemptCast() {
      return seriesCast(char.series).then(function (list) {
        var hit = pick(list, char);
        if (!hit) throw new Error("no cast match");
        return { cand: hit.cand, ev: hit.ev };
      });
    }

    /* AniList is fast and reliable; the series cast catches romanisation gaps.
       Jikan is the spelling/legacy net, tried only after both, so its frequent
       timeouts cannot stall the queue for every card. */
    attemptAniList(0)
      .catch(attemptCast)
      .catch(function () { return attemptJikan(0); })
      .then(function (hit) {
        var image = hit.cand.image && (hit.cand.image.large || hit.cand.image.medium);
        if (!image) throw new Error("no image");
        store[char.id] = {
          url: image,
          page: hit.cand.siteUrl || null,
          match: hit.cand.name && hit.cand.name.full,
          score: Math.round(hit.ev.score),
          at: Date.now()
        };
        persist();
        notify();
      })
      .catch(function () {
        return seriesCover(char.series).then(function (url) {
          store[char.id] = {
            url: url,
            page: null,
            match: char.series,
            fallback: "series",
            at: Date.now()
          };
          persist();
          notify();
        }).catch(function () {
          store[char.id] = { fail: true, at: Date.now() };
          persist();
          notify();
        });
      })
      .then(function () {
        setTimeout(function () { busy = false; pump(); }, GAP);
      });
  }

  function pump() {
    if (busy || !queue.length) return;
    var wait = Math.max(0, GAP - (Date.now() - lastAt));
    if (wait > 0) { setTimeout(pump, wait); return; }

    var char = queue.shift();
    var entry = store[char.id];
    if (entry) {
      if (entry.url && !entry.fallback) return pump();
      if (entry.fallback && Date.now() - entry.at < 6 * 60 * 60 * 1000) return pump();
      if (entry.fail && Date.now() - entry.at < 60000) return pump();
    }
    lastAt = Date.now();
    fetchOne(char);
  }

  FB.portraits = {
    get: function (id) { return store[id] || null; },
    request: function (char, priority) {
      if (!char || !char.id) return;
      var entry = store[char.id];
      if (entry && entry.url && !entry.fallback) return;
      if (entry && entry.fallback && Date.now() - entry.at < 6 * 60 * 60 * 1000) return;
      if (entry && entry.fail && Date.now() - entry.at < 60000) return;
      var at = queue.findIndex(function (c) { return c.id === char.id; });
      if (at >= 0) {
        if (priority && at > 0) queue.unshift(queue.splice(at, 1)[0]);
        return;
      }
      if (priority) queue.unshift(char);
      else queue.push(char);
      pump();
    },
    retry: function (id) {
      var entry = store[id];
      if (!entry) return;
      delete store[id];
      persist();
    },
    subscribe: function (fn) { if (typeof fn === "function") subs.push(fn); },
    store: store
  };
})(window.FB = window.FB || {});
