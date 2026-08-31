# Ranger Runecloak Systems Design

Status: review draft. This branch contains design only. No database migration, command registration, Discord configuration, or runtime behavior has been changed.

## 1. Objective

Wayfinder should support the Ranger Runecloaks from initial admissions through confirmed spell completion while preserving the rules in the formation plan:

- Ranger Runecloak is a specialist qualification, not a rank, command position, duty, or medal.
- Only active full Rangers or higher may become learners.
- Every applicant must complete an independent Atlas research-site survey and short report before admission.
- An official spell cycle has a locked roster. Learners cannot be added or removed while it is active.
- Each stage has an EU session and an NA session.
- The paired sessions need unique attendance from at least 51% of the locked roster.
- One learner may contribute at most one roll per stage, even if they attend both sessions.
- Only verified, valid stages add points to the shared total.
- Each learner must attend a majority of the cycle to receive the spell.
- Moonshadow remains the authority that registers the group and confirms spell grants.
- Wayfinder provides an auditable internal record. It does not replace recordings or Moonshadow tickets.

The system should remain understandable to ordinary members. Most members should need only four actions: apply, submit their survey, check the shared status, and check their own record.

## 2. Recommended Product Decisions

### 2.1 Model Runecloak as a qualification

Create a small, generic qualification model rather than representing Ranger Runecloak with an existing duty or medal table.

The permanent `Ranger Runecloak` qualification will:

- have a Discord role and approved Runecloak emblem;
- appear in a separate **Qualifications** field in `/ranger info`;
- appear in dedicated qualification columns in the roster export;
- appear as a Runecloak badge in the Ranger Atlas profile;
- never change command authority, cumulative rank roles, nickname prefixes, or Corps standing;
- be awarded only after Moonshadow confirms the learner's first completed spell cycle.

It may also receive a non-pinging entry in the existing Corps Honors Record, clearly labeled as a qualification rather than a medal or promotion.

This keeps the meaning accurate and leaves room for future specialist qualifications without forcing them into medals or duties.

### 2.2 Use one official cycle at a time

Wayfinder should permit any number of draft or completed cycles but only one official active cycle across the Runecloaks at a time. This matches the proposal's singular current spell and shared progression target, and avoids overlapping cooldown, attendance, and Moonshadow records.

Each cycle represents one locked roster pursuing one spell. A later Oakflesh group is a new cycle. Lesser Ward is also a new cycle, even when most of its roster came from the first Oakflesh group.

This makes a separate cohort entity unnecessary. The cycle itself carries a cohort label such as `First Oakflesh Company` or `Oakflesh Cohort 2`.

### 2.3 Use two-stage admission

The normal Corps application table is not suitable for this workflow. Runecloak admission has its own state machine and a required follow-up survey.

1. A full Ranger submits a short Runecloak application.
2. Leadership either denies it or requests the admission survey.
3. The applicant scouts a site, records it in the Atlas, files a short report, and submits both references to Wayfinder.
4. Leadership approves the site and application, requests a revision, or denies the application.
5. Approved applicants enter the waiting pool. Approval does not guarantee selection for the next cycle.
6. Leadership selects an eligible roster and locks it only when the minimum size is met.

This fits Discord's five-field modal limit and makes the pre-benefit contribution a real, separately reviewable record.

### 2.4 Keep the Discord footprint small

Do not create a large new category. Use two member-facing channels and existing private leadership review infrastructure:

- `#runecloak-desk`: a bot-maintained, read-only text channel for the program summary, application controls, current cycle, and progress.
- `#runecloak-expeditions`: a Forum channel containing research-site records and official stage posts.
- Existing Strongbox review area: private application and survey review threads. No new public review channel.

The expedition Forum may remain hidden until Moonshadow registration is confirmed. It should be visible to Apprentices after activation if observers are meant to accompany suitable expeditions. Its posting permissions remain controlled by Wayfinder.

Recommended Forum tags:

- `Research Site`
- `Study Stage`
- `Proposed`
- `Approved`
- `Retired`
- `Open`
- `Complete`
- `Oakflesh`
- `Lesser Ward`

Holds should be embed fields, not Forum tags, so the Forum stays below Discord's 20-tag limit.

### 2.5 Treat all external decisions as explicit gates

