# Keizaal Wayfinder

Keizaal Wayfinder is a TypeScript Discord bot for the Ranger Corps of Skyrim, an in-character organization inside Keizaal / Kaizal Online. Supabase is the source of truth for the roster, Trailmarks, promotion votes, and activity metadata.

## Features

- Slash commands for roster management, Trailmarks, promotion votes, exports, recruitment, and health checks.
- Discord role sync for cumulative Ranger rank roles.
- Senior Ranger is preserved as a separate recognition role and is not treated as a main rank.
- Private Trailmark channels with temporary access and optional standardized report forms.
- Ranger-only promotion posts with voting buttons, discussion threads, and manual approval or denial.
- Database-backed Corps duties and leadership applications with routed review threads and Discord role sync.
- Primary Rangers of each Hold plus local Warden appointments beneath a parent Hold.
- Voluntary Ranger-Apprentice pairings with matching requests, consent, and sponsored-recruit review.
- One private discussion thread per Strongbox entry.
- An in-character Headquarters Dispatch Desk with accumulated, rank-aware personal briefings and optional DM delivery.
- Wayfinder-managed assignment posts with Join, Withdraw, and Mark Complete controls; legacy Forum posts remain unchanged.
- No-cost patrol suggestions grounded in stale Trailmark visits and contact confirmations.
- A two-stage Ranger Runecloak admission, research-site, paired-expedition, and qualification record with Moonshadow confirmation gates.
- Lightweight activity tracking whose counters do not store ordinary message content.

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
- `NOTICE_BOARD_CHANNEL_ID`, optional explicit channel for apprenticeship matching notices; otherwise Wayfinder finds a text channel ending in `notice-board`
- `CORPS_INTEL_CATEGORY_ID`, required for automatic Corps intel channel creation and the Ranger Alliance bridge
- `RANGER_ALLIANCE_GUILD_ID`
- `RANGER_ALLIANCE_REPORTS_CATEGORY_ID`, optional legacy category to archive
- `RANGER_ALLIANCE_INTAKE_CHANNEL_ID`, retained only for legacy deployments
- `RANGER_ALLIANCE_ADMIN_CHANNEL_ID`
- `RANGER_ALLIANCE_ROLE_ADMIN_ID`, the only role allowed to run `/alliance` management commands
- `RANGER_ALLIANCE_ROLE_LEADERS_ID`
- `RANGER_ALLIANCE_ROLE_UNDAUNTED_ID`
- `RANGER_ALLIANCE_ROLE_NORTH_STAR_ID`
- `RANGER_ALLIANCE_ROLE_RANGER_CORPS_ID`
- `RANGER_ALLIANCE_PRIVATE_MARKER`, defaults to `[CORPS ONLY]`

The bridge requires `CORPS_INTEL_CATEGORY_ID`, `RANGER_ALLIANCE_GUILD_ID`,
`RANGER_ALLIANCE_ADMIN_CHANNEL_ID`, `RANGER_ALLIANCE_ROLE_ADMIN_ID`, and
`RANGER_ALLIANCE_ROLE_LEADERS_ID`.
The old group-role and legacy-category values are retained for compatibility;
new groups are configured from the Alliance server with `/alliance group-add`.

## Discord Setup

Enable the **Guild Members privileged intent** and **Message Content privileged intent** in the Discord Developer Portal. The bot uses `Guilds`, `GuildMembers`, `GuildMessages`, and `MessageContent`.

To show the aggregate **On Discord** Ranger count in the Atlas, also enable the **Presence Intent** in the Developer Portal and set `ATLAS_DISCORD_PRESENCE_ENABLED=true`. Leave the setting false until the portal intent is enabled; Discord rejects Gateway connections that request an unavailable privileged intent. The Atlas's **In Skyrim** count does not depend on Discord presence and continues to use recent game-link heartbeats.

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
- `structured_trailmark_reports`
- `structured_report_contact_forwards`
- `corps_medals`
- `ranger_medal_awards`
- `historical_corps_members`
- `apprenticeship_preferences`
- `apprenticeships`
- `field_name_proposals`
- `field_name_ballots`
- `ranger_field_names`
- `briefing_dispatches`
- `briefing_user_settings`
- `managed_assignments`
- `managed_assignment_participants`
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
- `corps_qualifications`
- `ranger_qualifications`
- `runecloak_settings`
- `runecloak_team_assignments`
- `runecloak_applications`
- `runecloak_research_sites`
- `runecloak_spells`
- `runecloak_cycles`
- `runecloak_cycle_members`
- `runecloak_spell_progress`
- `runecloak_stages`
- `runecloak_sessions`
- `runecloak_session_participation`
- `runecloak_audit_events`

