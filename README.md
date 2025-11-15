Aim — Ranked vs Bot (Local, Browser)
=====================================

Overview
--------
Aim is a small browser-based aim training / ranked simulation that stores a local ELO and lets you play 1-player ranked matches vs bots. It is intended to run locally from the project folder (no server required).

Key features
------------
- Persistent local ELO stored in `localStorage` (cannot drop below 1000).
- 3-round ranked matches vs a bot whose performance scales with ELO.
- Per-round history and per-round ELO changes shown after each match.
- Mock Top-50 leaderboard (bots) that auto-refreshes every 5 minutes with small ELO/stat changes.
- Emblems (images) for each division: `img/emblems/<tier><division>.png` (e.g. `bronze1.png`, `gold3.png`, `grandchamp.png`).
- Grand Champion tier (no subdivisions) at high ELO (default threshold 3000).
- Encrypted backup / restore (AES-GCM) of your ELO + leaderboard to a downloadable JSON file.
- Player profile modal with persistent stats (games played, wins/losses, average reaction, best reaction).
- Help modal explaining rules and division ranges.

Files of interest
-----------------
- `index.html` — single-file app containing UI, game logic, leaderboard, backup/restore, and profile features.
- `img/emblems/` — expected location for emblem images. App will fallback to `bronze1.png` if an emblem is missing.

LocalStorage keys
-----------------
- `elo` — your current Elo (number)
- `mock_leaderboard_v1` — JSON array of the current mock Top-50 leaderboard
- `player_stats_v1` — your persistent player stats (gamesPlayed, wins, losses, totalRounds, totalReaction, bestReaction)

Running locally
---------------
- Double-click `index.html` or open it in a browser. (Some browsers restrict file:// fetches — if assets don't load, try option B.)


Notes about backup/restore
-------------------------
- Click the `Backup` button and enter a password; the app will produce an encrypted JSON file you can save locally.
- Click the `Restore` button and select a previously saved backup file, then enter the password used to encrypt it.
- Backup contains: `elo` and `leaderboard`.
- If you want the backup to also include your `player_stats_v1` profile data, ask me and I can add it (recommended).

Customizing
-----------
- To change the Grand Champion threshold, edit the `GRANDCHAMP_THRESHOLD` constant in `index.html`.
- To change ranking spacing (currently 100 ELO per subdivision), modify the `eloToRank` logic.
- To change leaderboard refresh interval, update `LB_REFRESH_MS`.

Developer notes
---------------
- Bot reaction and miss behaviour is in `simulateBotReaction(botElo)` inside `index.html`.
- Per-round and per-match ELO changes use a small K-factor for visible changes per round and K=32 for match-level calculation.