Wayfinder should not infer Moonshadow approval. An authorized staff member must record:

- the Coven registration ticket or reference;
- Moonshadow's registration confirmation;
- the start approval for each official spell cycle, if required;
- the final spell-grant confirmation.

The dashboard should clearly distinguish `Ready internally`, `Awaiting Moonshadow`, and `Confirmed by Moonshadow`.

## 3. Roles and Permissions

### Discord roles

| Role | Lifetime | Purpose | Displayed as a qualification |
| --- | --- | --- | --- |
| `Runecloak Organizer` | Temporary | Identifies the initial planning group and allows organizer controls | No |
| `Runecloak Learner` | One active cycle | Pings and identifies the locked active roster | No |
| `Ranger Runecloak` | Permanent | Records completion of the first confirmed spell cycle | Yes |

All three roles should be non-hoisted. None should grant Ranger rank permissions. `Ranger Runecloak` receives the approved emblem and the `:runecloak:` emoji.

### Authorization matrix

| Action | Full Ranger | Organizer | Authorized Marshal | Captain+ | Commander |
| --- | ---: | ---: | ---: | ---: | ---: |
| Apply and submit own survey | Yes | Yes | Yes | Yes | Yes |
| View desk, sites, and aggregate progress | Yes | Yes | Yes | Yes | Yes |
| Submit own provisional attendance and roll | Active learners only | If active learner | If active learner | If active learner | If active learner |
| Recommend site or application outcome | No | Yes | Yes | Yes | Yes |
| Request a survey or revision | No | No | Yes | Yes | Yes |
| Approve or deny admission | No | No | No | Yes | Yes |
| Draft a stage or lesson record | No | Yes | Yes | Yes | Yes |
| Verify a lesson after attending or reviewing video | No | No | Yes | Yes | Yes |
| Select a draft roster | No | No | Yes | Yes | Yes |
| Lock a roster or change cycle state | No | No | No | Yes | Yes |
| Authorize Runecloak Marshals | No | No | No | Yes | Yes |
| Record Moonshadow confirmation | No | No | No | Yes | Yes |
| Reopen a finalized record | No | No | No | No | Yes |
| Export the complete audit | No | No | Yes | Yes | Yes |
| Configure the system | No | No | No | No | Yes |

An `Authorized Marshal` is an active Ranger Marshal specifically appointed in the Runecloak system. Rank alone does not silently add them to this subset. Captains and the Commander retain oversight without needing a separate authorization row.

Organizer appointments are also stored and audited rather than inferred only from a Discord role. Wayfinder should warn when the active organizing group is outside the proposed range of five to ten members, but not hard-block it because the plan describes that size as approximate.

## 4. Member Workflows

### 4.1 Apply

`/runecloak apply` checks that the member:

- has an active roster entry;
- currently holds Ranger rank or higher;
- does not already hold the Runecloak qualification;
- does not have another open Runecloak application.

Current Ranger rank is the enforceable proof that the normal Apprentice, Field Trial, final report, and Ranger vote path was completed. Wayfinder should not require complete historical records for older Rangers, because those records are not guaranteed to exist for every founding member.

The application modal should ask:

1. Why do you seek the Runecloak qualification?
2. What relevant field or magical experience do you have?
3. What can you contribute to study expeditions?
4. What is your availability and preferred EU or NA session?
5. What other loyalties, responsibilities, or conflicts should leadership know about?

Submission creates a private Strongbox review post and thread. The applicant receives a private confirmation but is not given access to the review thread.

### 4.2 Complete the admission survey

When leadership selects **Request Survey**, Wayfinder adds an individual dispatch to the applicant's next Ranger briefing.

`/runecloak survey` then opens a form that requires:

- site name;
- Hold or region;
- Atlas entry reference, feature ID, or share code;
- Discord link to the short Ranger report;
- concise description of the site's unusual natural, spiritual, or magical relevance.

Wayfinder stores the Atlas reference but does not create or edit Atlas locations. It may validate the format and warn about a duplicate reference. Leadership still reviews the actual Atlas entry and report.

If the report link belongs to an existing standardized Trailmark report, Wayfinder should also store that report ID. Its linked contacts and normal Intel delivery continue to work through the existing report system. A valid ordinary report link remains acceptable because standardized reports are encouraged, not mandatory.

