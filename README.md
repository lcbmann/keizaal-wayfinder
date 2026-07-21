# Keizaal Wayfinder

Keizaal Wayfinder is a TypeScript Discord bot for the Ranger Corps of Skyrim, an in-character organization inside Keizaal / Kaizal Online. Supabase is the source of truth for the roster, Trailmarks, promotion votes, and activity metadata.

## Features

- Slash commands for roster management, Trailmarks, promotion votes, exports, recruitment, and health checks.
- Discord role sync for cumulative Ranger rank roles.
- Senior Ranger is preserved as a separate recognition role and is not treated as a main rank.
- Private Trailmark channels with temporary per-user access.
- Promotion votes with buttons and manual approval or denial.
- Database-backed Corps duties with private applications, Marshal review, and Discord role sync.
- Voluntary Ranger-Apprentice pairings with matching requests, consent, and sponsored-recruit review.
- One private discussion thread per Strongbox entry.
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
- `RANK_ROLE_SYNC_EXEMPT_USER_IDS` (optional comma-separated Discord user IDs that should keep only their highest rank role)
- `GUEST_ROLE_ID`
- all `CAREER_*_ROLE_ID` values in `.env.example`

Optional:

- `DEFAULT_TRAILMARK_ACCESS_MINUTES`, default `30`
- `PROMOTION_MIN_DAYS_APPRENTICE_TO_RANGER`, default `7`
- `INVITE_CHANNEL_ID`, required only for `/recruit invite`
- `CORPS_FUNDS_CHANNEL_ID`, required only for `/funds`
- `NOTICE_BOARD_CHANNEL_ID`, optional explicit channel for apprenticeship matching notices; otherwise Wayfinder finds a text channel ending in `notice-board`
- `CORPS_INTEL_CATEGORY_ID`, required for automatic Corps intel channel creation and the Ranger Alliance bridge
- `RANGER_ALLIANCE_GUILD_ID`
- `RANGER_ALLIANCE_REPORTS_CATEGORY_ID`
- `RANGER_ALLIANCE_INTAKE_CHANNEL_ID`
- `RANGER_ALLIANCE_ADMIN_CHANNEL_ID`
- `RANGER_ALLIANCE_ROLE_LEADERS_ID`
- `RANGER_ALLIANCE_ROLE_UNDAUNTED_ID`
- `RANGER_ALLIANCE_ROLE_NORTH_STAR_ID`
- `RANGER_ALLIANCE_ROLE_RANGER_CORPS_ID`
- `RANGER_ALLIANCE_PRIVATE_MARKER`, defaults to `[CORPS ONLY]`

All Ranger Alliance values are optional as a group. Configure all of them to enable the Alliance intel bridge.

## Discord Setup

Enable the **Guild Members privileged intent** and **Message Content privileged intent** in the Discord Developer Portal. The bot uses `Guilds`, `GuildMembers`, `GuildMessages`, and `MessageContent`.

Recommended bot permissions:

- Use Slash Commands
- View Channels
- Send Messages
- Read Message History
- Manage Channels
- Manage Roles
- Create Public Threads
- Send Messages in Threads
- Manage Threads
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
- `supply_assignments`
- `supply_assignment_items`
- `supply_contributions`
- `corps_duties`
- `duty_applications`
- `ranger_duty_assignments`
- `apprenticeship_preferences`
- `apprenticeships`
- `field_name_proposals`
- `field_name_ballots`
- `ranger_field_names`
- `bot_message_state`
- `intel_settings`
- `intel_topics`
- `intel_reports`
- `intel_trailmark_visits`
- `alliance_intel_settings`
- `alliance_topic_mirrors`
- `alliance_intel_publications`
- `alliance_reports`
- `alliance_report_topic_publications`
- `alliance_headquarters`
- `alliance_headquarters_topic_channels`
- `alliance_headquarters_deliveries`
- `alliance_headquarters_publications`

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
- `/ranger clear-hold`
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
- `/supply create`
- `/supply log`
- `/supply undo-last`
- `/supply status`
- `/supply contributors`
- `/supply refresh`
- `/supply close`
- `/supply reopen`
- `/supply cancel`
- `/funds balance`
- `/funds history`
- `/funds undo-last`
- `/funds monthly`
- `/strongbox drop`
- `/strongbox setup`
- `/duty volunteer`
- `/duty withdraw`
- `/duty assign`
- `/duty remove`
- `/duty list`
- `/duty applications`
- `/duty setup`
- `/apprenticeship looking-for`
- `/apprenticeship withdraw-looking`
- `/apprenticeship propose`
- `/apprenticeship sponsor`
- `/apprenticeship assign`
- `/apprenticeship end`
- `/apprenticeship info`
- `/apprenticeship requests`
- `/field-name setup`
- `/field-name nominate`
- `/field-name list`
- `/field-name remove`
- `/field-name cancel`
- `/intel set-hq`
- `/intel topic-add`
- `/intel topic-edit`
- `/intel topic-list`
- `/intel catchall-set`
- `/intel catchall-clear`
- `/intel refresh`
- `/intel backfill`
- `/alliance setup`
- `/alliance sync`
- `/alliance status`

