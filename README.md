# noxbot

A Discord bot running on a Cloudflare Worker, with per-user data in a Durable Object.

Commands: `/coinflip`, `/8ball`, `/lengthwave` + `/leaderboard` (a Wavelength-style guessing game), mail (`/sendmail`, `/checkmail`, `/readmail`, `/deletemail`), stats (`/getstats`, plus admin-only `/incrementuserdata`, `/updatestats`, `/dropstats`), `/emote` (copy a 7tv emote), `/choosesomeone`, `/chattrack`, `/roll`, `/remindme` (DMs you later) and `/reminders` (list or cancel them), `/mind` (a cooperative card game), settings (`/getsettings`, `/updatesettings`) and `/invite`.

Right-click menus: **Send mail** and **Get stats** on a user, **Steal emoji** on a message (copies its first custom emoji to the server).

## The Mind (`/mind`)

A cooperative card game for 2-8 players, played with buttons in a channel.

- `/mind start` opens a lobby with Join, Leave, Begin and Cancel buttons. The host presses Begin. One game per channel.
- `/mind end` ends the lobby or game (the host, any player or an admin). Ending a started game counts as a loss.
- `/mind leaderboard` shows the best teams by level reached.

Each level deals every player N cards (N is the level number) from 1-100. Together you must play every card in ascending order **without talking or signalling**, which is an honor rule: the bot cannot read the channel, so it is not enforced. Press **Play lowest** whenever you feel your lowest card is next, and **My hand** to privately see your cards. If anyone holds a lower card, the team loses a life and those cards are discarded in the open. The team starts with one life per player and one shuriken. **Throw shuriken** needs everyone still holding cards to agree, and makes each of them discard their lowest card. Clearing levels 2, 5 and 8 earns a shuriken (max 3), and levels 3, 6 and 9 a life (max 5). Clear every level (12 for 2 players, down to 5 for 7-8) to win. A game idle for 30 minutes ends as a loss.

After deploying, a human needs to run `npm run register` to publish the command. `wrangler deploy` applies the `v2` Durable Object migration that adds the `MindGame` class.

noxbot deliberately stores nothing personal beyond what a command needs (mail, reminders, stats). Features that would track personal details, like birthdays, are out of scope.

## Project structure

```
├── .github/workflows/ci.yaml -> test, lint, and deploy on main
├── src
│   ├── commands.js           -> command definitions (every export gets registered)
│   ├── register.js           -> registers commands with Discord
│   ├── server.js             -> interaction routing
│   ├── util.js               -> shared helpers
│   ├── functions/            -> one file per feature
│   └── resources/UserData.js -> Durable Object storage
├── test/                     -> mocha tests
└── wrangler.toml             -> Worker + Durable Object config
```

## Setup

You need a [Discord app](https://discord.com/developers/applications) with the `bot` and `applications.commands` scopes. In the developer portal, turn on the **Server Members** intent (for `/choosesomeone`) and the **Message Content** intent (for `/chattrack`).

Requires Node 22+.

```
npm install
```

Create `.dev.vars` (never commit it):

```
DISCORD_TOKEN=...
DISCORD_PUBLIC_KEY=...
DISCORD_APPLICATION_ID=...
COOL_GUY=...
```

Register commands (re-run whenever `commands.js` changes):

```
npm run register
```

## Running locally

```
npm start
npm run ngrok
```

Set the app's "Interactions Endpoint URL" in the developer portal to the ngrok HTTPS URL.

## Deploying

Pushes to `main` deploy through CI. That needs the `CF_API_TOKEN` and `CF_ACCOUNT_ID` repository secrets. To deploy by hand, run `npm run publish`.

Production secrets:

```
wrangler secret put DISCORD_TOKEN
wrangler secret put DISCORD_PUBLIC_KEY
wrangler secret put DISCORD_APPLICATION_ID
wrangler secret put COOL_GUY
```