The survey becomes a proposed research-site Forum post. Leadership may approve it, request revision, reject it, or later retire it. Approved sites remain in the catalogue even if the applicant waits for a later cycle.

Admission surveys never add spell progress.

### 4.3 Join a locked cycle

Approved applicants remain in a waiting pool. Authorized staff build a draft cycle roster from that pool.

Before lock, Wayfinder rechecks every selected member:

- active Ranger rank or higher;
- approved Runecloak application;
- approved research site;
- no prior completion of the selected spell;
- required prerequisite spell completion, for example Oakflesh before Lesser Ward.

The roster cannot lock below the configured minimum, initially 20. On lock:

- membership rows become immutable;
- rank and status snapshots are stored;
- the required 51% stage attendance count is stored as a number;
- the `Runecloak Learner` role is synchronized;
- selected learners receive an individual briefing dispatch;
- approved applicants who were not selected remain waiting for a later cycle.

No points may be recorded until both the roster is locked and the required Moonshadow start confirmation is recorded.

### 4.4 Attend a paired stage

Staff creates one stage with an EU session and an NA session. The stage Forum post shows both schedules, site links, current unique attendance, and verification status.

An active learner may:

- mark provisional attendance for either session;
- record the result of their official `/roll 100` for one session;
- attend the other session as well without entering a second roll;
- update a provisional record until staff begins verification.

The stage post's **Record Roll** button opens a small modal for the official result and an optional Discord message link. Wayfinder records the result but does not generate the roll unless Moonshadow later approves that method.

Observers and support participants may be listed, but their attendance and rolls never count toward Runecloak progression.

An authorized Marshal verifies a session only after being present or reviewing its recording. Verification requires:

- actual session date and time;
- approved research site;
- a concise lesson summary and study method showing that it was a field expedition rather than a roll-only ceremony;
- recording URL with visible participant names;
- session leader or teacher;
- verified learner attendance;
- each accepted roll between 1 and 100;
- optional Moonshadow submission reference and notes.

After both sessions are verified, Wayfinder evaluates the stage. The stage becomes valid only if unique learner attendance across both sessions meets the stored 51% requirement. Invalid stages retain their full record but contribute zero points.

### 4.5 Complete a cycle

When verified valid stages pass the shared point threshold, staff moves the cycle to `Awaiting Moonshadow Grant`. Wayfinder freezes ordinary edits and creates the staff audit export.

After Moonshadow confirms the result, Wayfinder calculates each learner's final eligibility. An eligible learner must:

- still exist in the locked roster;
- have verified learner attendance in a majority of valid paired stages;
- not have been marked withdrawn or ineligible;
- be included in Moonshadow's confirmed grant.

The confirmation control previews Wayfinder's eligible list and requires staff to record which learners Moonshadow actually approved. It must not silently assume that every mathematically eligible learner received the external grant.

Eligible learners receive a confirmed spell result. Learners who fall short are marked `Repeat Required`; their history remains intact and they may enter a later cycle.

Completion of a learner's first confirmed spell, initially Oakflesh, awards the permanent `Ranger Runecloak` qualification and role. Lesser Ward completion adds a spell result but does not award a second Runecloak role.

## 5. Progression Rules

### Stage attendance

For a locked roster of `N` learners:

```text
required unique attendance = ceil(N * 0.51)
```

Examples:

- 20 learners require 11 unique attendees.
- 21 learners require 11 unique attendees.
- 22 learners require 12 unique attendees.

A learner present in both regional sessions counts once toward stage quorum.

### Rolls and points

- A learner may have one accepted roll per stage.
- The accepted roll must be an integer from 1 through 100.
- A second-session attendance record may exist without a roll.
- Provisional rolls do not affect the public total.
- Verified rolls from a stage do not affect the total until the entire paired stage is valid.
- A valid stage's points are the sum of its unique accepted rolls.
- The cycle total is the sum of all valid stage points.

The dashboard should show verified and pending points separately so an unreviewed lesson cannot appear official.

### Individual attendance

The time-zone accommodation only works if the EU and NA sessions are treated as one paired stage for personal attendance. The recommended interpretation is:

```text
required stages attended = floor(total valid stages / 2) + 1
```

Attending either regional session counts as attendance for that stage. Attending both still counts as one stage.

