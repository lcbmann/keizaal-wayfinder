# Application Configuration

Captain and First Captain can manage applications in Discord. Future form edits do not need a bot deployment.

## Consolidate Guide

Run:

```text
/application configure position:Guide role:@Guide replaces:Warden,Instructor
```

Click **Edit questions**, enter the position description and questions, and submit. Use one question per line, up to five questions, with at most 45 characters per question.

Saving this configuration opens Guide applications, closes Hold Warden, Local Warden and Instructor applications, and consolidates their active appointments. The existing Guide role is reused. Original appointment rows remain as ended history with their old ranges and dates. One current Guide appointment is retained per person, carrying forward their areas of knowledge. Old primary Hold appointments and their decorative Hold roles are removed. Instructor roles are replaced with Guide for current holders. If a Discord role change fails, repeat the same command to retry.

Existing pending applications are retained and routed to Guide. If someone already has another pending application for the same resulting duty, the redundant pending application is marked withdrawn rather than deleted. Previously approved or denied applications are not rewritten.

## Future Changes

Edit Guide again:

```text
/application configure position:Guide
```

Create another duty application by supplying its name and an existing Discord role. `minimum_rank` is optional and defaults to Ranger. `replaces` is optional and should only be used when intentionally consolidating duties, not when temporarily closing applications.

Close or reopen a form:

```text
/application disable position:Guide
/application enable position:Guide
```

Enable/disable only changes applications. It does not remove appointments, roles or history. A duty that was consolidated must be configured again with a role before it can be reopened. The specialized Warden forms cannot be reopened against the converted general Guide duty.

Guide and other configured duties are available in `/duty assign`, `/duty remove`, `/duty list`, the roster and `/ranger info`. New duty applications use Strongbox review, and approval grants their configured role.

Marshal and Captain forms may be edited or closed, but their minimum ranks, private review channels and subsequent promotion-vote workflow remain fixed. Rank roles, managed roles and Discord moderation roles cannot be assigned through a custom duty application. Role safety is checked both when configuring and when approving an application.

Open applicant forms are revision-checked. Applicants must reopen a form if its questions changed or applications closed while it was open. Configuration editors expire after 15 minutes and can only be used by the Captain who opened them. Saving rechecks the editor's current permissions, and stale edits cannot overwrite someone else's changes.

## Deployment

Apply `054_configurable_applications.sql` and `055_preserve_replaced_warden_ranges.sql`, then build and deploy the bot and redeploy slash commands. The configuration tables, drafts and configuration RPC are accessible only to the bot service role. Existing application forms keep their defaults until configured or disabled.
