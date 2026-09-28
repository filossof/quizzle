# 🦉 Quizzle

A colorful, kid-friendly live quiz game in the style of Kahoot. Show the host screen on a TV or projector, and players join from their phones with a PIN or a QR code.

**Play:** https://filossof.github.io/quizzle/host.html · **Join:** https://filossof.github.io/quizzle · **Make quizzes:** https://filossof.github.io/quizzle/admin.html

- **Big-screen host view** with a lobby, animated countdown, answer chart, scoreboard and a podium with confetti
- **Phone controller** with big colorful answer buttons, emoji avatars, a random-name 🎲 button, vibration, and friendly feedback after every answer
- **Sounds and music**: 6 background music themes to pick from on the host screen (🎈 Bouncy, 🌴 Tropical, 🚀 Space, 🎧 Chill, 🕹️ Arcade, 🎠 Music box), each with a calm lobby tune and a softer question tune, plus a victory fanfare, drumroll, ticks and dings. All of it is generated live in the browser
- **Quiz Studio** for making quizzes: multiple choice or true/false, images, time limits, double points, import/export. Hebrew and other right-to-left languages work
- Scoring rewards speed (up to 1000 points) plus answer streak bonuses 🔥
- A cheeky owl 🦉 comments on every answer reveal: brags about the fastest players and streaks, and gently teases a missed answer (never the same kid twice in a row)
- Hebrew (default, right-to-left) and English interface, switchable with the 🌐 button on every page
- Phones and the host can refresh or drop Wi-Fi and reconnect automatically

## How it works (no server needed)

Quizzle is a static site on **GitHub Pages**.

- **The host's browser is the game server.** It registers the Game PIN on the free public [PeerJS](https://peerjs.com) relay (no account needed), and phones connect directly to it over WebRTC. Keep the host tab open and visible during a game.
- **Quizzes are private.** They're stored in a separate **private** repo, `quizzle-data` (`quizzes.json` plus pictures in `img/`). The Quiz Studio saves by committing to it through the GitHub API, so every change is kept in git history and nothing gets wiped. This public repo holds only the game code.

### Unlocking hosting and the Quiz Studio

Hosting and editing both need a GitHub key that can access `quizzle-data`. Enter it once per device; both pages share it:

1. Open https://github.com/settings/personal-access-tokens/new
2. **Repository access** → Only select repositories → `quizzle-data`
3. **Permissions** → Repository permissions → **Contents: Read and write**
4. Generate the token and paste it into the host page or the studio

Without the key, nobody can see, host or edit your quizzes. Players never need one: they just join with the PIN.

## Files

| Path | What |
| --- | --- |
| `docs/host.html`, `js/host.js` | Big screen |
| `docs/index.html`, `js/player.js` | Phone |
| `docs/admin.html`, `js/admin.js` | Quiz Studio |
| `docs/js/game.js` | Game engine (runs in the host's browser) |
| `docs/js/net.js` | Peer-to-peer connection and auto-reconnect |
| `docs/js/audio.js` | Web Audio synthesizer for sound effects and music |
| `docs/js/github.js` | Reads and saves quizzes in the private data repo |
| `docs/js/i18n.js` | Hebrew and English text, including the owl's jokes |
| `docs/js/config.js` | Name of the private data repo |

## Local testing

```bash
npm start   # then open http://localhost:8080/host.html
```
