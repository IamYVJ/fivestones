# Five Stones

A static, peer-to-peer five-in-a-row board game in the style of the sibling projects (`sequence`, `localcodenames`, `judgement`). One player hosts from their browser, others join with a 4-character code or invite link. No backend, no accounts. Installable as an offline-capable PWA.

## Features

- Host-authoritative WebRTC (PeerJS) star topology; room code maps to the host's Peer ID.
- Two players, any number of spectators, optional computer opponent (easy / normal / hard).
- Configurable rules in the lobby: board 9/13/15/17/19, line length 4/5/6, and whether longer lines count.
- Undo: instant against the computer, needs the opponent's OK against a person.
- Resign, rematch with colours swapped, running score.
- Token-based reconnect (30 s auto-retry) and host resume after a reload.
- Keyboard play on the board (arrow keys + Enter).

## Play

**Live:** https://iamyvj.github.io/fivestones/

Source: https://github.com/IamYVJ/fivestones

The default signalling broker is PeerJS's public cloud; set `BROKER_CONFIG` in `js/net.js` to use your own.

## Layout

```
index.html, css/styles.css, manifest.webmanifest, sw.js, icons/
js/rules.js   pure rules (win detection, undo)
js/bot.js     heuristic computer player
js/host.js    host-authoritative room logic (transport-agnostic)
js/net.js     PeerJS transport
js/board.js   canvas board renderer
js/main.js    wiring and screens
scripts/test-engine.mjs   headless tests (npm test, needs Node)
```
