# FreeBuff AI: Anime Character Builder & Battler
### System Operational Configuration Manual

This document details the file directory pathways and functional parameters required to execute the FreeBuff AI simulation engine. The application utilizes a dual-tab, data-driven architecture to facilitate localized asset management, gacha randomization validation, and predictive attribute matchup logic.

---

## 📂 System File Directories

The application core architecture dynamically queries and syncs data strings from two static root files located within the local environment. Ensure both paths are mapped precisely inside your system configurations to prevent initialization runtime breaks:

*   **Anime Database Roster Module:** 
    `C:\Users\pknet\Desktop\Anime CH\Animes.txt`
    *   *Contents:* Contains the exhaustive directory string array of exactly 500 validated series (including battle shonen, legacy classics, full isekai pools, Solo Leveling, and Cyberpunk: Edgerunners Seasons 1 & 2). 

*   **Game Rules & Architecture Module:** 
    `C:\Users\pknet\Desktop\Anime CH\GameInfo.txt`
    *   *Contents:* Houses the foundational logic blocks, layout frameworks, color assignments, strict gacha constraints, and structural calculator guidelines for the simulation.

---

## 🕹️ Brief Game Overview & Core Frameworks

FreeBuff AI functions as a data-driven card engineering and stat comparison engine. The user interface splits operations into two specialized workspaces:

### 1. Tab 1: Character Builder (Roulette Sandbox)
*   **Pure Random Gacha:** Players interact with a pull mechanism drawing random actual anime characters. Selection is entirely random with no underlying programmatic drop guarantees or pity thresholds.
*   **Manual Slot Lock:** Once a card is drawn, the player assigns it to one of exactly five core slots: **Strength 💪**, **Speed 💨**, **Abilities ⚡**, **IQ 🧠**, or **Durability 🛡️**. Each user receives exactly one free reroll per building session to clear a single undesirable pick.
*   **Optimization Matrix:** Card power boundaries scale from **Common (Gray)** up to **Secret (Dark Black)** rarity, yielding an absolute performance tier output ranking from **E** to **X**. 
*   **Perfect Match Bonus (*):** Placing an iconic asset into their peak attribute slot (e.g., Light Yagami in IQ) appends an asterisk tag (`X*`), forcing a significant multiplier increase.
*   **Mismatched Anti-Meta Penalty:** Misplacing an incredibly powerful asset into a slot completely counter to their canonical lore attributes triggers a severe structural deduction, pinning that slot's overall contribution under a hard value cap of 50 regardless of base rarity.
*   **Awakening Mode Toggle:** Activating the transformation layout boosts overall scaling metrics cleanly without introducing messy layout clutter or unneeded performance-heavy overlay textures.

### 2. Tab 2: Versus AI Matchup Comparator
*   **No Active Combat Simulator:** To maintain streamlined, fast-paced evaluation cycles, this workspace completely omits traditional turn-based active combat controls, canvas rendering loops, or interactive combat triggers.
*   **Instant Score Evaluation:** Upon initialization, the compiler immediately runs a point-by-point comparative matrix evaluating the player's custom configuration directly against a random, pre-built AI card deck.
*   **Line-by-Line Breakdown:** The engine outputs a clean scoreboard telemetry string comparing matching slots side-by-side. The deck showcasing the higher mathematical overall product across the five attributes secures the victory point.