## Corps Funds

The `/funds` commands log donations, expenses, and balance adjustments in the configured Corps funds channel. Run the migration in `src/db/migrations/002_create_corps_fund_tables.sql`, set `CORPS_FUNDS_CHANNEL_ID`, and register slash commands again.

Use `/funds set-balance` once to seed the current fund total from old manual records. After that, use `/funds deposit` and `/funds spend`; Wayfinder posts each transaction and replaces the summary message so the current total stays at the bottom. `/funds history`, `/funds balance`, `/funds undo-last`, and `/funds monthly` support review and cleanup.

## Supply Assignments

Supply assignments track multi-item collection contracts in an auto-updating Discord post. Run `src/db/migrations/011_create_supply_assignments.sql` and redeploy slash commands before first use.

Ranger Marshal or higher can use `/supply create` in the text channel or assignments forum post where the board should remain. A job supports up to four item quotas, one client price per item, one Ranger payout rate per item, an organizer, and optional instructions. The board shows each quota, overall progress, contract value, expected Ranger payout, Corps margin, current amount owed, and contributor totals.

Apprentice or higher can use `/supply log` to record their own deliveries. One command can include up to four different item and quantity pairs. Marshal+ can select another member when recording or undoing a delivery. Assignment and item fields use autocomplete. Multi-item logs are atomic: if any entry is invalid or exceeds its remaining quota, none of the entries are recorded. Completing every quota automatically marks the assignment Completed. `/supply undo-last` corrects the latest individual item entry and reopens an automatically completed job when necessary. Marshal+ can also refresh, close, reopen, or cancel a job manually.

## Trailmarks

Each Trailmark is a private text channel under `TRAILMARK_CATEGORY_ID`. Everyone is denied by default. Ranger Commander and Ranger Captain roles receive permanent access. Rangers, Apprentices, and Marshals only receive temporary access when they visit a Trailmark.

Users visit Trailmarks by selecting one from the bot message posted by `/trailmark panel`. When a user selects a Trailmark, any previous active Trailmark session is revoked, the selected channel is opened for the configured duration, and the session is stored in Supabase. The dropdown also includes `No Trailmark`, which revokes current access and clears the user's selection path. A background job runs every minute and also runs on startup, so expired access is revoked after bot restarts. The stored panel refreshes automatically when Trailmarks are created, edited, or deactivated.

`/trailmark edit` lets Ranger Marshal or higher update the name, hold, location description, screenshot, Atlas location ID, or pinned status. Pinned Trailmarks sort at the top of the dropdown panel. When the name changes, Wayfinder renames the Discord channel. Edits post an updated Trailmark info embed in the Trailmark channel and refresh the access panel.

## HQ Strongbox

`/strongbox setup` creates or repairs two channels under the Trailmarks category: `strongbox-drop`, where members leave private reports, and `hq-strongbox`, where Ranger Marshal or higher reads them. When someone posts in `strongbox-drop`, Wayfinder forwards the message and attachments to `hq-strongbox`, removes the public copy, and starts a separate discussion thread from the private entry. Marshal+ can reply inside that thread without mixing separate Strongbox discussions together. `/strongbox drop` remains available as a backup slash-command path and creates the same threaded entry.

After deploying the threaded Strongbox update, run `/strongbox setup` once to add the required thread permissions to the existing channels.

## Corps Duties

Run migration `012_create_duties_and_apprenticeships.sql`, redeploy slash commands, and run `/duty setup` once. Wayfinder creates or reuses the Quartermaster, Craftsman, Warden, Detective, and Courier roles and stores their Discord role IDs in Supabase. The Wayfinder bot role must remain above these roles.

Apprentice or higher can run `/duty volunteer` in any accessible channel. The application appears as a review card in the Marshal-only Strongbox and receives its own discussion thread. Marshal+ approves or denies it using the card buttons. Approval records the assignment and grants the corresponding Discord role. Quartermaster permits only one active holder. Warden applications and assignments require a free-text Range; this will later be replaced by the Atlas-backed Range model.

Marshal+ can use `/duty assign` and `/duty remove` for direct administration, `/duty applications` to find pending review threads, and `/duty setup` to repair missing roles. `/duty list` is available to Corps members, and active duties also appear in `/ranger info`. Applicants can use `/duty withdraw` while an application is still pending.

