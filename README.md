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

## How it works (no server of our own)

Quizzle is a static site on **GitHub Pages**.

- **The host's browser is the game server.** It registers the Game PIN on the free public [PeerJS](https://peerjs.com) relay (no account needed), and phones connect directly to it over WebRTC. Keep the host tab open and visible during a game.
- **Everyone has their own private quizzes.** Hosts and quiz makers **sign in with Google**; quizzes and pictures are stored in **Firebase Firestore** (project `quizzle-a3132`, free Spark plan) under the owner's account. The rules in [`firestore.rules`](firestore.rules) make Google's servers refuse any read or write of a quiz that isn't yours. Players on phones never sign in.
- **Sharing:** the 🔗 button on a quiz creates a link. A friend who opens it signs in and gets their own copy (with its own copy of the pictures). The original stays yours.

### Changing the database rules

The rules live in `firestore.rules`. After changing them, paste them into the Firebase console (**Firestore Database → Rules → Publish**).

## Files

| Path | What |
| --- | --- |
| `docs/host.html`, `js/host.js` | Big screen |
| `docs/index.html`, `js/player.js` | Phone |
| `docs/admin.html`, `js/admin.js` | Quiz Studio |
| `docs/js/game.js` | Game engine (runs in the host's browser) |
| `docs/js/net.js` | Peer-to-peer connection and auto-reconnect |
| `docs/js/audio.js` | Web Audio synthesizer for sound effects and music |
| `docs/js/store.js` | Firebase: sign-in, saving quizzes and pictures, share links |
| `docs/js/auth-ui.js` | "Sign in with Google" screen and the signed-in chip |
| `docs/js/i18n.js` | Hebrew and English text, including the owl's jokes |
| `docs/js/config.js` | Firebase project settings |
| `firestore.rules` | Who can read and write what in the database |

## Publishing changes

Run `npm run stamp` before committing. It adds a version tag to every script and stylesheet link, so browsers never mix old cached files with new ones.

## Local testing

```bash
npm start   # then open http://localhost:8080/host.html
```

To test without touching the real database, run the Firebase emulators (`firebase emulators:start --only auth,firestore`, needs Java) and set `localStorage['quizzle.emulator'] = '1'` in the browser on localhost.