It also creates enum types, update triggers, indexes, the Trailmark pinned flag, a partial unique index enforcing one active Trailmark session per Discord user, and intel catchall topic state.

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

Tests:

```bash
npm run test
```

Implemented commands:

- `/ping`
- `/ranger info`
- `/ranger briefing`
- `/ranger assignments`
- `/ranger audit`
- `/ranger inactive-review`
- `/ranger sync-member`
- `/ranger sync-all`
- `/ranger sync-join-history`
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
- `/trailmark report`
- `/atlas link`
- `/promotion setup`
- `/promotion eligible`
- `/promotion status`
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
- `/supply redistribute`
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
- `/briefing setup`
- `/briefing send`
- `/briefing settings`
- `/assignment setup`
- `/assignment create`
- `/patrol suggest`
- `/duty assign`
- `/duty remove`
- `/duty list`
- `/duty setup`
- `/application apply`
- `/application withdraw`
- `/application list`
- `/application setup`
- `/apprenticeship looking-for`
- `/apprenticeship withdraw-looking`
- `/apprenticeship propose`
- `/apprenticeship sponsor`
- `/apprenticeship assign`
- `/apprenticeship end`
- `/apprenticeship info`
- `/apprenticeship requests`
- `/field-name setup`
- `/field-name open`
- `/field-name suggest`
- `/field-name close`
- `/field-name list`
- `/field-name remove`
- `/field-name cancel`
- `/contact setup`
- `/contact create`
- `/contact create-group`
- `/contact edit`
- `/contact list`
- `/contact link-member`
- `/contact unlink-member`
- `/contact archive`
- `/medal setup`
- `/medal create`
- `/medal award`
- `/medal revoke`
- `/medal list`
- `/vote open`
- `/vote close`
- `/vote audit`
- `/intel set-hq`
- `/intel topic-add`
- `/intel topic-edit`
- `/intel topic-list`
- `/intel catchall-set`
- `/intel catchall-clear`
- `/intel refresh`
- `/intel repair-reporters`
- `/intel backfill`
- `/alliance setup`
- `/alliance sync`
- `/alliance status`
- `/alliance group-add`
- `/alliance group-topics`
- `/alliance group-remove`
- `/alliance headquarters-remove`
- `/runecloak apply`
- `/runecloak withdraw`
- `/runecloak survey`
- `/runecloak survey-screenshot`
- `/runecloak status`
- `/runecloak record`
- `/runecloak manage`
- `/runecloak audit`
- `/runecloak setup`
- `/runecloak program set`
- `/runecloak team add`
- `/runecloak team remove`
- `/runecloak cycle create`
- `/runecloak cycle add`
- `/runecloak cycle remove`
- `/runecloak cycle lock`
- `/runecloak cycle start`
- `/runecloak cycle exclude`
- `/runecloak cycle complete`
- `/runecloak stage create`
- `/runecloak stage submit-session`
- `/runecloak stage verify-session`
- `/runecloak stage verify`

## Corps Funds

The `/funds` commands log donations, expenses, and balance adjustments in the configured Corps funds channel. Run the migration in `src/db/migrations/002_create_corps_fund_tables.sql`, set `CORPS_FUNDS_CHANNEL_ID`, and register slash commands again.

Use `/funds set-balance` once to seed the current fund total from old manual records. After that, use `/funds deposit` and `/funds spend`; Wayfinder posts each transaction and replaces the summary message so the current total stays at the bottom. `/funds history`, `/funds balance`, `/funds undo-last`, and `/funds monthly` support review and cleanup.

## Supply Assignments

Supply assignments track multi-item collection contracts in an auto-updating Discord post. Run `src/db/migrations/011_create_supply_assignments.sql` and redeploy slash commands before first use.

Ranger Marshal or higher can use `/supply create` in the text channel or assignments forum post where the board should remain. A job supports up to four item quotas, one client price per item, one Ranger payout rate per item, an organizer, and optional instructions. The board shows each quota, overall progress, contract value, expected Ranger payout, Corps margin, current amount owed, and contributor totals.

