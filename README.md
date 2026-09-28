# 🦉 Quizzle

A colorful, kid-friendly live quiz game in the style of Kahoot. Show the host screen on a TV or projector, and players join from their phones with a PIN or a QR code.

**Play:** https://filossof.github.io/quizzle/host.html · **Join:** https://filossof.github.io/quizzle · **Make quizzes:** https://filossof.github.io/quizzle/admin.html

- **Big-screen host view** with a lobby, animated countdown, answer chart, scoreboard and a podium with confetti
- **Phone controller** with big colorful answer buttons, emoji avatars, a random-name 🎲 button, vibration, and friendly feedback after every answer
- **Sounds and music**: lobby tune, tense question music, victory fanfare, drumroll, ticks, dings. All of it is generated live in the browser
- **Quiz Studio** for making quizzes: multiple choice or true/false, images, time limits, double points, import/export. Hebrew and other right-to-left languages work
- Scoring rewards speed (up to 1000 points) plus answer streak bonuses 🔥
- Phones and the host can refresh or drop Wi-Fi and reconnect automatically

## How it works (no server needed)

Quizzle is a static site on **GitHub Pages**.

- **The host's browser is the game server.** It registers the Game PIN on the free public [PeerJS](https://peerjs.com) relay (no account needed), and phones connect directly to it over WebRTC. Keep the host tab open and visible during a game.
- **Quizzes are stored in this repo** in [`docs/quizzes.json`](docs/quizzes.json), and pictures in [`docs/img/`](docs/img). The Quiz Studio saves by committing to the repo through the GitHub API, so every change is kept in git history and nothing gets wiped.

### Connecting the Quiz Studio

The studio needs a GitHub key once per device:

1. Open https://github.com/settings/personal-access-tokens/new
2. **Repository access** → Only select repositories → `quizzle`
3. **Permissions** → Repository permissions → **Contents: Read and write**
4. Generate the token and paste it into the studio

Only people with a key can change quizzes. Anyone can play.

## Files

| Path | What |
| --- | --- |
| `docs/host.html`, `js/host.js` | Big screen |
| `docs/index.html`, `js/player.js` | Phone |
| `docs/admin.html`, `js/admin.js`, `js/github.js` | Quiz Studio, which saves to GitHub |
| `docs/js/game.js` | Game engine (runs in the host's browser) |
| `docs/js/net.js` | Peer-to-peer connection and auto-reconnect |
| `docs/js/audio.js` | Web Audio synthesizer for sound effects and music |
| `docs/js/config.js` | Which repo quizzes are loaded from and saved to |

## Local testing

```bash
npm start   # then open http://localhost:8080/host.html
```