### Locked roster behavior

After lock, a learner row is never deleted or replaced. A learner who withdraws, retires, becomes inactive, or otherwise becomes ineligible is marked accordingly, loses the temporary learner role, and cannot submit further rolls. The original locked roster count and stage quorum denominator remain unchanged.

This is the strictest reading of the plan's rule that learners are not added or removed during an active cycle.

## 6. State Machines

### Program

```text
Organizing -> Admissions Open -> Registration Pending -> Registered
                                      |                    |
                                      +------ Paused <-----+
```

Only `Registered` permits an official active cycle. Registration has an external reference, confirming actor, and confirmation time.

### Application

```text
Submitted -> Survey Requested -> Survey Submitted -> Approved
    |               |                  |
    +------------> Denied <------------+
    +------------> Withdrawn <---------+

Survey Submitted -> Revision Requested -> Survey Submitted
```

`Approved` means eligible for selection, not guaranteed a place.

### Research site

```text
Proposed -> Revision Requested -> Proposed
    |              |
    +-> Approved --+-> Retired
    +-> Rejected
```

### Cycle

```text
Draft -> Locked -> Awaiting Moonshadow Start -> Active
  |                                         |
  +-> Cancelled                             +-> Awaiting Moonshadow Grant
                                                      |
                                                      +-> Completed
                                                      +-> Returned to Active
```

Only one cycle may be beyond Draft and not yet completed or cancelled. Leadership may prepare other Draft cycles, but there can be only one locked, externally pending, active, or externally reviewing cycle.

### Stage and session

```text
Stage: Draft -> Open -> Ready for Review -> Valid / Invalid -> Corrected and Revalidated
Session: Planned -> Submitted -> Verified
                    |              |
                    +-> Cancelled  +-> Voided by correction
```

Both EU and NA sessions must be verified before the paired stage can become valid.

## 7. Discord Experience

### Runecloak desk

The desk contains one pinned, automatically refreshed message. Example during a cycle:

```text
Ranger Runecloak Desk

Program: Registered with Moonshadow
Current study: Oakflesh
Company: First Oakflesh Company
Locked roster: 22 learners

Verified progress
[#####-----] 4,312 / 8,000
Pending review: 486 points

Current stage: Stage 5, Living Stone
Stage quorum: 8 / 12 unique learners
EU session: scheduled
NA session: scheduled
```

Buttons:

- **Apply** or **Continue Survey**, based on the member's state
- **My Record**
- **View Research Sites**
- **View Current Stage**

The same message changes during organizing and registration to show approved applicants, the minimum needed, and external confirmation state. It should not display private application answers or staff notes.

### Personal record

`/runecloak record` and **My Record** return an ephemeral response showing:

- application and survey state;
- waiting-pool or active-cycle state;
- current spell;
- stages attended and current majority requirement;
- accepted roll per stage and contributed points;
- qualification and confirmed spells;
- any revision, withdrawal, or repeat-required status.

### Stage Forum post

Each stage is one Forum post, not one channel per lesson. The starter embed contains:

- spell and stage number;
- study theme and approved site;
- EU and NA schedules;
- session leaders;
- unique attendance progress;
- verified and pending points;
- recording and Moonshadow reference status;
- controls appropriate to the viewer.

Discussion and ordinary roleplay planning happen inside the post's thread. Wayfinder edits the starter message rather than adding a new summary message after every action.

### Briefing integration

Use the existing Ranger Dispatch Desk for status changes that matter in character:

- survey requested or revision requested;
- admission approved;
- selection for a locked cycle;
- new stage schedules;
- a cycle entering external review;
- confirmed spell completion and Runecloak qualification.

These are individual dispatches for applicants and learners. Admissions opening may be a Ranger-wide dispatch. Routine roll updates should not create briefing entries.

## 8. Command Surface

Keep the member-facing slash command small:

| Command | Result |
| --- | --- |
| `/runecloak apply` | Opens the application modal |
| `/runecloak survey` | Opens the requested survey form |
| `/runecloak status` | Shows shared program and cycle status |
| `/runecloak record` | Shows the caller's private record |
| `/runecloak manage` | Opens an ephemeral, paginated staff control panel |
| `/runecloak audit` | Authorized staff read-only log and export |
| `/runecloak setup` | Commander-only channel and role configuration |