Apprentice or higher can use `/supply log` to record their own deliveries. One command can include up to four different item and quantity pairs. Marshal+ can select another member when recording or undoing a delivery. Assignment and item fields use autocomplete. Multi-item logs are atomic: if any entry is invalid or exceeds its remaining quota, none of the entries are recorded. Completing every quota automatically marks the assignment Completed. `/supply undo-last` corrects the latest individual item entry and reopens an automatically completed job when necessary. Marshal+ can also refresh, close, reopen, or cancel a job manually.

Marshal+ can use `/supply redistribute` when a character change means that earlier contributions should no longer be credited to the current Discord account. Provide the contributor's Discord ID, an ISO cutoff timestamp, and either weighted or even distribution. Only that account's contributions before the cutoff are moved, and each source entry can be redistributed only once. The original contribution rows remain preserved; the board and payout totals apply the audited redistribution while leaving collected quantities, quotas, and Corps profit unchanged.

## Trailmarks

Each Trailmark is a private text channel under `TRAILMARK_CATEGORY_ID`. Everyone is denied by default. Ranger Commander and Ranger Captain roles receive permanent access. Rangers, Apprentices, and Marshals only receive temporary access when they visit a Trailmark.

Users visit Trailmarks by selecting one from the bot message posted by `/trailmark panel`. When a user selects a Trailmark, any previous active Trailmark session is revoked, the selected channel is opened for the configured duration, and the session is stored in Supabase. The dropdown also includes `No Trailmark`, which revokes current access and clears the user's selection path. A background job runs every minute and also runs on startup, so expired access is revoked after bot restarts. The stored panel refreshes automatically when Trailmarks are created, edited, or deactivated.

`/trailmark edit` lets Ranger Marshal or higher update the name, hold, location description, screenshot, Atlas location ID, or pinned status. Pinned Trailmarks sort at the top of the dropdown panel. When the name changes, Wayfinder renames the Discord channel. Edits post an updated Trailmark info embed in the Trailmark channel and refresh the access panel.

Apprentice or higher can use `/trailmark report` while inside an open Trailmark channel. The command opens either a **General** or **Incident** Discord form and can link up to three existing contacts plus three participating Rangers. Submission posts one visible, standardized report card in that Trailmark and passes its full text through the same Intel keyword and catchall flow as an ordinary message. Reports linked to contacts are copied into those contacts' Forum threads only after the report reaches Corps Headquarters; reports written at Headquarters are eligible immediately.

Wayfinder adds the Corps `salute` reaction to every new message in the notice board, active Trailmark channels, and configured Corps Intel report channels, including standardized reports, Atlas drops, and Ally Reports. Members can add their own salute to the seeded reaction to mark a report as read. Existing messages are not backfilled.

`/atlas link` creates a ten-minute code for the member to enter under **Link Discord** in the Atlas. After the Atlas device is linked, opening an Atlas location that has a matching active Trailmark creates a pending Discord access request. Wayfinder polls those requests every five seconds, verifies the linked Discord member still has Apprentice-or-higher Trailmark access, opens the matching Trailmark channel for the configured duration, and runs the same Intel capture and HQ delivery flow as the Discord dropdown.

After a linked member records a visit, the Atlas can also queue a **Leave Drop** message for that Trailmark. Wayfinder verifies the member and Trailmark again, posts the message into the matching private channel under an Atlas field-drop embed, and routes the submitted text through the same Intel keyword/catchall categories as ordinary Trailmark messages. Non-HQ drops still follow the normal delivery step before appearing in public Intel bulletins. The Trailmark channel itself remains private: another Ranger must open that Trailmark through the Discord panel to read it. Apply Ranger Map migrations `202607300001_create_atlas_trailmark_visits.sql`, `202607300002_fix_atlas_trailmark_visit_conflict.sql`, `202607300003_create_atlas_overwatch_and_trailmark_drops.sql`, and `202607300004_track_atlas_trailmark_departures.sql` to the shared Supabase project before using these bridges.

## Ranger Briefings

Apply `src/db/migrations/045_add_briefings_and_managed_assignments.sql`, redeploy slash commands, create a read-only Headquarters briefing channel, and run `/briefing setup` there as a Marshal. Wayfinder posts and pins one **Headquarters Dispatch Desk** card with a persistent **Collect My Briefing** button. `/ranger briefing` performs the same collection from any accessible command channel.

