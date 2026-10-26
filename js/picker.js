/* FreeBuff AI — shared fighter picker
   Type a name or series, or draw a random fighter. Peak data is never shown. */

(function (FB) {
  "use strict";

  function norm(v) {
    return String(v || "").toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ").trim();
  }

  function rarityName(i) {
    return FB.RARITIES[i] ? FB.RARITIES[i].name : "";
  }

  function rarityColor(i) {
    return FB.RARITIES[i] ? FB.RARITIES[i].color : "#9aa2ac";
  }

  FB.mountPicker = function (root, opts) {
    opts = opts || {};
    var selected = null;
    var rarest = -1;
    var open = false;

    root.classList.add("picker");
    root.innerHTML =
      '<div class="picker-field">' +
        '<span class="picker-glyph" aria-hidden="true">⌕</span>' +
        '<input type="search" autocomplete="off" spellcheck="false" placeholder="' + (opts.placeholder || "Search 500 fighters…") + '" aria-label="Search fighters" />' +
        '<button type="button" class="picker-random" title="Draw a random fighter" aria-label="Draw a random fighter">⟳</button>' +
      '</div>' +
      '<div class="picker-results" hidden></div>' +
      '<div class="picker-selected" hidden></div>';

    var input = root.querySelector("input");
    var resultsEl = root.querySelector(".picker-results");
    var selectedEl = root.querySelector(".picker-selected");

    function paintSelected() {
      if (!selected) {
        selectedEl.hidden = true;
        selectedEl.innerHTML = "";
        return;
      }
      selectedEl.hidden = false;
      selectedEl.style.setProperty("--rar", rarityColor(selected.rarity));
      selectedEl.innerHTML =
        '<span class="picker-chip-rar">' + rarityName(selected.rarity) + '</span>' +
        '<span class="picker-chip-name">' + escapeHtml(selected.name) + '</span>' +
        '<span class="picker-chip-series">' + escapeHtml(selected.series) + '</span>' +
        '<button type="button" class="picker-clear" aria-label="Clear selected fighter">×</button>';
    }

    function escapeHtml(v) {
      return String(v).replace(/[&<>"']/g, function (ch) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
      });
    }

    function choose(card, silent) {
      selected = card || null;
      if (card) {
        input.value = card.name;
        selectedEl.style.setProperty("--rar", rarityColor(card.rarity));
      }
      resultsEl.hidden = true;
      open = false;
      paintSelected();
      if (!silent && card && typeof opts.onPick === "function") opts.onPick(card);
    }

    function renderResults(list) {
      if (!list.length) {
        resultsEl.innerHTML = '<div class="picker-empty">No fighter on file. Try another name or series.</div>';
        resultsEl.hidden = false;
        open = true;
        return;
      }
      resultsEl.innerHTML = list.map(function (c) {
        return '<button type="button" class="picker-row" data-id="' + c.id + '" style="--rar:' + rarityColor(c.rarity) + '">' +
          '<span class="picker-row-rar">' + rarityName(c.rarity) + '</span>' +
          '<span class="picker-row-name">' + escapeHtml(c.name) + '</span>' +
          '<span class="picker-row-series">' + escapeHtml(c.series) + '</span>' +
        '</button>';
      }).join("");
      resultsEl.hidden = false;
      open = true;
    }

    function search() {
      var q = norm(input.value);
      if (!q) {
        resultsEl.hidden = true;
        open = false;
        return;
      }
      var hits = [];
      for (var i = 0; i < FB.pool.length && hits.length < 9; i++) {
        var c = FB.pool[i];
        var name = norm(c.name);
        var series = norm(c.series);
        if (name.indexOf(q) >= 0 || series.indexOf(q) >= 0) hits.push(c);
      }
      hits.sort(function (a, b) {
        var an = norm(a.name), bn = norm(b.name);
        var ap = an.indexOf(q) === 0 ? 0 : 1;
        var bp = bn.indexOf(q) === 0 ? 0 : 1;
        return ap - bp || a.rarity - b.rarity;
      });
      renderResults(hits.slice(0, 8));
    }

    input.addEventListener("input", search);
    input.addEventListener("focus", function () {
      if (input.value && !selected) search();
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        resultsEl.hidden = true;
        open = false;
      } else if (e.key === "Enter") {
        e.preventDefault();
        var first = resultsEl.querySelector("[data-id]");
        if (first && open) choose(FB.characterById(Number(first.getAttribute("data-id"))));
      }
    });

    resultsEl.addEventListener("click", function (e) {
      var row = e.target.closest("[data-id]");
      if (!row) return;
      choose(FB.characterById(Number(row.getAttribute("data-id"))));
    });

    selectedEl.addEventListener("click", function (e) {
      if (!e.target.closest(".picker-clear")) return;
      selected = null;
      input.value = "";
      paintSelected();
      if (typeof opts.onClear === "function") opts.onClear();
      input.focus();
    });

    root.querySelector(".picker-random").addEventListener("click", function () {
      var c = FB.pool[Math.floor(Math.random() * FB.poolCount)];
      choose(c);
    });

    if (opts.initial) choose(opts.initial, true);

    return {
      get: function () { return selected; },
      set: function (card) { choose(card, true); },
      clear: function () { choose(null, true); input.value = ""; },
      focus: function () { input.focus(); }
    };
  };
})(window.FB = window.FB || {});