`/runecloak manage` should use select menus and buttons rather than exposing a long list of administrative subcommands. Its pages are:

1. Admissions
2. Research Sites
3. Roster and Cycle
4. Stages and Sessions
5. Moonshadow Confirmations
6. Corrections and Recovery

All actions recheck permissions and current database state. Custom component IDs are routing hints, not authorization.

Discord select menus are limited to 25 options. Applicant, learner, site, and cycle selectors must paginate rather than silently omitting records.

`/runecloak setup` should connect existing channels and roles, create the required Forum tags, validate the `:runecloak:` emoji, and store IDs in Supabase. It should not require new environment variables. Re-running setup updates the same desk record instead of posting a duplicate.

## 9. Data Model

All new tables use UUID primary keys unless noted, enable RLS, and remain service-role only like the current Wayfinder tables. Critical transitions should use transactional Supabase RPC functions.

### `runecloak_settings`

One row per guild:

- desk channel and dashboard message IDs;
- expedition Forum ID;
- organizer, learner, and qualified role IDs;
- program state;
- registration ticket/reference and confirmation audit fields;
- minimum roster size, default 20;
- stage quorum percentage, default 51;
- point threshold, default 8,000;
- threshold comparison mode;
- created and updated audit fields.

### `runecloak_team_assignments`

- Ranger ID;
- assignment kind: `organizer` or `authorized_marshal`;
- active flag;
- authorized by and authorized at;
- ended by, time, and reason.

The service requires full Ranger rank for organizers and Marshal rank or higher for authorized Marshals. This table drives the temporary organizer role and staff permissions.

### `runecloak_applications`

- applicant Ranger ID;
- rank snapshot at submission;
- application state;
- structured form responses as JSON;
- Strongbox channel, message, and thread IDs;
- review actor, time, outcome note, and revision request;
- created and updated timestamps.

A partial unique index permits only one open application per Ranger.

### `runecloak_research_sites`

- source application and proposing Ranger IDs;
- name and Hold/region;
- Atlas entry reference, feature ID, URL, or share code;
- report message URL;
- optional structured Trailmark report ID when the link resolves to one;
- description and research relevance;
- review state and review audit fields;
- retirement audit fields;
- expedition Forum post IDs.

Duplicate Atlas references should produce a warning, not an automatic rejection. Leadership decides whether two independent surveys overlap too closely.

Each application has one current admission site. A revision updates that proposed record and its audit history rather than creating several attempts that appear to be separate contributions.

### `runecloak_spells`

- stable slug and display name;
- sequence and prerequisite spell ID;
- study summary;
- default target points;
- active flag;
- external approval note.

Seed only `Oakflesh` and `Lesser Ward`. Adding or activating another spell remains a Commander action after the required internal and Moonshadow decisions.

The Oakflesh seed should include the approved themes from the plan: natural resilience, bark/root/stone/living structure, temporary protection, maintaining it during Ranger movement, and temporary runic focuses that are not permanent enchantments. Lesser Ward should be described as limited field defense against hostile magic.

### `runecloak_cycles`

- cohort label and sequence;
- spell ID;
- state;
- roster minimum and point-rule snapshots;
- locked roster count and calculated quorum count;
- roster lock actor and time;
- external start and grant references, actors, and times;
- a deterministic roster hash created from the sorted locked Ranger IDs;
- dashboard/Forum references;
- final verified points;
- created, updated, and completed timestamps.

A partial unique index enforces one non-Draft, nonterminal cycle at a time.

### `runecloak_cycle_members`

- cycle and Ranger IDs;
- source application ID;
- rank and status snapshots at lock;
- current participation state;
- selected by and selected at;
- withdrawal or ineligibility audit fields;
- final valid stages attended and required;
- final contributed points;
- final result and confirmed spell time.

The cycle and Ranger pair is unique. A database trigger prevents inserts, deletes, or identity changes after roster lock. Status changes preserve the row.

### `runecloak_stages`

- cycle ID and sequence;
- Moonshadow cooldown label, start time, and end time;
- title, theme, and notes;
- stage state;
- required unique attendance snapshot;
- actual unique attendance;
- verified stage points;
- validator, validation time, and outcome reason;
- Forum post references.