Briefings accumulate until the member next collects them. They are primarily in-character and are filtered by current rank: all Corps members receive general dispatches and major leadership promotions, Ranger+ receives new promotion votes and contact records, Marshal+ receives new or updated Strongbox matters, and apprenticeship participants receive their own pairing records. New managed assignments go only to members eligible to join. Marshal+ can use `/briefing send` to file an IC dispatch for a rank group or one named member; the OOC option is deliberately separate and should be used sparingly.

By default, deliberate collection sends the packet by DM and confirms privately in Discord. If the DM cannot be delivered, Wayfinder falls back to the private interaction response without losing the unread items. Members can use `/briefing settings` to keep future packets entirely in the private interaction response. There is no scheduled digest or unsolicited DM.

## Ranger Runecloaks

Apply `src/db/migrations/046_create_runecloak_system.sql`, redeploy slash commands, and run `/runecloak setup` as Commander. Select the existing **THE RUNIC CLOAK** category, the existing `runecloak` discussion channel, and the permanent `Ranger Runecloak` role (`1543999251820839073`). The server must already have the `:runecloak:` emoji, and Wayfinder's Discord role must sit above every Runecloak role it manages. Wayfinder creates or reuses a Ranger+ read-only `runecloak-information` channel, a `runecloak-expeditions` Forum, and a temporary non-hoisted `Runecloak Learner` role. The optional organizer role remains an operating assignment rather than a qualification or internal rank. No new environment variable is required.

Ranger Runecloak is a specialist qualification. It does not grant command authority, Corps standing, or duty permissions. Every applicant, including the original organizing group, follows the same entry path: use `/runecloak apply`, receive a survey request through the Headquarters briefing, find a place in Skyrim resonant with Magicka, add it to the Atlas, file a short Ranger report, and submit the Atlas reference with `/runecloak survey`. A screenshot is encouraged and can be attached immediately afterward with `/runecloak survey-screenshot`. Authorized Runecloak Marshals review surveys; Captain+ gives final admission approval. Approved applicants enter a waiting pool rather than receiving the qualification immediately.

Official study uses one locked cycle at a time. The initial minimum roster is 20. Each study stage contains a paired EU and NA expedition, and a learner may attend either one. At least 51 percent of the original locked roster must attend across the pair for the stage to count. Learners record the result of their in-game `/roll 100`; Wayfinder never generates a roll and accepts only one roll per learner per paired stage. Authorized Marshals verify the session evidence, and only verified valid stages add to the shared 8,000-point target. Apprentices may attend suitable expeditions as non-counting observers after the program is registered.

When the target is reached, `/runecloak cycle complete` shows Captain+ a final attendance preview. The confirmation form is prefilled with eligible Rangers so staff can remove anyone Moonshadow did not actually approve before recording the grant reference. A learner must attend a majority of valid paired stages. Anyone who falls short keeps proportional verified attendance credit for a later cycle of the same spell without carrying old roll points into the new shared total. Completing the first confirmed Oakflesh cycle grants the permanent Runecloak role, adds a separate **Qualifications** field to `/ranger info`, records the qualification in the Honors Record, and includes its badge in synchronized Atlas profiles.

## Managed Assignments and Patrol Suggestions

After applying migration `045`, run `/assignment setup` once as a Marshal and select the existing Assignments Forum. Wayfinder adds its status, rank, and Hold tags without converting or editing any legacy posts. Ranger+ can then use `/assignment create` to open a five-field Discord form. Each new managed post has Join, Withdraw, and Mark Complete controls, a live participant list, and a briefing dispatch for eligible members. Only the organizer or Marshal+ can complete it.

Apprentice+ can use `/patrol suggest` in `#general`, optionally choosing a Hold. Without a choice, Wayfinder uses the member's assigned Hold or a stable daily rotation. The suggestion combines the Hold's least recently opened Trailmark with its stalest active contact or group record. It creates no assignment and uses no AI or external API.

## HQ Strongbox

`/strongbox setup` creates or repairs two channels under the Trailmarks category: `strongbox-drop`, where members leave private reports, and `hq-strongbox`, where Ranger Marshal or higher reads them. When someone posts in `strongbox-drop`, Wayfinder forwards the message and attachments to `hq-strongbox`, removes the public copy, and starts a separate discussion thread from the private entry. Marshal+ can reply inside that thread without mixing separate Strongbox discussions together. `/strongbox drop` remains available as a backup slash-command path and creates the same threaded entry.

