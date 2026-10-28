/* PEAKLINE — application shell
   Owns rail navigation, the theme switch, the shortcuts sheet, the awakening
   switch, keyboard shortcuts and boot. */

(function (FB) {
  "use strict";

  var VIEWS = ["builder", "rater", "duel", "live", "analyst"];
  var active = "builder";

  var tabs = Array.prototype.slice.call(document.querySelectorAll(".tab"));
  var views = VIEWS.reduce(function (map, name) {
    map[name] = document.getElementById("view-" + name);
    return map;
  }, {});

  function getTab(name) { return document.getElementById("tab-" + name); }

  function go(name) {
    if (VIEWS.indexOf(name) < 0) name = "builder";
    active = name;
    FB.ui.state.tab = name;

    tabs.forEach(function (tab) {
      var on = tab.getAttribute("data-view") === name;
      tab.classList.toggle("is-active", on);
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.setAttribute("tabindex", on ? "0" : "-1");
    });
    VIEWS.forEach(function (key) {
      if (views[key]) views[key].hidden = key !== name;
    });

    if (name === "rater") FB.ui.renderRater();
    if (name === "duel") FB.ui.renderDuel();
    if (name === "live" && FB.multiplayer) FB.multiplayer.enter();
    if (name === "analyst" && FB.analyst) FB.analyst.enter();

    var main = document.getElementById("main");
    var top = document.querySelector(".top");
    if (main && window.scrollY > 0) {
      var offset = (top ? top.offsetHeight : 64) + 12;
      var top0 = main.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top: Math.max(0, top0), behavior: "auto" });
    }
  }

  FB.go = go;

  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () { go(tab.getAttribute("data-view")); });
    tab.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
      e.preventDefault();
      var at = tabs.indexOf(tab);
      var back = e.key === "ArrowLeft" || e.key === "ArrowUp";
      var next = e.key === "Home" ? 0
        : e.key === "End" ? tabs.length - 1
        : back ? (at - 1 + tabs.length) % tabs.length
        : (at + 1) % tabs.length;
      tabs[next].focus();
      go(tabs[next].getAttribute("data-view"));
    });
  });

  /* ── theme: noir (default) or paper ─────────────────────────────────── */

  var THEME_KEY = "peakline.theme";

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") === "paper" ? "paper" : "noir";
  }

  function paintTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    var next = theme === "paper" ? "noir" : "paper";
    var main = document.getElementById("theme-toggle");
    if (main) {
      main.setAttribute("aria-pressed", theme === "paper" ? "true" : "false");
      main.title = "Switch to the " + next + " theme";
      var label = main.querySelector(".rail-btn-label");
      if (label) label.textContent = next === "paper" ? "Paper" : "Noir";
    }
    var chip = document.getElementById("theme-toggle-mobile");
    if (chip) {
      chip.setAttribute("aria-label", "Switch to the " + next + " theme");
      chip.textContent = theme === "paper" ? "☾" : "◐";
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "paper" ? "#f2efe7" : "#08090b");
  }

  function setTheme(theme) {
    paintTheme(theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* ignore */ }
  }

  var storedTheme = "noir";
  try { storedTheme = localStorage.getItem(THEME_KEY) === "paper" ? "paper" : "noir"; } catch (e) { storedTheme = "noir"; }
  paintTheme(storedTheme);

  ["theme-toggle", "theme-toggle-mobile"].forEach(function (id) {
    var btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener("click", function () {
      setTheme(currentTheme() === "paper" ? "noir" : "paper");
    });
  });

  /* ── shortcuts sheet ────────────────────────────────────────────────── */

  var keysOverlay = document.getElementById("keys-overlay");
  var keysPanel = document.getElementById("keys-panel");

  function keysOpen() {
    if (!keysOverlay || !keysOverlay.hidden) return;
    keysOverlay.hidden = false;
    document.body.classList.add("keys-open");
    var opener = document.getElementById("keys-open");
    if (opener) opener.setAttribute("aria-expanded", "true");
    if (keysPanel) keysPanel.focus();
  }

  function keysClose() {
    if (!keysOverlay || keysOverlay.hidden) return;
    keysOverlay.hidden = true;
    document.body.classList.remove("keys-open");
    var opener = document.getElementById("keys-open");
    if (opener) {
      opener.setAttribute("aria-expanded", "false");
      opener.focus();
    }
  }

  if (keysOverlay) {
    var keysBtn = document.getElementById("keys-open");
    if (keysBtn) keysBtn.addEventListener("click", keysOpen);
    Array.prototype.forEach.call(keysOverlay.querySelectorAll("[data-keys-close]"), function (el) {
      el.addEventListener("click", keysClose);
    });
  }

  /* ── analyst sub-tabs ────────────────────────────────────────────────── */

  var subTabs = Array.prototype.slice.call(document.querySelectorAll(".subtab"));
  var subViews = { main: document.getElementById("ana-main"), who: document.getElementById("ana-who"), brief: document.getElementById("ana-brief") };

  function goAna(name) {
    if (!subViews[name]) name = "main";
    subTabs.forEach(function (tab) {
      var on = tab.getAttribute("data-ana") === name;
      tab.classList.toggle("is-active", on);
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.setAttribute("tabindex", on ? "0" : "-1");
    });
    Object.keys(subViews).forEach(function (key) {
      if (subViews[key]) subViews[key].hidden = key !== name;
    });
    if (FB.analyst) FB.analyst.subtab(name);
  }

  subTabs.forEach(function (tab) {
    tab.addEventListener("click", function () { goAna(tab.getAttribute("data-ana")); });
    tab.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      var at = subTabs.indexOf(tab);
      var next = e.key === "ArrowRight" ? (at + 1) % subTabs.length : (at - 1 + subTabs.length) % subTabs.length;
      subTabs[next].focus();
      goAna(subTabs[next].getAttribute("data-ana"));
    });
  });

  /* ── awakening switch ────────────────────────────────────────────────── */

  var awake = document.getElementById("awake-toggle");
  if (awake) {
    awake.addEventListener("click", function () {
      FB.ui.toggleAwake();
      if (FB.analyst) FB.analyst.refresh();
    });
  }

  /* ── keyboard ────────────────────────────────────────────────────────── */

  document.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var tag = e.target && e.target.tagName;
    var typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target && e.target.isContentEditable);

    if (e.key === "Escape" && keysOverlay && !keysOverlay.hidden) {
      e.preventDefault();
      keysClose();
      return;
    }
    if (!typing && !(FB.search && FB.search.isOpen()) && e.key === "?") {
      e.preventDefault();
      keysOverlay && !keysOverlay.hidden ? keysClose() : keysOpen();
      return;
    }
    if (typing) return;
    if (FB.search && FB.search.isOpen()) return;
    if (e.key === "Escape") {
      var open = document.querySelector(".picker-results:not([hidden])");
      if (open) open.hidden = true;
      return;
    }
    var key = e.key.toLowerCase();
    if (FB.ui.state.tab === "live" && FB.multiplayer && FB.multiplayer.handleKey(key)) {
      e.preventDefault();
      return;
    }
    if (FB.ui.state.tab !== "builder") return;
    if (key === "r") { e.preventDefault(); FB.ui.roll(); return; }
    if (key === "w") { e.preventDefault(); FB.ui.reroll(); return; }
    if (/^[1-5]$/.test(key) && FB.ui.state.offer) { e.preventDefault(); FB.ui.assign(Number(key) - 1); }
  });

  /* ── boot ────────────────────────────────────────────────────────────── */

  FB.ui.boot();
  if (FB.analyst) FB.analyst.init();
  if (FB.multiplayer) FB.multiplayer.init();
  if (FB.search) FB.search.init();

  var invite = "";
  try { invite = new URLSearchParams(location.search).get("room") || ""; } catch (e) { invite = ""; }
  go(invite ? "live" : "builder");
})(window.FB);