Cycle and sequence are unique. Cycle and cooldown label are also unique so Wayfinder cannot create two paired stages in one cooldown period.

### `runecloak_sessions`

- stage ID;
- regional slot, `EU` or `NA`;
- planned and actual times;
- research-site ID;
- leader/teacher Discord ID;
- lesson summary and study method;
- recording URL;
- Moonshadow submission reference;
- state;
- logged by, verified by, verification basis, and timestamps.

Stage and regional slot are unique. Verification basis is `present` or `recording_review`.

### `runecloak_session_participation`

- stage, session, and Ranger IDs;
- participation kind: `learner`, `support`, or `observer`;
- record state: `provisional`, `verified`, or `rejected`;
- roll value and evidence URL, if applicable;
- self-submission and staff-verification audit fields;
- correction note.

Session and Ranger are unique. A partial unique index permits only one non-rejected roll per stage and Ranger. A composite foreign key guarantees that the stored stage matches the session's stage.

### `corps_qualifications`

- stable slug, name, description, emoji, Discord role ID, active flag;
- created and updated audit fields.

Seed `ranger-runecloak`.

### `ranger_qualifications`

- qualification and Ranger IDs;
- source cycle ID;
- awarded by and awarded at;
- optional revocation actor, time, and reason.

Only one active copy of a qualification may exist per Ranger.

### `runecloak_audit_events`

Append-only ledger containing:

- entity type and ID;
- action;
- actor Discord ID;
- reason;
- structured before and after snapshots where applicable;
- source channel/message URL;
- timestamp.

No application code should update or delete audit events.

## 10. Transactional Operations

The following operations should be database RPCs so a restart or double click cannot leave partial state:

### Lock cycle roster

- confirms the cycle is Draft;
- rechecks every member and prerequisite;
- enforces the minimum roster size;
- calculates and stores quorum;
- changes the cycle to Locked;
- freezes membership;
- appends one audit event.

Discord role sync and messages happen after commit. A startup repair pass reconciles them if Discord fails.

### Verify paired stage

- confirms both regional sessions are verified;
- validates unique learner attendance and rolls;
- calculates quorum and points;
- marks the stage Valid or Invalid;
- recomputes the cycle's verified total;
- appends the audit event.

### Confirm cycle result

- requires the external grant reference;
- freezes the final valid-stage count;
- calculates each member's majority requirement and result;
- records the externally confirmed recipient list;
- creates confirmed spell results;
- awards first-time Runecloak qualifications exactly once;
- completes the cycle;
- appends audit events.

Discord roles, Atlas profile sync, dashboard refresh, and briefing dispatches happen after the transaction and are repairable.

## 11. Corrections and Recovery

Before a stage is validated, authorized staff may correct draft attendance and rolls.

After validation:

- only Captain+ may correct a lesson record;
- a reason is required;
- the old and new values are written to the append-only audit ledger;
- the stage and cycle totals are recomputed transactionally;
- the stage post and dashboard are refreshed.

After Moonshadow grant confirmation, records are read-only. Only the Commander may reopen a finalized cycle, with a reason and a new audit event. Wayfinder should never silently rewrite a qualification history.

On bot startup, a Runecloak repair pass should:

- restore or refresh the desk message;
- refresh open stage starter posts;
- reconcile temporary learner and permanent qualification roles;
- repair missing briefing dispatches using idempotent source keys;
- report missing channels, roles, recordings, or Discord messages without changing official progression.

## 12. Audit and Export

`/runecloak audit` is ephemeral and available to authorized staff. It should provide:

- cycle state, external references, and locked roster hash;
- every stage and both sessions;
- required and actual unique attendance;
- every learner's verified attendance and accepted roll;
- the verifier and verification basis;
- recording and source links;
- stage validity and points;
- final personal majority calculation and result;
- every later correction.

Attachments:

- `runecloak-<cycle>-summary.tsv`, one row per learner with final eligibility;
- `runecloak-<cycle>-lessons.tsv`, one row per learner/session record;
- `runecloak-<cycle>-events.tsv`, the append-only audit ledger.

Names are included for readability, but Ranger UUID and Discord user ID remain the stable identity fields.

## 13. Existing Wayfinder Integrations

### Reuse

