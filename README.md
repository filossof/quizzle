# 🦉 Quizzle

A colorful, kid-friendly live quiz game in the style of Kahoot. Show the host screen on a TV or projector, and players join from their phones with a PIN or a QR code.

- **Big-screen host view** with a lobby, animated countdown, answer chart, scoreboard and a podium with confetti
- **Phone controller** with big colorful answer buttons, emoji avatars, a random-name 🎲 button, vibration, and friendly feedback after every answer
- **Sounds and music**: lobby tune, tense question music, victory fanfare, drumroll, ticks, dings. All of it is generated live in the browser, so there are no audio files
- **Quiz Studio** (`/admin`) for making quizzes: multiple choice or true/false, images, time limits, double points, reordering, import/export
- Scoring rewards speed (up to 1000 points) plus answer streak bonuses 🔥
- Players can refresh or lock their phone and rejoin automatically

## Run it

```bash
npm install
npm start
```

Then open:

| What | Where |
| --- | --- |
| 🎮 Host a game (big screen) | http://localhost:3000/host |
| ✏️ Quiz Studio | http://localhost:3000/admin (password `quizzle`) |
| 📱 Players join | the address shown on the host screen, e.g. `http://192.168.1.20:3000` |

Phones must be on the **same Wi-Fi** as the computer running the server. If macOS asks whether to allow incoming connections for `node`, click **Allow**.

## Settings

Set these as environment variables:

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `ADMIN_PASSWORD` | `quizzle` | Password for the Quiz Studio |
| `PUBLIC_URL` | auto-detected LAN address | Join address shown to players (set this when hosting online) |
| `DATA_DIR` | `./data` | Where quizzes are saved (`quizzes.json`) |

```bash
ADMIN_PASSWORD=secret PORT=8080 npm start
```

## How it works

- `server.js` runs Express and Socket.IO and serves the REST API for quizzes
- `src/game.js` holds the game state machine: lobby → intro → question → reveal → scoreboard → … → podium
- `src/store.js` stores quizzes in a JSON file; the samples in `sample-quizzes.json` seed the first run
- `public/` has plain HTML, CSS and JS with no build step. `audio.js` is a small Web Audio synthesizer and sequencer

Your quizzes live in `data/quizzes.json`, which is git-ignored. Use **⬇ Export** in the studio to back them up.
