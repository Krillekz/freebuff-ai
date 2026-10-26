/* FreeBuff AI — application shell
   Owns tab navigation, the awakening switch, keyboard shortcuts and boot. */

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
    var nav = document.querySelector(".nav");
    if (main && window.scrollY > 0) {
      var offset = (nav ? nav.offsetHeight : 54) + 10;
      var top = main.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top: Math.max(0, top), behavior: "auto" });
    }
  }

  FB.go = go;

  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () { go(tab.getAttribute("data-view")); });
    tab.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
      e.preventDefault();
      var at = tabs.indexOf(tab);
      var next = e.key === "Home" ? 0
        : e.key === "End" ? tabs.length - 1
        : e.key === "ArrowRight" ? (at + 1) % tabs.length
        : (at - 1 + tabs.length) % tabs.length;
      tabs[next].focus();
      go(tabs[next].getAttribute("data-view"));
    });
  });

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
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target && e.target.isContentEditable)) return;
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
