# noxbot

A Discord bot running on a Cloudflare Worker, with per-user data in a Durable Object.

Commands: `/coinflip`, `/8ball`, `/lengthwave` + `/leaderboard` (a Wavelength-style guessing game), mail (`/sendmail`, `/checkmail`, `/readmail`, `/deletemail`), stats (`/getstats`, plus admin-only `/incrementuserdata`, `/updatestats`, `/dropstats`), `/emote` (copy a 7tv emote), `/choosesomeone`, `/chattrack`, `/roll`, `/remindme` (DMs you later) and `/reminders` (list or cancel them), `/mind` (a cooperative card game), `/poker` (Hold'em and Omaha tables), settings (`/getsettings`, `/updatesettings`) and `/invite`.

Right-click menus: **Send mail** and **Get stats** on a user, **Steal emoji** on a message (copies its first custom emoji to the server).

## The Mind (`/mind`)

A cooperative card game for 2-8 players, played with buttons in a channel.

- `/mind start` opens a lobby with Join, Leave, Begin and Cancel buttons. The host presses Begin. One game per channel.
- `/mind end` ends the lobby or game (the host, any player or an admin). Ending a started game counts as a loss.
- `/mind leaderboard` shows the best teams by level reached.
- It also works in group DMs and DMs between users, once someone has added the app to their account (user install). There the bot can't edit the panel on its own, so it redraws it with the last button click's token, which Discord honours for 15 minutes. An idle-timeout notice can go missing in a long-idle group DM, but the game still ends. The bot's own DM is excluded, since a game needs two people.

Each level deals every player N cards (N is the level number) from 1-100. Together you must play every card in ascending order **without talking or signalling**, which is an honor rule: the bot cannot read the channel, so it is not enforced. Press **Play lowest** whenever you feel your lowest card is next, and **My hand** to privately see your cards. If anyone holds a lower card, the team loses a life and those cards are discarded in the open. The team starts with one life per player and one shuriken. **Throw shuriken** needs everyone still holding cards to agree, and makes each of them discard their lowest card. Clearing levels 2, 5 and 8 earns a shuriken (max 3), and levels 3, 6 and 9 a life (max 5). Clear every level (12 for 2 players, down to 5 for 7-8) to win. A game idle for 30 minutes ends as a loss.

After deploying, a human needs to run `npm run register` to publish the command. `wrangler deploy` applies the `v2` Durable Object migration that adds the `MindGame` class.

noxbot deliberately stores nothing personal beyond what a command needs (mail, reminders, stats). Features that would track personal details, like birthdays, are out of scope.

## Poker (`/poker`)

No-limit Texas Hold'em or pot-limit Omaha for 2-9 players, played with buttons in a channel (servers, group DMs and user DMs, like `/mind`). One table per channel.

- `/poker start` opens a table and seats you as host. Options (all optional): `variant` (holdem or plo), `mode` (casual or ranked), `seats` (2-9, default 6), `buyin` (default 500) with optional `buyin_min` / `buyin_max` for a range, `blinds`, `escalate`, `escalate_every`, `rebuys`, `max_rebuys`, `timer` and `ping`.
- `/poker end` closes the table (host or an admin). Mid-hand it closes after the hand. Everyone is cashed out.
- `/poker bank` shows your bankroll and ranked record, `/poker daily` tops it up, `/poker leaderboard` ranks ranked net profit, `/poker rules` shows hand rankings and the buttons.

**Buttons.** Sit (asks for a buy-in when the table has a range), Leave (takes effect after the hand), Fold, Check/Call, Raise (type the total you raise *to*), All-in, My hand (your cards, only to you), Rebuy, Sit out / in (toggles) and Start hand (the next hand also starts by itself 5 seconds after a hand ends). Cards show as `A♥️ T♠️`.

**Casual vs ranked.** Casual tables use table-only play money and store nothing. Ranked tables take your buy-in from a persistent bankroll and pay your stack back when you leave, bust or the table closes. New players start with $5,000. `/poker daily` adds $1,000 once every 24 hours while your balance is under $5,000. The leaderboard is ranked net profit (cash-outs minus buy-ins and rebuys); the daily top-up is not profit. The bank never takes a cut: across a table's life the players' bankroll changes sum to zero.

**Blind ladder.** `blinds` is a comma-separated list of `small/big` levels, at most 12, each big blind higher than the last, whole numbers, 100 characters at most. The default is `1/2,2/4,3/6,5/10,10/20,15/30,25/50,50/100`. For example `blinds:5/10,10/20,25/50` starts at 5/10. `blinds:1/2` is a fixed-blind table. The ladder only moves when `escalate` is on: blinds step up one level every `escalate_every` hands (default 10) and stay at the last level.

**Rebuys.** Between hands, if your stack is under the table's minimum buy-in, Rebuy tops you back up to the buy-in (ranked tables allow 3 by default, casual unlimited; change with `max_rebuys`, or turn off with `rebuys:false`).

**Timer.** You have `timer` seconds (default 60, 15-300) to act. When it runs out you check if that is free, otherwise fold. Two timeouts in a row sit you out until you press Sit out / in. A table with no activity for 30 minutes closes and cashes everyone out. With `ping` on, the bot posts a mention when it is your turn.

**Honest notes.** Ranked is play money: chips have no real value and the bankroll can only be changed through poker. The bot cannot read the channel, so it cannot stop players from colluding, sharing cards or running several accounts; treat ranked as a friendly ladder, not a tournament. Hole cards are kept inside the table's Durable Object and are only ever shown to their owner (and to everyone for hands that reach showdown).

After deploying, a human needs to run `npm run register` to publish the command. `wrangler deploy` applies the `v3` Durable Object migration that adds the `PokerTable` class (binding `NOXBOT_POKER`).

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
