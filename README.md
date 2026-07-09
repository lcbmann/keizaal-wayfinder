# Keizaal Wayfinder

Keizaal Wayfinder is a TypeScript Discord bot for the Ranger Corps of Skyrim, an in-character organization inside Keizaal / Kaizal Online. Supabase is the source of truth for the roster, Trailmarks, promotion votes, and activity metadata.

## Features

- Slash commands for roster management, Trailmarks, promotion votes, exports, recruitment, and health checks.
- Discord role sync for cumulative Ranger rank roles.
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

Enable the **Guild Members privileged intent** and **Message Content privileged intent** in the Discord Developer Portal. The bot uses `Guilds`, `GuildMembers`, `GuildMessages`, and `MessageContent`.

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
- `intel_settings`
- `intel_topics`
- `intel_reports`
- `intel_trailmark_visits`

It also creates enum types, update triggers, indexes, the Trailmark pinned flag, a partial unique index enforcing one active Trailmark session per Discord user, intel catchall topic state, and Atlas summary columns for intel reports.

Atlas remote share previews also expect the Supabase RPC `get_atlas_share(share_code text)` to exist. The current Ranger Corps Supabase project has that RPC; new database projects must provide the same function or remote Atlas share-code previews will be skipped.

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
- `/ranger retire-left`
- `/ranger set-hold`
- `/ranger sync-hold-roles`
- `/ranger note`
- `/ranger promote`
- `/trailmark panel`
- `/trailmark leave`
- `/trailmark list`
- `/trailmark sessions`
- `/trailmark create`
- `/trailmark edit`
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
- `/strongbox drop`
- `/strongbox setup`
- `/intel set-hq`
- `/intel topic-add`
- `/intel topic-edit`
- `/intel topic-list`
- `/intel catchall-set`
- `/intel catchall-clear`
- `/intel refresh`
- `/intel backfill`

## Corps Funds

The `/funds` commands log donations, expenses, and balance adjustments in the configured Corps funds channel. Run the migration in `src/db/migrations/002_create_corps_fund_tables.sql`, set `CORPS_FUNDS_CHANNEL_ID`, and register slash commands again.

Use `/funds set-balance` once to seed the current fund total from old manual records. After that, use `/funds deposit` and `/funds spend`; Wayfinder posts each transaction and replaces the summary message so the current total stays at the bottom. `/funds history`, `/funds balance`, `/funds undo-last`, and `/funds monthly` support review and cleanup.

## Trailmarks

Each Trailmark is a private text channel under `TRAILMARK_CATEGORY_ID`. Everyone is denied by default. Ranger Commander and Ranger Captain roles receive permanent access. Rangers, Apprentices, and Marshals only receive temporary access when they visit a Trailmark.

Users visit Trailmarks by selecting one from the bot message posted by `/trailmark panel`. When a user selects a Trailmark, any previous active Trailmark session is revoked, the selected channel is opened for the configured duration, and the session is stored in Supabase. The dropdown also includes `No Trailmark`, which revokes current access and clears the user's selection path. A background job runs every minute and also runs on startup, so expired access is revoked after bot restarts. The stored panel refreshes automatically when Trailmarks are created, edited, or deactivated.

`/trailmark edit` lets Ranger Marshal or higher update the name, hold, location description, screenshot, Atlas location ID, or pinned status. Pinned Trailmarks sort at the top of the dropdown panel. When the name changes, Wayfinder renames the Discord channel. Edits post an updated Trailmark info embed in the Trailmark channel and refresh the access panel.

## HQ Strongbox

`/strongbox setup` creates or repairs two channels under the Trailmarks category: `strongbox-drop`, where members leave private reports, and `hq-strongbox`, where Ranger Marshal or higher reads them. When someone posts in `strongbox-drop`, Wayfinder forwards the message and attachments to `hq-strongbox`, then removes the public copy. `/strongbox drop` remains available as a backup slash-command path.

## Trailmark Intel

Trailmark intel topics collect delivered reports from Trailmark channels into public bulletin channels. Configure the HQ delivery point with `/intel set-hq`, then add topics with `/intel topic-add`. Keywords are comma-separated, so a vampire topic should include variants such as `vampire,vampires`. Use `/intel topic-edit` to add keywords to an existing topic; set `append` to `false` only when you want to replace the full keyword list.

`/intel catchall-set` configures a dedicated keywordless fallback topic for delivered reports that do not match any normal topic. `/intel catchall-clear` disables future catchall capture without deleting existing reports.

When a message is posted in an active Trailmark channel, Wayfinder checks it against active intel topic keywords. Matching messages are stored as pending reports. A pending report is published only after a Ranger opens that source Trailmark after the report was written and later opens the configured HQ Trailmark. HQ-origin reports are published immediately. Bulletins are rebuilt in original report chronology and include the original reporter, source Trailmark, report time, original link, and the Ranger who delivered it to HQ.

Atlas share codes in Trailmark messages get a preview reply when Wayfinder can decode them. Intel reports also store Atlas summary metadata and include an Atlas Share field in the report embed.

`/intel backfill` scans old Trailmark messages into the current intel topics. It scans current Trailmark channels and the archived legacy `#trailmarks` forum (`1511443716420800673`), mapping forum thread names such as `Morthal Stash` to current Trailmarks where possible. Historical delivery mode uses existing `trailmark_sessions.created_at` records to publish reports when the same Ranger opened the source Trailmark after the report and later opened HQ. Reports without a historical delivery path remain pending for future delivery. Use `after` and `limit_per_trailmark` to keep scans bounded.

Automatic intel updates append newly delivered reports instead of rebuilding entire report channels. Use `/intel refresh` when you intentionally want to delete and rebuild a topic bulletin in strict original report chronology.

## Role Sync

The centralized rank config lives in `src/config/ranks.ts`. Main rank roles are:

1. Ranger Commander
2. Ranger Captain
3. Ranger Marshal
4. Ranger
5. Apprentice

Rank roles are cumulative. A Ranger keeps Apprentice; a Ranger Marshal keeps Ranger and Apprentice; Captains and Commanders keep the ranks below them. Promotion and roster sync add missing lower-rank roles and remove rank roles above the stored rank. Senior Ranger is allowed to stack with normal rank roles.

Discord onboarding remains the entry point. If onboarding gives a user the Apprentice role, the bot adds or updates their roster entry as an Apprentice and tries to DM the nickname reminder. Guest-only users are skipped.

When a rostered member leaves the Discord, Wayfinder marks their roster entry Retired and refreshes the assignments board. Marshal+ can also use `/ranger retire-left` with a Discord user ID to clean up older roster entries for people who already left.

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
- Trailmark intel captures new messages while the bot is online. Use `/intel backfill` for historical Trailmark posts.
