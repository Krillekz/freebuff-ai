# PEAKLINE — Draft night

A 500-series anime draft room. Roll five fighters, file them blind into Strength, Speed,
Abilities, IQ and Durability, then rate the deck, duel the bot, challenge a friend, or put
two fictional characters in front of the analyst and ask who wins.

Everything is local: no accounts, no cloud, no telemetry.

**Designed and built by [Raevik](https://github.com/Krillekz).**

## The five desks

| # | Desk | What it does |
|---|------|--------------|
| 01 | **Builder** | Roulette sandbox. Five blind rolls, one reroll, no pity. File each card without seeing its peak. Draft across all 500 series or lock the pool to a single anime. |
| 02 | **Deck Rater** | Grades the core you just sealed: overall output, peak hits, percentile against peak-built decks. |
| 03 | **1v1 Bot** | One fighter each. The bot draws blind from the same 500 and lines up its peak most of the time. |
| 04 | **1v1 Live** | A room code or public queue, hosted by the bundled relay. Same draft loop, real opponent, host-chosen mode. |
| 05 | **Analyst** | Conversations, a "who wins?" matchup engine, and a rules briefing with the colophon. |

Plus **Find** (`/` anywhere) — a character searcher across all 618 cards, by name, series or
signature move. `?` opens the shortcut sheet.

## Design

The interface is an app frame rather than a page: a rail of numbered desks on the left, one
toolbar, and a bento split between the board and your five-slot core. Warm bone text on a
near-black canvas, one acid-lime signal colour, Bricolage Grotesque for display type and IBM
Plex Mono for every readout.

Two themes ship with it — **Noir** (default) and **Paper** — switched from the rail or the
toolbar; the choice is remembered in `localStorage`. Cards keep their printed crest whenever
a portrait cannot be resolved, so nothing renders blank.

## Install (Windows)

Download the current `PEAKLINE-Setup-*.exe` from [Releases](../../releases) and run it. The
installer lets you pick a folder, adds a desktop and start-menu shortcut, and uninstalls
cleanly from Windows settings.

The desktop build starts its own match relay on a loopback port, so **1v1 Live works out of
the box**. Windows may ask once about network access — allow it only if you want a friend on
the same WiFi to join your room.

## Run from source

```bash
node server.js        # http://127.0.0.1:8123
npm install           # only needed for the Electron build
npm run build:win     # dist/PEAKLINE-Setup-1.1.0.exe
```

Keep the relay window open while you draft. If port 8123 is already taken — usually a
relay you left running in another window — the server moves up to the next free port and
prints the address to open instead of crashing.

The solo desks work straight from `index.html`; the 1v1 Live rooms need `server.js` (or the
desktop build).

## Web build

The site is published at **https://krillekz.github.io/freebuff-ai/** — builder, rater, 1v1 bot,
analyst and searcher all run in the browser. Live rooms need the relay, so they stay on the
desktop build or a local `node server.js`.

## Files

```
index.html          the app frame: rail, toolbar, five desks, searcher, shortcuts
css/styles.css      the whole visual system (tokens, Noir + Paper, responsive)
js/series.js        500-series catalogue and host modes
js/data.js          roster, rarities, tiers, archetypes
js/engine.js        rolls, scoring, duels
js/portraits.js     portrait resolver with printed-crest fallback
js/rating.js        deck rating and percentile benchmark
js/picker.js        shared fighter picker
js/ui.js            builder, rater, 1v1 bot
js/multiplayer.js   1v1 Live client
js/analyst.js       chat, matchups, briefing
js/search.js        character searcher
js/app.js           navigation, theme, shortcuts, boot
server.js           local relay for live rooms
desktop/main.js     Electron shell
build/make-icon.js  generates the app icon
```

## Credits

- **Product, design and build** — Raevik
- **Roster and canon data** — curated from the 500-series file in this folder
- **Engine** — local rules only; no accounts, no cloud, no telemetry
- Portraits resolve from public artwork; every card keeps its printed crest when a portrait
  cannot be reached.

MIT licensed.