- `postStrongboxThread` pattern for private application review.
- `bot_message_state` pattern for the persistent desk message, with dedicated settings as the authoritative configuration.
- `queueBriefingDispatch` for application and cycle notices.
- managed-assignment Forum setup and starter-message refresh patterns.
- supply assignment and multiple-choice vote progress-bar formatting.
- existing role sync and Atlas Discord profile synchronization.
- existing CSV/TSV attachment patterns for audits.

### Extend

- `/ranger info`: add **Qualifications** separately from ranks, roles, duties, and medals.
- roster export: add `Qualifications`, `Runecloak Spells`, `Active Runecloak Cycle`, `Cycle Attendance`, and `Cycle Points` columns.
- Ranger Atlas profile: move the profile contract to version 2 with a separate `qualifications` array, add the `runecloak` badge asset, and preserve version-1 `medals` compatibility.
- Corps Honors Record: allow a `qualification` ledger source and post confirmed Runecloak qualifications without pinging the recipient.
- member update handling: remove temporary learner access when a member ceases to be an active Ranger, while preserving the locked record.
- startup recovery: refresh the Runecloak desk and reconcile roles.

The main Ranger roster board should not gain another duty block. The Runecloak desk is the detailed roster for this specialist program; the normal roster, `/ranger info`, CSV export, and Atlas badge provide the cross-Corps references.

### Do not reuse

- `duty_applications`, because its Pending/Approved/Denied flow cannot represent a required survey and waiting pool.
- `corps_medals`, because Runecloak is explicitly not an award medal.
- `managed_assignments`, because official stages require paired sessions, external evidence, and immutable progression records.
- general votes, because the formation plan describes staff-reviewed eligibility rather than a Corps-wide election.

## 14. Atlas Boundary

Wayfinder and the Atlas share identity and profile data, but Wayfinder should not become an Atlas editor.

Phase one integration should:

- store the applicant's Atlas reference and report URL;
- link approved site records from Discord;
- optionally verify a recognized feature ID or share-code format;
- add the permanent Runecloak badge to synchronized Ranger profiles.

It should not:

- publish, move, or delete Atlas features;
- reintroduce the removed Wayfinder Field Atlas Share command;
- assume an Atlas entry is approved solely because its identifier exists.

The current Atlas profile JSON calls every secondary badge a `medal`. Runecloak should not be appended to that array. The Atlas update should accept a version-2 profile with `primary_badge`, `qualifications`, and `medals`, render all three groups, and continue reading version-1 profiles during deployment.

A later Atlas enhancement may add a read-only Runecloak research-site layer backed by approved Wayfinder records. That should be a separate change in the Atlas repository after its current local work is isolated.

## 15. Failure and Abuse Controls

- Every interaction lasting beyond a simple read defers its Discord reply before database or network work.
- All state-changing buttons are idempotent and recheck current state.
- Critical transitions use database transactions/RPCs.
- Discord message or role failures never roll back an already valid official record. They enter a repair queue or startup reconciliation.
- A user cannot submit a roll for another learner.
- A learner cannot submit a roll before the cycle and stage are open.
- A second roll in the same stage is rejected at both service and database levels.
- Staff cannot verify a session without a recording and verification basis.
- Site, application, and cycle actions always record actor and time.
- Finalized cycle records cannot be edited through ordinary controls.
- Public embeds never expose private application answers, staff notes, or audit-only identifiers.
- External URLs are validated as Discord or HTTPS links and escaped before display.

## 16. Implementation Layout

Recommended Wayfinder files:

```text
src/commands/runecloak.ts
src/components/runecloakButtons.ts
src/components/runecloakSelects.ts
src/services/runecloakApplicationService.ts
src/services/runecloakCycleService.ts
src/services/runecloakDiscordService.ts
src/services/runecloakAuditService.ts
src/services/runecloakQualificationService.ts
src/services/runecloakService.test.ts
src/db/migrations/046_create_runecloak_system.sql
assets/discord-role-icons/runecloak.png
```

Existing files to extend:

```text
src/db/supabase.ts
src/index.ts
src/commands/ranger.ts
src/services/rosterExportService.ts
src/services/atlasDiscordProfileService.ts
src/services/briefingService.ts
src/jobs/syncMemberRoster.ts
src/utils/guildEmojis.ts
README.md
```

