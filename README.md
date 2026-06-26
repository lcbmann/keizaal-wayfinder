# Keizaal Wayfinder

Keizaal Wayfinder is a TypeScript Discord bot for the Ranger Corps of Skyrim, an in-character organization inside Keizaal / Kaizal Online. Supabase is the source of truth for the roster, Trailmarks, promotion votes, and activity metadata.

## Features

- Slash commands for roster management, Trailmarks, promotion votes, exports, recruitment, and health checks.
- Discord role sync for exactly one main Ranger rank at a time.
- Senior Ranger is preserved as a separate recognition role and is not treated as a main rank.
- Private Trailmark channels with temporary per-user access.
- Promotion votes with buttons and manual approval or denial.
- Lightweight activity tracking without storing message content.

## Install

```bash
npm install
```

Copy `.env.example` to `.env` and fill every required value. Secrets and Discord IDs are read from environment variables only.

## Required Environment Variables

Required:

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_GUILD_ID`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TRAILMARK_CATEGORY_ID`
- `TRAILMARK_ACCESS_CHANNEL_ID`
- `ROLE_RANGER_COMMANDER_ID`
- `ROLE_RANGER_CAPTAIN_ID`
- `ROLE_RANGER_MARSHAL_ID`
- `ROLE_RANGER_ID`
- `ROLE_APPRENTICE_ID`
- `ROLE_SENIOR_RANGER_ID`
- `GUEST_ROLE_ID`
- all `CAREER_*_ROLE_ID` values in `.env.example`

Optional:

- `DEFAULT_TRAILMARK_ACCESS_MINUTES`, default `30`
- `PROMOTION_MIN_DAYS_APPRENTICE_TO_RANGER`, default `7`
- `INVITE_CHANNEL_ID`, required only for `/recruit invite`
- `CORPS_FUNDS_CHANNEL_ID`, required only for `/funds`

## Discord Setup

Enable the **Guild Members privileged intent** in the Discord Developer Portal. The bot uses `Guilds`, `GuildMembers`, and `GuildMessages`; it does not require `MessageContent`.

Recommended bot permissions:

- Use Slash Commands
- View Channels
- Send Messages
- Read Message History
- Manage Channels
- Manage Roles
- Create Instant Invite, if using `/recruit invite`

The bot role must be above all Ranger rank roles it manages:

- Ranger Commander
- Ranger Captain
- Ranger Marshal
- Ranger
- Apprentice

It does not remove Senior Ranger, career roles, Guest, or unrelated roles.

## Supabase

Run the migrations in `src/db/migrations/` in order in the Supabase SQL editor or through your migration workflow.

The migration creates:

- `rangers`
- `rank_history`
- `trailmarks`
- `trailmark_sessions`
- `promotion_votes`
- `promotion_vote_ballots`
- `member_activity_events`
- `corps_fund_transactions`
- `corps_fund_summary_state`
- `bot_message_state`

It also creates enum types, update triggers, indexes, and a partial unique index enforcing one active Trailmark session per Discord user.

## Commands

Register guild slash commands:

```bash
npm run deploy-commands
```

Run locally:

```bash
npm run dev
```

Type-check:

```bash
npm run check
```

Build:

```bash
npm run build
```

Implemented commands:

- `/ping`
- `/ranger info`
- `/ranger assignments`
- `/ranger audit`
- `/ranger inactive-review`
- `/ranger sync-member`
- `/ranger sync-all`
- `/ranger status`
- `/ranger set-hold`
- `/ranger sync-hold-roles`
- `/ranger note`
- `/ranger promote`
- `/trailmark panel`
- `/trailmark leave`
- `/trailmark list`
- `/trailmark sessions`
- `/trailmark create`
- `/trailmark deactivate`
- `/trailmark set-atlas`
- `/trailmark clear-atlas`
- `/promotion eligible`
- `/promotion open`
- `/promotion close`
- `/promotion approve`
- `/promotion deny`
- `/promotion ballots`
- `/roster export`
- `/recruit invite`
- `/recruit welcome`
- `/funds deposit`
- `/funds spend`
- `/funds set-balance`
- `/funds refresh-summary`
- `/funds balance`
- `/funds history`
- `/funds undo-last`
- `/funds monthly`

## Corps Funds

The `/funds` commands log donations, expenses, and balance adjustments in the configured Corps funds channel. Run the migration in `src/db/migrations/002_create_corps_fund_tables.sql`, set `CORPS_FUNDS_CHANNEL_ID`, and register slash commands again.

Use `/funds set-balance` once to seed the current fund total from old manual records. After that, use `/funds deposit` and `/funds spend`; Wayfinder posts each transaction and replaces the summary message so the current total stays at the bottom. `/funds history`, `/funds balance`, `/funds undo-last`, and `/funds monthly` support review and cleanup.

## Trailmarks

Each Trailmark is a private text channel under `TRAILMARK_CATEGORY_ID`. Everyone is denied by default. Ranger Commander and Ranger Captain roles receive permanent access. Rangers, Apprentices, and Marshals only receive temporary access when they visit a Trailmark.

Users visit Trailmarks by selecting one from the bot message posted by `/trailmark panel`. When a user selects a Trailmark, any previous active Trailmark session is revoked, the selected channel is opened for the configured duration, and the session is stored in Supabase. A background job runs every minute and also runs on startup, so expired access is revoked after bot restarts. The stored panel refreshes automatically when Trailmarks are created or deactivated.

## Role Sync

The centralized rank config lives in `src/config/ranks.ts`. Main rank roles are:

1. Ranger Commander
2. Ranger Captain
3. Ranger Marshal
4. Ranger
5. Apprentice

Only one main rank role should exist on a member. Promotion and roster sync remove other main rank roles and add the stored rank role. Senior Ranger is allowed to stack with the normal rank role.

Discord onboarding remains the entry point. If onboarding gives a user the Apprentice role, the bot adds or updates their roster entry as an Apprentice and tries to DM the nickname reminder. Guest-only users are skipped.

## Promotion Voting

Ranger Marshal or higher can open and close promotion votes. Ranger or higher can vote on Apprentice to Ranger votes. Higher target ranks require Ranger Marshal or higher to vote. Votes stay open until manually closed, and final approval or denial is manual.

Approving a vote promotes the candidate through the same service used by `/ranger promote`, writes rank history, updates Supabase, syncs Discord roles, refreshes the assignments board, and posts a promotion announcement embed.

## Assignment Board

`/ranger assignments` posts the persistent Ranger Corps assignments board in the current channel. Wayfinder remembers that board and refreshes it after rank, status, or hold changes.

## Deployment

Local development is fine initially. For production, run the bot on an always-running host such as Railway, Render paid, Fly.io, a VPS, or a similar service. Serverless request/response hosting is not appropriate for a persistent Discord gateway bot.

## Known Limitations

- Career roles are preserved but not stored in a separate table yet.
- Nickname enforcement is intentionally left as a TODO.
- Promotion eligibility warns through displayed reasons, but `/promotion open` still allows Marshal judgment for edge cases.
- The Atlas site is not implemented here; `trailmarks.atlas_location_id` is reserved for future integration.