## Apprenticeships

Apprenticeships are voluntary and do not replace the promotion vote system. Apprentice or higher may use the commands in any accessible channel.

`/apprenticeship looking-for` posts a public notice in the configured notice board: an Apprentice may seek a mentor and a Ranger+ may seek an Apprentice. Running the command again edits the same notice. `/apprenticeship withdraw-looking` removes it. The notice is also removed automatically when the member enters an apprenticeship. Marshal+ can see all current requests and pairings with `/apprenticeship requests`.

`/apprenticeship propose` pairs an existing Apprentice with an existing Ranger or higher. Wayfinder DMs the other participant with Accept and Decline buttons. An accepted proposal becomes active immediately and creates an informational Strongbox thread; it does not require Marshal approval.

`/apprenticeship sponsor` is for a new recruit who has already joined the Discord but does not yet have a Ranger roster entry. The sponsorship reason goes to a dedicated Strongbox review thread. Marshal approval gives the recruit the Apprentice role, removes Guest, creates the roster entry, and activates the pairing. Marshal+ can also use `/apprenticeship assign` to pair existing roster members directly.

Either participant may use `/apprenticeship end` to end their current pairing. Marshal+ may select another member to end that pairing. `/apprenticeship info` shows the current pairing for a selected member.

## Ranger Field Names

Run migration `014_create_field_names.sql`, redeploy slash commands, and run `/field-name setup` once as a Marshal. Wayfinder creates or repairs a `field-names` channel under the configured Trailmarks category and gives it to the `Ranger` role. Because main rank roles are cumulative, Ranger Captain, Marshal, and Commander members retain access; Apprentices do not.

Full Rangers use `/field-name nominate` to propose a name for an Apprentice or another Ranger. Self-nominations are rejected, and a nominee does not choose their own name. Each nomination gets its own discussion thread and Yes, No, and Abstain buttons. Full Rangers may vote, Apprentices cannot see the channel or vote, and the vote resolves automatically after 24 hours by majority of submitted Yes/No votes. Approved names are stored without changing Discord nicknames.

The Field Names bulletin lists assigned names, open nominations, and full Rangers still awaiting a name. It refreshes after promotion and on startup. `/field-name list` shows the assigned names; Marshal+ can use `/field-name remove` or `/field-name cancel` for administration.

## Trailmark Intel

Trailmark intel topics collect delivered reports from Trailmark channels into public bulletin channels. Configure the HQ delivery point with `/intel set-hq`, then add topics with `/intel topic-add`. Keywords are comma-separated, so a vampire topic should include variants such as `vampire,vampires`. Use `/intel topic-edit` to add keywords to an existing topic; set `append` to `false` only when you want to replace the full keyword list.

`/intel catchall-set` configures a dedicated keywordless fallback topic for delivered reports that do not match any normal topic. `/intel catchall-clear` disables future catchall capture without deleting existing reports.

When a message is posted in an active Trailmark channel, Wayfinder checks it against active intel topic keywords. Matching messages are stored as pending reports. A pending report is published only after a Ranger opens that source Trailmark after the report was written and later opens the configured HQ Trailmark. HQ-origin reports are published immediately. Bulletins are rebuilt in original report chronology and include the original reporter, source Trailmark, report time, original link, and the Ranger who delivered it to HQ.

Atlas share codes in Trailmark messages get a preview reply when Wayfinder can decode them. Intel reports also store Atlas summary metadata and include an Atlas Share field in the report embed.

`/intel backfill` scans old Trailmark messages into the current intel topics. It scans current Trailmark channels and the archived legacy `#trailmarks` forum (`1511443716420800673`), mapping forum thread names such as `Morthal Stash` to current Trailmarks where possible. Historical delivery mode uses existing `trailmark_sessions.created_at` records to publish reports when the same Ranger opened the source Trailmark after the report and later opened HQ. Reports without a historical delivery path remain pending for future delivery. Use `after` and `limit_per_trailmark` to keep scans bounded.

Automatic intel updates append newly delivered reports instead of rebuilding entire report channels. Use `/intel refresh` when you intentionally want to delete and rebuild a topic bulletin in strict original report chronology.

## Ranger Alliance Intel Bridge

The Ranger Alliance bridge uses separate information-delivery points rather than directly mirroring Corps intel. Run migrations `009_create_ranger_alliance_bridge.sql` and `010_create_alliance_headquarters.sql`, configure every `RANGER_ALLIANCE_*` value and `CORPS_INTEL_CATEGORY_ID`, deploy commands, then run `/alliance setup` in the configured Alliance admin channel as a member with the Leaders role.

