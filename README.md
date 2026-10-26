# FreeBuff AI — Fight Night Edition

A 500-series anime draft room. Roll five fighters, file them blind into Strength, Speed,
Abilities, IQ and Durability, then rate the deck, fight the AI, challenge a friend, or put
two fictional characters in front of the analyst and ask who wins.

Everything is local: no accounts, no cloud, no telemetry.

## The five desks

| # | Desk | What it does |
|---|------|--------------|
| 01 | **Builder** | Roulette sandbox. Five blind rolls, one reroll, no pity. File each card without seeing its peak. |
| 02 | **Deck Rater** | Grades the core you just sealed: overall output, peak hits, percentile against peak-built decks. |
| 03 | **1v1 AI** | One fighter each. The AI draws blind from the same 500 and lines up its peak most of the time. |
| 04 | **1v1 Live** | A room code or public queue, hosted by the bundled relay. Same draft loop, real opponent. |
| 05 | **Analyst Desk** | Conversations, a "who wins?" matchup engine, and a rules briefing. |

Plus **Find** (`/` anywhere) — a character searcher across all 618 cards, by name, series or
signature move.

## Install (Windows)

Download `FreeBuff-AI-Setup-1.0.0.exe` from [Releases](../../releases) and run it. The
installer lets you pick a folder, adds a desktop and start-menu shortcut, and uninstalls
cleanly from Windows settings.

The desktop build starts its own match relay on a loopback port, so **1v1 Live works out of
the box**. Windows may ask once about network access — allow it only if you want a friend on
the same WiFi to join your room.

## Run from source

```bash
node server.js          # app + live relay on http://127.0.0.1:8123
```

No install step, no dependencies. Opening `index.html` directly also works for every solo
desk; only the live rooms need the relay.

```bash
npm install             # Electron + electron-builder
npm run desktop         # run the desktop shell
npm run build:win       # rebuild the Windows installer into dist/
```

## Browser build

The site is published at **https://krillekz.github.io/freebuff-ai/** — builder, rater, 1v1 AI,
analyst and the searcher all run there. GitHub Pages serves static files only, so the live
room relay is not available on the web build; use the desktop app or `node server.js` for
1v1 Live.

## Data

- `Animes.txt` — the 500-series roster.
- `GameInfo.txt` — the rules, rarity bands and scoring constraints the engine implements.

Characters are drawn from the series list; portraits are resolved from public anime APIs
(AniList, then MyAnimeList, then series key art) and cached in the browser. When a lookup
cannot be confirmed the card falls back to its series banner rather than a broken image.

## License

MIT.