After deploying the threaded Strongbox update, run `/strongbox setup` once to add the required thread permissions to the existing channels.

## Corps Duties

Run migrations `012_create_duties_and_apprenticeships.sql`, `023_add_ambassador_duty.sql`, `033_rename_detective_to_agent.sql`, `036_rework_applications_promotions_and_wardens.sql`, and `042_add_instructor_duty.sql`, redeploy slash commands, and run `/duty setup` once. Wayfinder creates or reuses the Quartermaster, Craftsman, Warden, Agent, Courier, Ambassador, and Instructor roles and stores their Discord role IDs in Supabase. Quartermaster, Warden, Agent, Ambassador, and Instructor are Ranger+ duties; Craftsman and Courier are available to Apprentices+. Instructors plan and lead practical Corps training. The Wayfinder bot role must remain above these roles.

`/application apply` replaces `/duty volunteer`. Applicants choose a position and complete its Discord form. They can apply for a normal duty, **Hold Warden**, **Local Warden**, **Ranger Marshal**, or **Ranger Captain**. An appointed Hold Warden is displayed publicly as **Ranger of [Hold]**. Normal duty and local Warden applications go to the Marshal Strongbox for approval or denial. Marshal applications go to the configured Marshal+ review channel; Captain applications go to the configured Captain+ review channel. Every application gets its own private discussion thread. Run `/application setup` once as Commander to store the two restricted leadership review channels and enforce their visibility.

Approval of a duty application records the assignment and grants the duty role. Leadership applications use a separate approval gate: Captain+ reviews Marshal applications and the Commander reviews Captain applications. Approval opens a linked vote in the configured Ranger promotion channel, mentions the Ranger role, and allows all Ranger+ members to vote. Applicants use `/application withdraw`; reviewers use `/application list`, with Captain applications hidden from ordinary Marshals. Marshal+ can still use `/duty assign` and `/duty remove` for direct administration, while primary Hold appointments require Captain+. `/duty list` is available to Corps members, and active duties also appear in `/ranger info`.

All Hold representatives remain Wardens, but Wayfinder distinguishes their appointments:

- **Ranger of [Hold]** is the one primary, selective representative responsible for coordinating that Hold. Only one may be active per Hold, and one Ranger may hold only one such primary appointment.
- **Warden of [Local Range]** covers a town, road, lake, or similar area under a parent Hold. A Ranger may hold multiple distinct local appointments.

When a Ranger becomes Inactive or Retired, leaves the server, or is cleaned up with `/ranger retire-left`, Wayfinder ends their active duties and removes their Hold appointment. Use `/ranger set-hold` and `/ranger clear-hold` for primary Hold appointments; use `/duty assign` and `/duty remove` for local Wardens.

## Ranger Contacts

Apply `src/db/migrations/026_create_contacts.sql`, `src/db/migrations/038_expand_contacts_with_groups.sql`, and `src/db/migrations/039_link_contact_group_members.sql`, redeploy slash commands, and run `/contact setup` once as a Marshal. The command creates or repairs an Apprentice+ `contacts` Forum containing records for both individual contacts and known groups. An optional category can be supplied when setting it up. Apprentices can read, discuss, create, edit, link, and assess entries while Wayfinder maintains each opening record card.

Apprentice or higher can use `/contact create`, `/contact create-group`, `/contact edit`, and `/contact list` from any accessible channel, and can use the assessment buttons on record cards. Person records contain the contact's name, race, sex, occupation, faction, Hold or region, usual locations, commentary, and an optional **High Priority** flag. Group records contain a category, estimated strength, identifying signs, arms or capabilities, tactics, territory, affiliation, additional intelligence, and the same region and priority fields. Wayfinder creates one Forum post and adds the appropriate region, occupation or **Group**, and High Priority tags.

Person cards use **Still good**, **Cold**, **Not found**, **MIA**, and **Propose archive** assessments. Group cards use **Active**, **Inactive**, **Not sighted**, **Disbanded**, and **Propose archive**. Each member has one current assessment per record and can change it later. The card always shows the current rating, assessment totals, and last confirmation. Archive proposals do not delete anything; Marshal+ uses `/contact archive` to close an entry while preserving its history. `/contact edit` updates the same Forum post, and `/contact list` can filter by record type, Hold, occupation, group category, and priority.

