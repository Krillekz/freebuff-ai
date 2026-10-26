/* FreeBuff AI — character searcher
   A scouting overlay over every card on file: the 500-series champion roster
   plus the 118 series-pool fighters. Canon is sealed by default, matching the
   draft card, and can be revealed deliberately per fighter. */

(function (FB) {
  "use strict";

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  var state = {
    open: false,
    query: "",
    source: "all",
    results: [],
    total: 0,
    note: "",
    selectedId: null,
    canon: false,
    lastFocus: null
  };

  var INDEX = [];
  var COUNTS = { all: 0, main: 0, pool: 0 };
  var els = {};
  var rowObserver = null;
  var rowLoadTimer = null;

  function esc(v) {
    return String(v).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function pad(id) {
    return String(id).padStart(id > 999 ? 4 : 3, "0");
  }

  function norm(v) {
    return String(v || "").toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ").trim();
  }

  /* "Yuuji" / "Yuji", "Touji" / "Toji", "Gojou" / "Gojo". */
  function loose(v) {
    return norm(v).replace(/([aeiou])\1+/g, "$1").replace(/ou/g, "o");
  }

  function sourceOf(card) {
    return card.id > 500 ? "pool" : "main";
  }

  function sourceLabel(card) {
    return sourceOf(card) === "pool" ? "Series pool" : "Main roster";
  }

  function rarityColor(card) {
    return FB.RARITIES[card.rarity] ? FB.RARITIES[card.rarity].color : "#9aa2ac";
  }

  function isTyping(el) {
    var tag = el && el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!(el && el.isContentEditable);
  }

  function sourceAllowed(card) {
    return state.source === "all" || sourceOf(card) === state.source;
  }

  function searchScore(card, q, lq) {
    var name = norm(card.name);
    var series = norm(card.series);
    var sig = card.signature ? norm(card.signature) : "";
    var lname = loose(card.name);
    var lseries = loose(card.series);

    if (name === q || lname === lq) return 0;
    if (name.indexOf(q) === 0 || (lq && lname.indexOf(lq) === 0)) return 1;
    if (series === q || lseries === lq) return 2;
    if (series.indexOf(q) === 0 || (lq && lseries.indexOf(lq) === 0)) return 3;
    if (name.indexOf(q) >= 0 || (lq && lname.indexOf(lq) >= 0)) return 4;
    if (series.indexOf(q) >= 0 || (lq && lseries.indexOf(lq) >= 0)) return 5;
    if (sig.indexOf(q) >= 0) return 6;
    return 9;
  }

  function build() {
    var seen = {};
    function take(list) {
      (list || []).forEach(function (card) {
        if (!card || !card.id || seen[card.id]) return;
        seen[card.id] = 1;
        INDEX.push(card);
      });
    }
    take(FB.pool);
    take(FB.modeCards);
    INDEX.sort(function (a, b) { return a.name.localeCompare(b.name); });

    COUNTS.all = INDEX.length;
    COUNTS.main = INDEX.filter(function (c) { return sourceOf(c) === "main"; }).length;
    COUNTS.pool = COUNTS.all - COUNTS.main;
  }

  function compute() {
    var pool = INDEX.filter(sourceAllowed);

    if (!state.query) {
      state.total = pool.length;
      state.results = pool.slice().sort(function (a, b) {
        return b.rarity - a.rarity || a.name.localeCompare(b.name);
      }).slice(0, 24);
      state.note = "Featured · highest rarity";
    } else {
      var q = norm(state.query);
      var lq = loose(state.query);
      if (!q && !lq) {
        state.total = 0;
        state.results = [];
        state.note = "No match";
      } else {
        var hits = [];
        pool.forEach(function (card) {
          var score = searchScore(card, q, lq);
          if (score < 9) hits.push({ card: card, score: score });
        });
        hits.sort(function (a, b) {
          return a.score - b.score || a.card.name.localeCompare(b.card.name);
        });
        state.total = hits.length;
        state.results = hits.slice(0, 36).map(function (hit) { return hit.card; });
        state.note = hits.length
          ? hits.length > 36
            ? "Top 36 of " + hits.length + " · refine to narrow"
            : "Search results"
          : "No match";
      }
    }

    var keep = state.selectedId && state.results.some(function (c) { return c.id === state.selectedId; });
    if (!keep) {
      state.selectedId = state.results.length ? state.results[0].id : null;
      state.canon = false;
    }
  }

  function selected() {
    if (!state.selectedId) return null;
    for (var i = 0; i < INDEX.length; i++) {
      if (INDEX[i].id === state.selectedId) return INDEX[i];
    }
    return null;
  }

  function renderFilters() {
    $$(".find-filter").forEach(function (btn) {
      var on = btn.getAttribute("data-find-source") === state.source;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    var main = $(".find-filter[data-find-source='main'] i");
    if (main) main.textContent = COUNTS.main;
    var pool = $(".find-filter[data-find-source='pool'] i");
    if (pool) pool.textContent = COUNTS.pool;
    var all = $(".find-filter[data-find-source='all'] i");
    if (all) all.textContent = COUNTS.all;
  }

  function renderResults() {
    if (!els.results) return;
    if (!state.results.length) {
      els.results.innerHTML = '<div class="find-empty">' +
        '<b>No fighter on file.</b>' +
        '<p class="micro">Try a character name, a series title, or a signature move. The index holds every champion and every series-pool fighter.</p>' +
      "</div>";
      return;
    }

    els.results.innerHTML = state.results.map(function (c) {
      var active = c.id === state.selectedId;
      return '<button type="button" class="find-row' + (active ? " is-active" : "") + '"' +
        (active ? ' aria-current="true"' : "") + ' data-find-id="' + c.id + '"' +
        ' style="--rar:' + rarityColor(c) + '">' +
        '<span class="find-row-art">' + FB.ui.portraitHTML(c, "portrait-find", false, true) + "</span>" +
        '<span class="find-row-main">' +
          '<b class="find-row-name">' + esc(c.name) + "</b>" +
          '<span class="find-row-series">' + esc(c.series) + " · " + sourceLabel(c) + "</span>" +
        "</span>" +
        '<span class="find-row-rar">' + FB.ui.rarityName(c.rarity) + "</span>" +
      "</button>";
    }).join("");

    FB.ui.hydratePortraits(els.results);
    observeRows();
  }

  /* Request card art only for rows that are actually on screen. A broad query
     can match 36 cards at once; resolving all of them would flood the portrait
     queue and the external lookup APIs. */
  function observeRows() {
    if (rowObserver) { rowObserver.disconnect(); rowObserver = null; }
    if (!els.results) return;
    var boxes = Array.prototype.slice.call(els.results.querySelectorAll(".find-row-art .portrait"));
    if (!boxes.length) return;

    function load(box) {
      var id = Number(box.getAttribute("data-portrait-id"));
      var card = FB.lookupCharacter ? FB.lookupCharacter(id) : FB.characterById(id);
      if (card && FB.portraits) FB.portraits.request(card);
    }

    /* Fill the first screen without waiting for the observer. This also covers
       browsers/tabs where intersection callbacks are suppressed, and keeps a
       fast typist from queuing art for every intermediate result set. */
    if (rowLoadTimer) clearTimeout(rowLoadTimer);
    rowLoadTimer = setTimeout(function () {
      if (!els.results) return;
      var live = Array.prototype.slice.call(els.results.querySelectorAll(".find-row-art .portrait"));
      live.slice(0, 8).forEach(load);
    }, 180);

    if (!("IntersectionObserver" in window)) return;

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting || !entry.target.isConnected) return;
        observer.unobserve(entry.target);
        load(entry.target);
      });
    }, { root: els.results, rootMargin: "120px 0px" });
    rowObserver = observer;

    boxes.forEach(function (box) { observer.observe(box); });
  }

  function markActive() {
    if (!els.results) return;
    $$(".find-row", els.results).forEach(function (row) {
      var on = Number(row.getAttribute("data-find-id")) === state.selectedId;
      row.classList.toggle("is-active", on);
      if (on) row.setAttribute("aria-current", "true");
      else row.removeAttribute("aria-current");
    });
  }

  function tierMarkup(card) {
    return FB.STATS.map(function (stat, i) {
      var key = stat.key;
      var tier = card.tiers[key];
      var isPeak = card.peak === key;
      var trap = !isPeak && card.tiers[card.peak] >= 5 && (card.tiers[card.peak] - tier) >= 3;
      return '<div class="find-stat' + (isPeak ? " is-peak" : trap ? " is-trap" : "") + '">' +
        '<span class="find-stat-name"><span aria-hidden="true">' + stat.icon + "</span>" + stat.label + "</span>" +
        "<b>" + FB.TIERS[tier].label + (isPeak ? '<i class="star">*</i>' : "") + "</b>" +
        '<span class="find-stat-note">' + (isPeak ? "canon peak" : trap ? "trap line" : "line") + "</span>" +
      "</div>";
    }).join("");
  }

  function renderDetail(focusReveal) {
    if (!els.detail) return;
    var card = selected();
    if (!card) {
      els.detail.innerHTML = '<div class="find-detail-empty">' +
        '<span aria-hidden="true">⌕</span>' +
        "<h3>Open a file</h3>" +
        '<p class="micro">Pick a fighter from the index. Card art, series, signature and archetype are public; peak and tiers stay sealed until you choose to reveal them.</p>' +
      "</div>";
      return;
    }

    var color = rarityColor(card);
    var peakStat = FB.STATS.filter(function (s) { return s.key === card.peak; })[0];
    var revealed = state.canon;
    var bars = "";
    for (var i = 0; i < 5; i++) bars += "<i></i>";

    var canon = revealed
      ? '<div class="find-stat-list">' + tierMarkup(card) + "</div>" +
        '<p class="find-peak">Canonical peak · <b>' + esc(peakStat ? peakStat.label : "—") + "</b> · " +
          FB.TIERS[card.tiers[card.peak]].label + "</p>"
      : '<div class="find-sealed">' +
          '<span class="find-bars" aria-hidden="true">' + bars + "</span>" +
          '<p class="micro">Peak and tiers are sealed by default — the same readout the draft card shows. <b>Reveal</b> is a scouting choice; live rooms still deal blind.</p>' +
        "</div>";

    els.detail.innerHTML = '<div class="find-card" style="' + FB.ui.rarityStyle(card.rarity) + '">' +
      '<div class="find-art">' +
        FB.ui.portraitHTML(card, "portrait-card", true) +
        '<span class="find-rar" style="--rar:' + color + '">' + FB.ui.rarityName(card.rarity) + "</span>" +
        '<span class="find-src">' + sourceLabel(card) + "</span>" +
      "</div>" +
      '<div class="find-file">' +
        '<span class="kicker">' + sourceLabel(card) + " · no. " + pad(card.id) + "</span>" +
        '<h3 class="find-name">' + esc(card.name) + "</h3>" +
        '<p class="find-series">' + esc(card.series) + "</p>" +
        '<div class="find-tags">' +
          '<span class="find-tag is-rar" style="--rar:' + color + '">' + FB.ui.rarityName(card.rarity) + "</span>" +
          '<span class="find-tag">' + esc(card.archLabel || "—") + "</span>" +
          '<span class="find-tag">' + (card.traps ? card.traps + " trap" + (card.traps > 1 ? "s" : "") : "no traps") + "</span>" +
        "</div>" +
        '<dl class="find-lines">' +
          "<div><dt>Signature</dt><dd>" + esc(card.signature || "Unrecorded") + "</dd></div>" +
          "<div><dt>Archetype</dt><dd>" + esc(card.archLabel || "—") + "</dd></div>" +
          "<div><dt>Card trait</dt><dd>" + esc(card.trait || "—") + "</dd></div>" +
        "</dl>" +
        '<div class="find-canon">' +
          '<div class="find-canon-head"><span>Canon readout</span>' +
            '<button type="button" class="find-reveal" data-find-reveal>' + (revealed ? "Seal canon" : "Reveal canon") + "</button>" +
          "</div>" +
          canon +
        "</div>" +
      "</div>" +
    "</div>";

    FB.ui.hydratePortraits(els.detail);
    if (focusReveal) {
      var reveal = els.detail.querySelector("[data-find-reveal]");
      if (reveal) reveal.focus();
    }
  }

  function renderAll() {
    compute();
    if (els.note) els.note.textContent = state.note;
    if (els.count) {
      els.count.textContent = state.query
        ? state.total + (state.total === 1 ? " match" : " matches") + " · " + INDEX.length + " on file"
        : state.total + " on file";
    }
    renderFilters();
    renderResults();
    if (els.results) els.results.scrollTop = 0;
    renderDetail();
    if (els.detail) els.detail.scrollTop = 0;
  }

  function select(id) {
    if (!id) return;
    if (state.selectedId !== id) state.canon = false;
    state.selectedId = id;
    markActive();
    renderDetail();
    if (els.detail) els.detail.scrollTop = 0;
  }

  function open() {
    if (state.open || !els.overlay) return;
    state.open = true;
    state.lastFocus = document.activeElement;
    if (rowObserver) { rowObserver.disconnect(); rowObserver = null; }
    if (rowLoadTimer) { clearTimeout(rowLoadTimer); rowLoadTimer = null; }
    state.query = "";
    state.source = "all";
    state.selectedId = null;
    state.canon = false;
    if (els.input) els.input.value = "";
    els.overlay.hidden = false;
    document.body.classList.add("find-open");
    var opener = $("#find-open");
    if (opener) opener.setAttribute("aria-expanded", "true");
    renderAll();
    if (els.input) els.input.focus();
  }

  function close() {
    if (!state.open || !els.overlay) return;
    state.open = false;
    if (rowObserver) { rowObserver.disconnect(); rowObserver = null; }
    if (rowLoadTimer) { clearTimeout(rowLoadTimer); rowLoadTimer = null; }
    els.overlay.hidden = true;
    document.body.classList.remove("find-open");
    var opener = $("#find-open");
    if (opener) opener.setAttribute("aria-expanded", "false");
    var last = state.lastFocus;
    var usable = last && last !== document.body && last !== document.documentElement &&
      !els.panel.contains(last) && typeof last.focus === "function";
    var back = usable ? last : opener;
    if (back && typeof back.focus === "function") back.focus();
    else if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  function wire() {
    var opener = $("#find-open");
    if (opener) opener.addEventListener("click", open);

    $$("[data-find-close]").forEach(function (el) {
      el.addEventListener("click", close);
    });

    if (els.input) {
      els.input.addEventListener("input", function () {
        state.query = els.input.value;
        state.selectedId = null;
        state.canon = false;
        renderAll();
      });

      els.input.addEventListener("keydown", function (e) {
        if (e.key === "Escape") {
          e.preventDefault();
          close();
          return;
        }
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        if (!state.results.length) return;
        e.preventDefault();
        var at = state.results.findIndex(function (c) { return c.id === state.selectedId; });
        var next = e.key === "ArrowDown"
          ? Math.min(state.results.length - 1, at + 1)
          : Math.max(0, at - 1);
        if (at < 0) next = 0;
        select(state.results[next].id);
        var row = els.results && els.results.querySelector('[data-find-id="' + state.selectedId + '"]');
        if (row) row.scrollIntoView({ block: "nearest" });
      });
    }

    if (els.filters) {
      els.filters.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-find-source]");
        if (!btn) return;
        state.source = btn.getAttribute("data-find-source");
        state.selectedId = null;
        state.canon = false;
        renderAll();
        if (els.input) els.input.focus();
      });
    }

    if (els.results) {
      els.results.addEventListener("click", function (e) {
        var row = e.target.closest("[data-find-id]");
        if (!row) return;
        select(Number(row.getAttribute("data-find-id")));
      });

      els.results.addEventListener("keydown", function (e) {
        if (["ArrowDown", "ArrowUp", "Home", "End"].indexOf(e.key) < 0) return;
        var rows = Array.prototype.slice.call(els.results.querySelectorAll(".find-row"));
        var at = rows.indexOf(document.activeElement);
        if (at < 0) return;
        e.preventDefault();
        var next = e.key === "Home" ? 0
          : e.key === "End" ? rows.length - 1
          : e.key === "ArrowDown" ? Math.min(rows.length - 1, at + 1)
          : Math.max(0, at - 1);
        select(Number(rows[next].getAttribute("data-find-id")));
        rows[next].focus();
        rows[next].scrollIntoView({ block: "nearest" });
      });
    }

    if (els.detail) {
      els.detail.addEventListener("click", function (e) {
        if (!e.target.closest("[data-find-reveal]")) return;
        state.canon = !state.canon;
        renderDetail(true);
      });
    }

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && state.open) {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === "Tab" && state.open) {
        var items = Array.prototype.slice.call(
          els.panel.querySelectorAll("button, input, [href], [tabindex]:not([tabindex='-1'])")
        ).filter(function (el) {
          return !el.disabled && el.offsetParent !== null;
        });
        if (!items.length) return;
        var first = items[0];
        var last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      if (e.key === "/" && !state.open && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target)) {
        e.preventDefault();
        open();
      }
    });
  }

  function init() {
    els.overlay = $("#find-overlay");
    if (!els.overlay) return;
    els.panel = $("#find-panel");
    els.input = $("#find-input");
    els.results = $("#find-results");
    els.detail = $("#find-detail");
    els.note = $("#find-note");
    els.count = $("#find-count");
    els.filters = $(".find-filters");

    build();
    var total = $("#find-total");
    if (total) total.textContent = INDEX.length + " on file";
    renderFilters();
    wire();
  }

  FB.search = {
    init: init,
    open: open,
    close: close,
    isOpen: function () { return state.open; },
    state: state,
    index: INDEX
  };
})(window.FB);
