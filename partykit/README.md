# Tiny Dead — PartyKit relay

An **always-on, free** WebSocket relay for online co-op, as an alternative to the
Node server in [`../server`](../server). It speaks the exact same wire protocol,
so the game client connects unchanged.

It uses **no storage** — rooms live only in memory while players are connected,
so PartyKit's 24-hour storage expiry is irrelevant here.

## Deploy (once)

You need Node 18+. From this folder:

```bash
cd partykit
npx partykit@latest login     # opens GitHub to authenticate (free account)
npx partykit@latest deploy
```

Deploy prints your URL, of the form:

```
https://tiny-dead.<your-github-username>.partykit.dev
```

## Point the game at it

In the game's title screen, click **⚙ Co-op server** and paste that URL
(`https://…` is fine — the client converts it to `wss://` and appends the
PartyKit room path automatically). Or open the game with
`?server=https://tiny-dead.<you>.partykit.dev` once.

To make it the default for everyone, set the repo Actions **Variable**
`VITE_SERVER_URL` to:

```
wss://tiny-dead.<your-github-username>.partykit.dev/parties/main/tinydead
```

## Local dev

```bash
npx partykit@latest dev        # serves on http://127.0.0.1:1999
```

Then point the game at `?server=ws://127.0.0.1:1999/parties/main/tinydead`.

## How it works

All players connect to one shared PartyKit room (`tinydead`); this single
always-on instance multiplexes many game rooms in memory by a 4-letter share
code (host = id 1, guests 2–4), forwarding opaque messages between peers.
Fine for hobby scale. See [`server.ts`](./server.ts).