Use `/contact link-member` to connect an existing person record to an existing group as a known member; use `/contact unlink-member` to remove that relationship. Both commands are available to Apprentice+ and update both Forum cards immediately. Group cards list their known members, while person cards list their known group affiliations. A person may belong to more than one group.

Discord Forums allow only 20 custom tags, so the built-in tags cover the nine Holds, Cross-Skyrim, Other Region, common occupations, Other Occupation, Group, and High Priority. Group categories, factions, and detailed locations remain on the record card.

Standardized `/trailmark report` submissions may link up to three person or group records. Once the report reaches Corps Headquarters, Wayfinder posts a copy in every linked record's discussion thread. A report linked to a person is also copied to every group that person is linked to, without duplicating a group that was selected directly. Reports written at Headquarters are linked immediately; reports left elsewhere remain undisclosed until they are carried back through the normal Trailmark delivery flow.

## Apprenticeships

Apprenticeships are voluntary and do not replace the promotion vote system. Apprentice or higher may use the commands in any accessible channel.

`/apprenticeship looking-for` posts a public notice in the configured notice board: an Apprentice may seek a mentor and a Ranger+ may seek an Apprentice. Running the command again edits the same notice. `/apprenticeship withdraw-looking` removes it. The notice is also removed automatically when the member enters an apprenticeship. Marshal+ can see all current requests and pairings with `/apprenticeship requests`.

`/apprenticeship propose` pairs an existing Apprentice with an existing Ranger or higher. Wayfinder DMs the other participant with Accept and Decline buttons. An accepted proposal becomes active immediately and creates an informational Strongbox thread; it does not require Marshal approval.

`/apprenticeship sponsor` is for a new recruit who has already joined the Discord but does not yet have a Ranger roster entry. The sponsorship reason goes to a dedicated Strongbox review thread. Marshal approval gives the recruit the Apprentice role, removes Guest, creates the roster entry, and activates the pairing. Marshal+ can also use `/apprenticeship assign` to pair existing roster members directly.

Either participant may use `/apprenticeship end` to end their current pairing. Marshal+ may select another member to end that pairing. `/apprenticeship info` shows the current pairing for a selected member.

## Corps Medals

Apply migrations `027_create_ranger_medals.sql`, `028_create_historical_corps_members.sql`, and `043_automate_long_watch_medals.sql`, redeploy slash commands, then run `/medal setup` once as a Marshal. Wayfinder creates one non-hoisted Discord role for each medal and backfills the built-in **Mentor** medal from active and completed apprenticeship history. New active apprenticeships award it automatically. **Long Watch** is reconciled automatically as cumulative Bronze, Silver, and Gold service records at 30, 90, and 180 days; incorrect prior awards and Discord roles are removed during synchronization.

Marshal+ can use `/medal create` to define additional honors and `/medal award` or `/medal revoke` to manage recipients. The optional emoji accepts Unicode, a custom emoji, or a server emoji name; Wayfinder uses it on profiles and attempts to use it as the medal role icon. `/medal list` is available to Corps members. In `/ranger info`, rank icons, Senior Ranger and duty icons, and Marshal-awarded honors all appear together as the member's Medals, ordered by Discord role position.

Historical Corps standing includes Retired roster rows and the pre-Wayfinder members recorded in `historical_corps_members`. Migration 028 seeds the three original-roster entries that were absent from Supabase. A historical row is ignored automatically if a normal roster member with the same Discord username later exists.

## Ranger Field Names

Apply migrations `014_create_field_names.sql`, `015_field_name_contests.sql`, `016_add_field_name_veto_notice.sql`, `017_close_legacy_field_name_polls.sql`, `018_create_field_name_contests.sql`, and `019_field_name_contests_open_ended.sql`, deploy the bot, and run `/field-name setup` once as a Marshal. Migration 017 cancels every old open poll so none can resolve under the previous rules. Migration 019 removes the deadline from the current contest. Wayfinder removes old posts and repairs a `field-names` channel under the configured Trailmarks category. Because main rank roles are cumulative, Ranger Captain, Marshal, and Commander members retain access; Apprentices do not.

Marshal+ uses `/field-name open` to create an open-ended contest for an Apprentice or Ranger. Starting names are optional and can be entered as a comma-separated list. Rangers can add choices with the post's **Nominate a name** button and form, or with `/field-name suggest`; the bot edits the same contest post instead of creating another poll. Each contest also has a discussion thread. Each full Ranger, including the nominee, chooses one option with a button and may change that choice. When a clear leader has emerged, a Marshal+ uses `/field-name close` with the contest ID. The leading option wins; ties or contests with no votes assign no name. The nominee also receives a private veto button to reject the entire contest. Approved names are stored without changing Discord nicknames.

