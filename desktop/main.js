/* PEAKLINE — desktop shell
   Starts the bundled match relay (the same server.js the browser build uses)
   on a loopback port, waits until it answers, then opens the app in a window.
   Nothing external is required: the solo desks and the live 1v1 rooms both
   run against this process.

   Set FREEBUFF_SMOKE=1 to boot, verify the page and exit — used to test a
   packaged build without installing it. */

"use strict";

const { app, BrowserWindow, Menu, shell, dialog } = require("electron");
const http = require("http");
const net = require("net");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SMOKE = !!process.env.FREEBUFF_SMOKE;
const PREFERRED_PORT = Number(process.env.PORT) || 8123;

let win = null;
let relayPort = 0;

/* ── pick a port the relay can actually own ───────────────────────────── */

function probe(port) {
  return new Promise(function (resolve) {
    const srv = net.createServer();
    srv.once("error", function () { resolve(0); });
    srv.once("listening", function () {
      const got = srv.address().port;
      srv.close(function () { resolve(got); });
    });
    srv.listen(port, "127.0.0.1");
  });
}

async function pickPort() {
  const preferred = await probe(PREFERRED_PORT);
  if (preferred) return preferred;
  const spare = await probe(0);
  if (!spare) throw new Error("no free loopback port");
  return spare;
}

/* ── wait until the relay answers ─────────────────────────────────────── */

function waitHealth(port, tries) {
  const left = typeof tries === "number" ? tries : 60;
  return new Promise(function (resolve, reject) {
    const req = http.get({ host: "127.0.0.1", port: port, path: "/api/health", timeout: 1500 }, function (res) {
      res.resume();
      if (res.statusCode === 200) resolve(true);
      else retry(new Error("health " + res.statusCode));
    });
    req.on("timeout", function () { req.destroy(new Error("health timeout")); });
    req.on("error", retry);

    function retry(err) {
      if (left <= 0) return reject(err);
      setTimeout(function () { waitHealth(port, left - 1).then(resolve, reject); }, 250);
    }
  });
}

function startRelay(port) {
  process.env.PORT = String(port);
  if (!process.env.HOST) process.env.HOST = "0.0.0.0";
  require(path.join(ROOT, "server.js"));
}

/* ── window ───────────────────────────────────────────────────────────── */

function menu() {
  return Menu.buildFromTemplate([
    {
      label: "File",
      submenu: [{ role: "quit" }]
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        { role: "toggleDevTools" }
      ]
    }
  ]);
}

function openWindow(port) {
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 960,
    minHeight: 640,
    show: !SMOKE,
    backgroundColor: "#080910",
    title: "PEAKLINE — Draft night",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  win.on("closed", function () { win = null; });

  /* Portrait lookups link out to their source pages; hand those to the
     system browser instead of navigating the app away from the relay. */
  win.webContents.setWindowOpenHandler(function (details) {
    if (/^https?:/i.test(details.url)) shell.openExternal(details.url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", function (e, url) {
    if (!url.startsWith("http://127.0.0.1:" + port) && !url.startsWith("http://localhost:" + port)) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  win.loadURL("http://127.0.0.1:" + port + "/");
  return win;
}

/* ── smoke test ───────────────────────────────────────────────────────── */

/* A packaged Windows app has no console to print to, so the smoke report is
   written to a file the harness can read. */
function report(payload) {
  const line = "SMOKE " + JSON.stringify(payload);
  console.log(line);
  try { fs.writeFileSync(path.join(os.tmpdir(), "freebuff-smoke.json"), line); } catch (e) { /* ignore */ }
}

function smoke(candidate) {
  try { fs.unlinkSync(path.join(os.tmpdir(), "freebuff-smoke.json")); } catch (e) { /* ignore */ }

  const bail = setTimeout(function () {
    report({ ok: false, error: "timeout" });
    app.exit(1);
  }, 30000);

  candidate.webContents.once("did-finish-load", function () {
    candidate.webContents
      .executeJavaScript(
        "(async () => {" +
        "  const health = await fetch('/api/health').then(r => r.json()).catch(e => ({ ok: false, error: String(e) }));" +
        "  return {" +
        "    title: document.title," +
        "    roster: (window.FB && FB.poolCount) || 0," +
        "    modes: (window.FB && FB.MODES && FB.MODES.length) || 0," +
        "    tabs: document.querySelectorAll('.tab').length," +
        "    chips: document.querySelectorAll('#deck-list .slot, #deck-list > *').length," +
        "    scriptErrors: !!(window.FB && !FB.ui)," +
        "    health: health" +
        "  };" +
        "})()"
      )
      .then(function (found) {
        clearTimeout(bail);
        report({ ok: true, version: app.getVersion(), port: relayPort, page: found });
        app.exit(0);
      })
      .catch(function (err) {
        clearTimeout(bail);
        report({ ok: false, error: err && err.message });
        app.exit(1);
      });
  });
}

/* ── boot ─────────────────────────────────────────────────────────────── */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setName("PEAKLINE");
  app.setAppUserModelId("com.krillekz.freebuffai");

  app.on("second-instance", function () {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.on("window-all-closed", function () { app.quit(); });

  app.whenReady().then(async function () {
    let port;
    try {
      port = await pickPort();
      startRelay(port);
      await waitHealth(port);
    } catch (err) {
      if (SMOKE) {
        report({ ok: false, error: "relay: " + (err && err.message) });
        app.exit(1);
        return;
      }
      dialog.showErrorBox(
        "PEAKLINE could not start",
        "The local match relay did not come up.\n\n" + (err && err.message ? err.message : String(err))
      );
      app.quit();
      return;
    }

    relayPort = port;
    Menu.setApplicationMenu(menu());
    const candidate = openWindow(port);
    if (SMOKE) smoke(candidate);
  });
}

/* Keep the relay reachable for a diagnostic line in the window title area. */
module.exports = { get relayPort() { return relayPort; } };