The Atlas badge asset and mapping belong in a separate Atlas branch and commit.

## 17. Implementation Phases

### Phase 1: Foundation and admissions

- schema, settings, qualification, roles, and setup;
- desk message;
- applications, Strongbox review, surveys, and research-site catalogue;
- waiting pool and personal record;
- no official study controls yet.

This phase can safely open pre-registration admission work.

### Phase 2: Locked cycle and registration

- spell seed data;
- draft roster selection and lock transaction;
- learner role sync;
- registration reference and confirmation gates;
- cycle dashboard.

### Phase 3: Lessons and progression

- stages and paired sessions;
- provisional attendance and roll entry;
- Marshal verification;
- quorum, progress, majority, and completion transactions;
- corrections, audit, and exports.

### Phase 4: Profiles and hardening

- Ranger info, roster export, and Atlas qualification display;
- startup repair and role reconciliation;
- full tests and staging-guild exercise;
- operational documentation and Discord changelog.

Each phase should be deployable without allowing the next phase's incomplete actions. Feature state, not merely channel permissions, gates official progression.

## 18. Test Plan

### Unit tests

- rank and active-status eligibility;
- application state transitions;
- quorum rounding for several roster sizes;
- union attendance across EU and NA sessions;
- one roll per learner per stage;
- no observer/support progression;
- valid and invalid stage points;
- majority attendance for odd and even stage counts;
- spell prerequisites;
- threshold comparison;
- final qualification idempotency;
- permission matrix and pagination.

### Database tests

- one open application per Ranger;
- one regional session per stage;
- one accepted roll per learner per stage;
- immutable locked roster;
- one official active cycle;
- transaction rollback on invalid lock, verification, or completion;
- one active qualification per Ranger;
- append-only audit events.

### Discord staging checklist

- setup against existing channels and roles;
- application and survey modals;
- inaccessible private review links are not shown to applicants;
- 25-plus applicant/site selectors paginate;
- desk and stage messages update rather than duplicate;
- role and briefing repair after a simulated Discord failure;
- all long operations defer before Discord's interaction timeout;
- audit attachments open cleanly in a spreadsheet.

## 19. Deployment Sequence After Approval

1. Implement and test the Wayfinder schema and admissions flow on this branch.
2. Apply migration 046 in Supabase.
3. Deploy the updated slash commands.
4. Deploy Wayfinder and run `/runecloak setup` with the chosen channels and roles.
5. Open admissions and collect surveys while the program remains `Organizing` or `Admissions Open`.
6. Select and lock at least 20 approved learners.
7. Submit the locked roster, channels, schedule, and tracking plan to Moonshadow.
8. Record Moonshadow registration confirmation.
9. Open the first Oakflesh cycle. No points can count before this step.
10. Add and deploy the Atlas qualification badge in its own repository change.

## 20. Decisions Needed Before Implementation

The rest of the design can be implemented without policy invention once these are confirmed:

1. **Attendance unit:** Count a learner's attendance by paired stage, with either EU or NA satisfying that stage. Recommended: yes.
2. **Point threshold:** The plan says both a target of 8,000 and that the total must exceed 8,000. Recommended: require 8,001 or more, while displaying the goal as `over 8,000`.
3. **External rolls:** Should learners enter results from Moonshadow's existing `/roll 100`, subject to Marshal video verification, or may Wayfinder generate the official roll? Recommended: record the external result until Moonshadow explicitly approves Wayfinder-generated rolls.
4. **Partial cohort success:** May the cycle complete for learners who meet attendance while others receive `Repeat Required`? Recommended: yes.
5. **Locked denominator:** Does a post-lock withdrawal remain in the 51% denominator? Recommended: yes, because the official roster remains locked.
6. **Admission authority:** May an authorized Marshal approve final admission, or should final approval remain Captain+? Recommended: Captain+ approves admission; authorized Marshals handle survey/revision and lesson verification.
7. **Observer visibility:** Should Apprentices be able to view and join suitable expedition threads as non-counting observers? Recommended: yes after registration, while the desk and applications remain Ranger+.
8. **Organizer role:** Should the temporary organizing group receive a non-hoisted `Runecloak Organizer` role with drafting and recommendation controls? Recommended: yes, with no final approval or lesson-verification power.