The Field Names bulletin lists assigned names, open contests, and full Rangers still awaiting a name. It refreshes after promotion and on startup. `/field-name list` shows assigned names; Marshal+ can use `/field-name remove` or `/field-name cancel` for administration.

## Trailmark Intel

Trailmark intel topics collect delivered reports from Trailmark channels into public bulletin channels. Configure the HQ delivery point with `/intel set-hq`, then add topics with `/intel topic-add`. Keywords are comma-separated, so a vampire topic should include variants such as `vampire,vampires`. Use `/intel topic-edit` to add keywords to an existing topic; set `append` to `false` only when you want to replace the full keyword list.

`/intel catchall-set` configures a dedicated keywordless fallback topic for delivered reports that do not match any normal topic. `/intel catchall-clear` disables future catchall capture without deleting existing reports.

When a message is posted in an active Trailmark channel, Wayfinder checks it against active intel topic keywords. Matching messages are stored as pending reports. A pending report is published only after a Ranger opens that source Trailmark after the report was written and later opens the configured HQ Trailmark. HQ-origin reports are published immediately. Bulletins are rebuilt in original report chronology and include the original reporter, source Trailmark, report time, original link, and the Ranger who delivered it to HQ. Topic-specific report embeds use the matching category emoji in their titles; Ally Reports use the teamwork emoji.


`/intel backfill` scans old Trailmark messages into the current intel topics. It scans current Trailmark channels and the archived legacy `#trailmarks` forum (`1511443716420800673`), mapping forum thread names such as `Morthal Stash` to current Trailmarks where possible. Historical delivery mode uses existing `trailmark_sessions.created_at` records to publish reports when the same Ranger opened the source Trailmark after the report and later opened HQ. Reports without a historical delivery path remain pending for future delivery. Use `after` and `limit_per_trailmark` to keep scans bounded.

Automatic intel updates append newly delivered reports instead of rebuilding entire report channels. Report embeds resolve the reporter's current Discord nickname when available. Use `/intel repair-reporters` to update existing posted report embeds in place, including current reporter names and category emojis, without deleting or reposting them. Use `/intel refresh` only when you intentionally want to delete and rebuild a topic bulletin in strict original report chronology.

## Ranger Alliance Intel Bridge

The Ranger Alliance bridge uses separate information-delivery points rather than directly mirroring Corps intel. Run migrations `009_create_ranger_alliance_bridge.sql`, `010_create_alliance_headquarters.sql`, `020_dynamic_alliance_groups.sql`, and `021_add_alliance_intake_emoji.sql`, configure the required bridge values and `CORPS_INTEL_CATEGORY_ID`, deploy commands, then run `/alliance setup` in the configured Alliance admin channel as a member with the dedicated Alliance admin role. The Leaders role is not sufficient to run Alliance management commands.

`/alliance setup` and `/alliance sync` repair active records only. They do not backfill or repost historical reports. The migration deactivates the retired Undaunted group while preserving its records for history.

Use `/alliance group-add` to create a new ally group. Provide its Alliance role, headquarters name, Core hold, cache description, and a comma-separated list of intel topics, or `all` for every current topic. The optional `submit_emoji` value accepts a Unicode emoji such as `📜` and controls the intake channel name; report channels automatically use standard Unicode topic emojis. Wayfinder creates the group's HQ Trailmark, private intake channel, report category, and only the selected report channels, then backfills reports created in the previous seven days. Use `/alliance group-topics` later to change the allowed topics; disabling a topic stops future publications without deleting its history. Use `/alliance group-remove` (or `/alliance headquarters-remove`) to archive the group's channels, deactivate its HQ Trailmark, remove its topic mappings, and stop future delivery.

Reports reach a group's Alliance channels only when they are delivered to that group's HQ Trailmark. Reports submitted in that group's intake channel are first recorded in its HQ Trailmark and become available in the topics selected for that group. A report delivered to one group's HQ does not appear in another group's channels. Alliance Leaders can manage the bridge but are explicitly denied report-category visibility; the group's viewer role controls access.