Setup creates two Corps Trailmarks: `Stonehills - North Star Headquarters` and `Dancing Horse Inn - Undaunted Headquarters`. It also creates private `NORTH STAR INTEL` and `UNDAUNTED INTEL` categories in the Alliance server. North Star Rangers can only see Stonehills reports, and Undaunted members can only see Dancing Horse Inn reports. The Leaders role grants setup-command access but no intel visibility; leaders see only the section allowed by their organization role. The Ranger Corps role alone cannot see either category. The retired direct-mirror category is hidden from members and retained only as a bot-managed archive.

Each headquarters receives its own read-only copy of every active intel topic plus its own submission channel. A submission in `#north-star-submit-report` becomes an attributed note in the Stonehills Trailmark and is immediately available in North Star topic channels. An Undaunted submission behaves the same way at the Dancing Horse Inn. Neither submission reaches Hunter's Rest or the Corps intel channels until a Corps Ranger opens the source HQ Trailmark and later opens the Corps HQ Trailmark.

Corps Trailmark reports travel independently. Opening a source Trailmark and then Stonehills delivers those reports only to North Star channels. Carrying the same information to the Dancing Horse Inn delivers it only to Undaunted channels. Hunter's Rest remains the existing Corps delivery point and continues using the existing Corps intel channels.

Put `[CORPS ONLY]` anywhere in a Corps Trailmark message to keep it entirely inside the Trailmark network. Wayfinder does not create Corps intel records for it, publish it in Corps report channels, or deliver it to Stonehills, the Dancing Horse Inn, or the Ranger Alliance server. The marker is case-insensitive and can be changed with `RANGER_ALLIANCE_PRIVATE_MARKER`. Adding the marker while editing an existing report removes any previously published intel copies; removing the marker allows the message to be captured normally again.

Only `/ping` and `/alliance` are registered in the Alliance server. All roster, rank, promotion, Trailmark, activity, funds, and strongbox event handling remains restricted to `DISCORD_GUILD_ID`.

## Role Sync

The centralized rank config lives in `src/config/ranks.ts`. Main rank roles are:

1. Ranger Commander
2. Ranger Captain
3. Ranger Marshal
4. Ranger
5. Apprentice

Rank roles are cumulative. A Ranger keeps Apprentice; a Ranger Marshal keeps Ranger and Apprentice; Captains and Commanders keep the ranks below them. Promotion and roster sync add missing lower-rank roles and remove rank roles above the stored rank. Senior Ranger is allowed to stack with normal rank roles. Users listed in `RANK_ROLE_SYNC_EXEMPT_USER_IDS` keep only their stored highest rank role, while their rank and permissions remain unchanged.

Discord onboarding remains the entry point. If onboarding gives a user the Apprentice role, the bot adds or updates their roster entry as an Apprentice and tries to DM the nickname reminder. Guest-only users are skipped.

When a rostered member leaves the Discord, Wayfinder marks their roster entry Retired and refreshes the assignments board. Marshal+ can also use `/ranger retire-left` with a Discord user ID to clean up older roster entries for people who already left.

## Promotion Voting

Ranger Marshal or higher can open and close promotion votes. Ranger or higher can vote on Apprentice to Ranger votes. Higher target ranks require Ranger Marshal or higher to vote. Votes stay open until manually closed, and final approval or denial is manual.

Approving a vote promotes the candidate through the same service used by `/ranger promote`, writes rank history, updates Supabase, syncs Discord roles, refreshes the assignments board, and posts a promotion announcement embed.

## Assignment Board

`/ranger assignments` posts four persistent Ranger Corps messages for Leadership, Wardens, Detectives, and Apprenticeships. The Apprenticeship message shows active pairings and members looking for a mentor or Apprentice. Wayfinder remembers and replaces the set together after relevant roster, duty, or apprenticeship changes. Assigning a hold also assigns the Warden duty and role; run `/ranger sync-hold-roles` once to backfill existing hold assignments.

## Deployment

Local development is fine initially. For production, run the bot on an always-running host such as Railway, Render paid, Fly.io, a VPS, or a similar service. Serverless request/response hosting is not appropriate for a persistent Discord gateway bot.

## Known Limitations

- Career roles are preserved but not stored in a separate table yet.
- Nickname enforcement is intentionally left as a TODO.
- Promotion eligibility warns through displayed reasons, but `/promotion open` still allows Marshal judgment for edge cases.
- The Atlas site is not implemented here; `trailmarks.atlas_location_id` is reserved for future integration.
- Trailmark intel captures new messages while the bot is online. Use `/intel backfill` for historical Trailmark posts.