Put `[CORPS ONLY]` anywhere in a Corps Trailmark message to keep it entirely inside the Trailmark network. Wayfinder does not create Corps intel records for it, publish it in Corps report channels, or deliver it to Stonehills, the Dancing Horse Inn, or the Ranger Alliance server. The marker is case-insensitive and can be changed with `RANGER_ALLIANCE_PRIVATE_MARKER`. Adding the marker while editing an existing report removes any previously published intel copies; removing the marker allows the message to be captured normally again.

Only `/ping` and `/alliance` are registered in the Alliance server. All roster, rank, promotion, Trailmark, activity, funds, and strongbox event handling remains restricted to `DISCORD_GUILD_ID`.

## Role Sync

The centralized rank config lives in `src/config/ranks.ts`. Main rank roles are:

1. Ranger Commander
2. Ranger Captain
3. Ranger Marshal
4. Ranger
5. Apprentice

Rank roles are cumulative. A Ranger keeps Apprentice; a Ranger Marshal keeps Ranger and Apprentice; Captains and Commanders keep every main rank below them. Promotion and roster sync add missing lower-rank roles and remove rank roles above the stored rank. Senior Ranger is allowed to stack with normal rank roles.

Discord onboarding remains the entry point. If onboarding gives a user the Apprentice role, the bot adds or updates their roster entry as an Apprentice and tries to DM the nickname reminder. Guest-only users are skipped.

When a rostered member leaves the Discord, Wayfinder marks their roster entry Retired and refreshes the assignments board. Marshal+ can also use `/ranger retire-left` with a Discord user ID to clean up older roster entries for people who already left.

## Promotion Voting

Create a dedicated Ranger-only text channel, then run `/promotion setup` once as Marshal+. Wayfinder applies Ranger-only visibility, stores the destination, moves or repairs promotion posts there, and creates one discussion thread for each vote. Apprentice-to-Ranger votes and approved Marshal/Captain application votes are visible to Ranger+, with the Ranger role mentioned when an approved leadership application enters voting. Votes stay open until manually closed, and final approval or denial is manual.

Marshal+ can use `/promotion status` to mark an Apprentice as `In Field Trial`, `On Hold`, or clear the progress status. `/promotion eligible` shows these as separate sections alongside Ready for Review and Not Yet Ready. Promotion approval clears the progress status automatically.

Approving a vote promotes the candidate through the same service used by `/ranger promote`, writes rank history, updates Supabase, syncs Discord roles, refreshes the assignments board, and posts a promotion announcement embed.
On startup and during `/promotion setup`, Wayfinder closes and removes stale open votes when the candidate already holds the target rank. Manual `/ranger promote` performs the same cleanup so an out-of-band promotion cannot leave an obsolete vote behind.

## Channel Votes

Channel moderators, Corps Marshals, Alliance admins, and server administrators can use `/vote open` in any channel they manage. The default format is an auditable **Yes / No / Abstain** vote. Selecting **Multiple choice** opens a form for the question, context, and 2-10 options; write each option on its own line as `Option | optional description`. Members who can view the channel cast one private, changeable ballot through the buttons or option menu. `/vote close` preserves the final tally and locks its discussion thread, while `/vote audit` privately exports every named ballot as TSV.

## Assignment Board

`/ranger assignments` posts eight persistent messages for Leadership, Quartermasters, Hold Wardens, Local Wardens, Ambassadors, Agents, Instructors, and Apprenticeships. The Hold Wardens message shows the single primary **Ranger of [Hold]** for each Hold. Local Wardens are grouped beneath their parent Hold and shown as **Warden of [Range]**. The board includes every Ranger+ duty; Craftsman and Courier assignments are intentionally omitted. The Apprenticeship message shows active pairings and members looking for a mentor or Apprentice. Wayfinder remembers and replaces the set together after relevant roster, duty, or apprenticeship changes.

## Deployment

Local development is fine initially. For production, run the bot on an always-running host such as Railway, Render paid, Fly.io, a VPS, or a similar service. Serverless request/response hosting is not appropriate for a persistent Discord gateway bot.

## Known Limitations

- Career roles are preserved but not stored in a separate table yet.
- Nickname enforcement is intentionally left as a TODO.
- Promotion eligibility warns through displayed reasons, but `/promotion open` still allows Marshal judgment for edge cases.
- Trailmark intel captures new messages while the bot is online. Use `/intel backfill` for historical Trailmark posts.
