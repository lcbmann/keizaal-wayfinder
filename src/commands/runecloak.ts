import {
  ChannelType,
  SlashCommandBuilder,
  type CategoryChannel,
  type ForumChannel,
  type Role,
  type TextChannel
} from "discord.js";
import { assertNoDbError, supabase, type RunecloakProgramState } from "../db/supabase.js";
import { UserFacingError } from "../utils/errors.js";
import { memberRankAtLeast } from "../utils/permissions.js";
import {
  addRunecloakSurveyScreenshot,
  postRunecloakStage,
  reconcileRunecloakRoles,
  refreshRunecloakDesk,
  refreshRunecloakStagePost,
  runecloakApplicationModal,
  runecloakAuditAttachment,
  runecloakCompletionPreviewPayload,
  runecloakPersonalRecordPayload,
  runecloakStatusPayload,
  runecloakSurveyModal,
  setupRunecloakDiscord,
  updateRunecloakObserverAccess
} from "../services/runecloakDiscordService.js";
import {
  DEFAULT_RUNECLOAK_ROLE_ID,
  addRunecloakCycleMember,
  assertRunecloakCaptain,
  assertRunecloakCommander,
  createRunecloakCycle,
  createRunecloakStage,
  getCurrentRunecloakCycle,
  getOpenRunecloakApplication,
  getRunecloakApplicationDetails,
  getRunecloakCycleDetails,
  getRunecloakStage,
  isAuthorizedRunecloakMarshal,
  isRunecloakOrganizer,
  listActiveRunecloakTeamAssignments,
  listRunecloakApplications,
  listRunecloakCycles,
  listRunecloakSpells,
  lockRunecloakCycle,
  removeRunecloakCycleMember,
  requireRunecloakSettings,
  setRunecloakCycleMemberStatus,
  setRunecloakProgramState,
  setRunecloakTeamAssignment,
  startRunecloakCycle,
  submitRunecloakSession,
  transitionRunecloakApplication,
  verifyRunecloakSession,
  verifyRunecloakStage
} from "../services/runecloakService.js";
import { queueBriefingDispatch } from "../services/briefingService.js";
import { requireRangerByDiscordId } from "../services/rangerService.js";
import type { BotCommand } from "./types.js";

const command = new SlashCommandBuilder()
  .setName("runecloak")
  .setDescription("Apply for Runecloak study and maintain its expedition records.")
  .addSubcommand((subcommand) => subcommand
    .setName("apply")
    .setDescription("Ranger+: apply to begin the Runecloak admission path."))
  .addSubcommand((subcommand) => subcommand
    .setName("withdraw")
    .setDescription("Withdraw your open Runecloak application."))
  .addSubcommand((subcommand) => subcommand
    .setName("survey")
    .setDescription("Submit the research-site survey requested by leadership."))
  .addSubcommand((subcommand) => subcommand
    .setName("survey-screenshot")
    .setDescription("Attach a screenshot to your submitted research-site survey.")
    .addAttachmentOption((option) => option
      .setName("image")
      .setDescription("A screenshot of the surveyed location.")
      .setRequired(true)))
  .addSubcommand((subcommand) => subcommand
    .setName("status")
    .setDescription("View the current Runecloak program and study cycle."))
  .addSubcommand((subcommand) => subcommand
    .setName("record")
    .setDescription("View your private Runecloak application and study record."))
  .addSubcommand((subcommand) => subcommand
    .setName("manage")
    .setDescription("Runecloak staff: view the current operating record."))
  .addSubcommand((subcommand) => subcommand
    .setName("audit")
    .setDescription("Authorized staff: export the Runecloak audit ledger.")
    .addStringOption((option) => option
      .setName("cycle")
      .setDescription("Limit the export to one study cycle.")
      .setAutocomplete(true)))
  .addSubcommand((subcommand) => subcommand
    .setName("setup")
    .setDescription("Commander: connect Wayfinder to the existing Runic Cloak category.")
    .addChannelOption((option) => option
      .setName("category")
      .setDescription("The existing THE RUNIC CLOAK category.")
      .addChannelTypes(ChannelType.GuildCategory)
      .setRequired(true))
    .addChannelOption((option) => option
      .setName("discussion")
      .setDescription("The existing Runecloak discussion channel.")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true))
    .addRoleOption((option) => option
      .setName("qualification_role")
      .setDescription("The permanent Ranger Runecloak role.")
      .setRequired(true))
    .addChannelOption((option) => option
      .setName("information")
      .setDescription("Optional existing information channel; Wayfinder creates one if omitted.")
      .addChannelTypes(ChannelType.GuildText))
    .addChannelOption((option) => option
      .setName("expeditions")
      .setDescription("Optional existing expedition Forum; Wayfinder creates one if omitted.")
      .addChannelTypes(ChannelType.GuildForum))
    .addRoleOption((option) => option
      .setName("organizer_role")
      .setDescription("Optional temporary organizer role, if you decide to use one."))
    .addRoleOption((option) => option
      .setName("learner_role")
      .setDescription("Optional existing learner role; Wayfinder creates one if omitted.")))
  .addSubcommandGroup((group) => group
    .setName("program")
    .setDescription("Manage Runecloak admissions and Moonshadow registration.")
    .addSubcommand((subcommand) => subcommand
      .setName("set")
      .setDescription("Captain+: set the Runecloak program state.")
      .addStringOption((option) => option
        .setName("state")
        .setDescription("The new program state.")
        .setRequired(true)
        .addChoices(
          { name: "Organizing", value: "Organizing" },
          { name: "Admissions Open", value: "Admissions Open" },
          { name: "Registration Pending", value: "Registration Pending" },
          { name: "Registered", value: "Registered" },
          { name: "Paused", value: "Paused" }
        ))
      .addStringOption((option) => option
        .setName("moonshadow_reference")
        .setDescription("Required when confirming registration."))))
  .addSubcommandGroup((group) => group
    .setName("team")
    .setDescription("Manage the Runecloak organizing and verification team.")
    .addSubcommand((subcommand) => subcommand
      .setName("add")
      .setDescription("Captain+: add an organizer or authorized Marshal.")
      .addUserOption((option) => option.setName("member").setDescription("Corps member.").setRequired(true))
      .addStringOption((option) => option
        .setName("kind")
        .setDescription("Operational assignment.")
        .setRequired(true)
        .addChoices(
          { name: "Organizer", value: "organizer" },
          { name: "Authorized Marshal", value: "authorized_marshal" }
        )))
    .addSubcommand((subcommand) => subcommand
      .setName("remove")
      .setDescription("Captain+: remove an operational Runecloak assignment.")
      .addUserOption((option) => option.setName("member").setDescription("Corps member.").setRequired(true))
      .addStringOption((option) => option
        .setName("kind")
        .setDescription("Operational assignment.")
        .setRequired(true)
        .addChoices(
          { name: "Organizer", value: "organizer" },
          { name: "Authorized Marshal", value: "authorized_marshal" }
        ))
      .addStringOption((option) => option.setName("reason").setDescription("Why the assignment ended.").setRequired(true))))
  .addSubcommandGroup((group) => group
    .setName("cycle")
    .setDescription("Build and operate an official spell-study cycle.")
    .addSubcommand((subcommand) => subcommand
      .setName("create")
      .setDescription("Authorized staff: create a draft study cycle.")
      .addStringOption((option) => option.setName("spell").setDescription("Approved spell.").setRequired(true).setAutocomplete(true))
      .addStringOption((option) => option.setName("label").setDescription("Company or cohort label.").setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("add")
      .setDescription("Authorized staff: add an approved applicant to a draft cycle.")
      .addStringOption((option) => option.setName("cycle").setDescription("Draft cycle.").setRequired(true).setAutocomplete(true))
      .addUserOption((option) => option.setName("applicant").setDescription("Approved applicant.").setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("remove")
      .setDescription("Authorized staff: remove a learner before roster lock.")
      .addStringOption((option) => option.setName("cycle").setDescription("Draft cycle.").setRequired(true).setAutocomplete(true))
      .addUserOption((option) => option.setName("learner").setDescription("Learner to remove.").setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("lock")
      .setDescription("Captain+: validate and permanently lock the study roster.")
      .addStringOption((option) => option.setName("cycle").setDescription("Draft cycle.").setRequired(true).setAutocomplete(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("start")
      .setDescription("Captain+: record Moonshadow start approval and open the cycle.")
      .addStringOption((option) => option.setName("cycle").setDescription("Locked cycle.").setRequired(true).setAutocomplete(true))
      .addStringOption((option) => option.setName("moonshadow_reference").setDescription("Approval or ticket reference.").setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("exclude")
      .setDescription("Captain+: mark a locked learner withdrawn or ineligible.")
      .addStringOption((option) => option.setName("cycle").setDescription("Official cycle.").setRequired(true).setAutocomplete(true))
      .addUserOption((option) => option.setName("learner").setDescription("Locked learner.").setRequired(true))
      .addStringOption((option) => option
        .setName("status")
        .setDescription("How to preserve the learner in the locked record.")
        .setRequired(true)
        .addChoices(
          { name: "Withdrawn", value: "Withdrawn" },
          { name: "Ineligible", value: "Ineligible" }
        ))
      .addStringOption((option) => option.setName("reason").setDescription("Required audit reason.").setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("complete")
      .setDescription("Captain+: record Moonshadow's final spell grant.")
      .addStringOption((option) => option.setName("cycle").setDescription("Cycle awaiting a grant.").setRequired(true).setAutocomplete(true))))
  .addSubcommandGroup((group) => group
    .setName("stage")
    .setDescription("Open and verify paired regional study expeditions.")
    .addSubcommand((subcommand) => subcommand
      .setName("create")
      .setDescription("Organizer or authorized staff: open a paired stage.")
      .addStringOption((option) => option.setName("cycle").setDescription("Active cycle.").setRequired(true).setAutocomplete(true))
      .addStringOption((option) => option.setName("title").setDescription("Short stage title.").setRequired(true))
      .addStringOption((option) => option.setName("theme").setDescription("What the expeditions will study.").setRequired(true))
      .addStringOption((option) => option.setName("study_window").setDescription("Moonshadow cooldown or study-window label.").setRequired(true))
      .addStringOption((option) => option.setName("eu_time").setDescription("Optional ISO date/time for the EU session."))
      .addStringOption((option) => option.setName("na_time").setDescription("Optional ISO date/time for the NA session."))
      .addStringOption((option) => option.setName("notes").setDescription("Optional planning notes.")))
    .addSubcommand((subcommand) => subcommand
      .setName("submit-session")
      .setDescription("Organizer or authorized staff: file a completed regional session.")
      .addStringOption((option) => option.setName("stage").setDescription("Open stage.").setRequired(true).setAutocomplete(true))
      .addStringOption((option) => option.setName("slot").setDescription("Regional session.").setRequired(true).addChoices(
        { name: "EU", value: "EU" }, { name: "NA", value: "NA" }
      ))
      .addStringOption((option) => option.setName("site").setDescription("Approved research site.").setRequired(true).setAutocomplete(true))
      .addUserOption((option) => option.setName("leader").setDescription("Session leader or teacher.").setRequired(true))
      .addStringOption((option) => option.setName("actual_time").setDescription("ISO date/time when the session occurred.").setRequired(true))
      .addStringOption((option) => option.setName("recording").setDescription("HTTPS recording link.").setRequired(true))
      .addStringOption((option) => option.setName("lesson_summary").setDescription("What was taught or observed.").setRequired(true))
      .addStringOption((option) => option.setName("study_method").setDescription("How field study was performed.").setRequired(true))
      .addStringOption((option) => option.setName("moonshadow_reference").setDescription("Optional submission reference.")))
    .addSubcommand((subcommand) => subcommand
      .setName("verify-session")
      .setDescription("Authorized Marshal+: verify attendance and evidence for one session.")
      .addStringOption((option) => option.setName("stage").setDescription("Open stage.").setRequired(true).setAutocomplete(true))
      .addStringOption((option) => option.setName("slot").setDescription("Regional session.").setRequired(true).addChoices(
        { name: "EU", value: "EU" }, { name: "NA", value: "NA" }
      ))
      .addStringOption((option) => option.setName("basis").setDescription("How you verified the record.").setRequired(true).addChoices(
        { name: "I was present", value: "present" },
        { name: "I reviewed the recording", value: "recording_review" }
      )))
    .addSubcommand((subcommand) => subcommand
      .setName("verify")
      .setDescription("Authorized Marshal+: evaluate the paired stage for quorum and points.")
      .addStringOption((option) => option.setName("stage").setDescription("Stage with two verified sessions.").setRequired(true).setAutocomplete(true))
      .addStringOption((option) => option.setName("note").setDescription("Optional validation note."))));

export const runecloakCommand: BotCommand = {
  data: command,

  async autocomplete(interaction) {
    if (!interaction.guildId) {
      await interaction.respond([]);
      return;
    }
    const focused = interaction.options.getFocused(true);
    const search = String(focused.value).toLocaleLowerCase();
    if (focused.name === "spell") {
      const spells = await listRunecloakSpells();
      await interaction.respond(spells.filter((spell) => spell.name.toLocaleLowerCase().includes(search)).slice(0, 25).map((spell) => ({
        name: spell.name,
        value: spell.id
      })));
      return;
    }
    if (focused.name === "cycle") {
      const cycles = await listRunecloakCycles(interaction.guildId);
      await interaction.respond(cycles.filter((cycle) => `${cycle.label} ${cycle.status}`.toLocaleLowerCase().includes(search)).slice(0, 25).map((cycle) => ({
        name: `${cycle.label} - ${cycle.status}`.slice(0, 100),
        value: cycle.id
      })));
      return;
    }
    if (focused.name === "stage") {
      const cycles = await listRunecloakCycles(interaction.guildId);
      const cycleIds = cycles.map(({ id }) => id);
      const { data, error } = cycleIds.length
        ? await supabase.from("runecloak_stages").select("id, sequence, title, status").in("cycle_id", cycleIds).order("created_at", { ascending: false }).limit(100)
        : { data: [], error: null };
      assertNoDbError(error, "list Runecloak stages");
      await interaction.respond((data ?? []).filter((stage) => `${stage.title} ${stage.status}`.toLocaleLowerCase().includes(search)).slice(0, 25).map((stage) => ({
        name: `Stage ${stage.sequence}: ${stage.title} - ${stage.status}`.slice(0, 100),
        value: stage.id
      })));
      return;
    }
    if (focused.name === "site") {
      const { data, error } = await supabase.from("runecloak_research_sites").select("id, name, hold_region").eq("status", "Approved").order("name").limit(100);
      assertNoDbError(error, "list approved Runecloak sites");
      await interaction.respond((data ?? []).filter((site) => `${site.name} ${site.hold_region}`.toLocaleLowerCase().includes(search)).slice(0, 25).map((site) => ({
        name: `${site.name} - ${site.hold_region}`.slice(0, 100),
        value: site.id
      })));
      return;
    }
    await interaction.respond([]);
  },

  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
      throw new UserFacingError("Runecloak records are only available in the Ranger Corps server.");
    }
    const group = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand();
    const actor = await interaction.guild.members.fetch(interaction.user.id);

    if (!group && subcommand === "apply") {
      await interaction.showModal(runecloakApplicationModal());
      return;
    }
    if (!group && subcommand === "survey") {
      await interaction.showModal(runecloakSurveyModal());
      return;
    }
    if (!group && subcommand === "survey-screenshot") {
      const attachment = interaction.options.getAttachment("image", true);
      if (!attachment.contentType?.startsWith("image/")) {
        throw new UserFacingError("Attach an image file for the research-site screenshot.");
      }
      await interaction.deferReply({ ephemeral: true });
      const details = await addRunecloakSurveyScreenshot({
        guild: interaction.guild,
        discordUserId: interaction.user.id,
        screenshotUrl: attachment.url
      });
      await interaction.editReply({ content: `The screenshot is now attached to **${details.site?.name}**.` });
      return;
    }
    if (!group && subcommand === "withdraw") {
      const ranger = await requireRangerByDiscordId(actor.id);
      const application = await getOpenRunecloakApplication(ranger.id);
      if (!application) {
        throw new UserFacingError("You do not have an open Runecloak application.");
      }
      await interaction.deferReply({ ephemeral: true });
      await transitionRunecloakApplication({
        guildId: interaction.guild.id,
        applicationId: application.id,
        nextStatus: "Withdrawn",
        actorDiscordUserId: actor.id,
        note: "Withdrawn by applicant"
      });
      await refreshRunecloakDesk(interaction.guild);
      await interaction.editReply({ content: "Your Runecloak application has been withdrawn." });
      return;
    }
    if (!group && subcommand === "status") {
      await interaction.deferReply({ ephemeral: true });
      await interaction.editReply(await runecloakStatusPayload(interaction.guild));
      return;
    }
    if (!group && subcommand === "record") {
      await interaction.deferReply({ ephemeral: true });
      await interaction.editReply(await runecloakPersonalRecordPayload(interaction.guild, actor.id));
      return;
    }
    if (!group && subcommand === "setup") {
      assertRunecloakCommander(actor);
      const category = interaction.options.getChannel("category", true);
      const discussion = interaction.options.getChannel("discussion", true);
      const qualificationRole = interaction.options.getRole("qualification_role", true);
      if (category.type !== ChannelType.GuildCategory || discussion.type !== ChannelType.GuildText) {
        throw new UserFacingError("Choose the existing Runic Cloak category and its normal text discussion channel.");
      }
      if (qualificationRole.id !== DEFAULT_RUNECLOAK_ROLE_ID) {
        throw new UserFacingError(`Choose the permanent Ranger Runecloak role with ID ${DEFAULT_RUNECLOAK_ROLE_ID}.`);
      }
      await interaction.deferReply({ ephemeral: true });
      const result = await setupRunecloakDiscord({
        guild: interaction.guild,
        category: category as CategoryChannel,
        discussionChannel: discussion as TextChannel,
        qualificationRole: qualificationRole as Role,
        informationChannel: interaction.options.getChannel("information") as TextChannel | null,
        expeditionForum: interaction.options.getChannel("expeditions") as ForumChannel | null,
        organizerRole: interaction.options.getRole("organizer_role") as Role | null,
        learnerRole: interaction.options.getRole("learner_role") as Role | null,
        actorDiscordUserId: actor.id
      });
      await interaction.editReply({
        content: `The Runecloak desk is ready in ${result.informationChannel}; expedition records will be kept in ${result.expeditionForum}. The existing ${discussion} channel remains the member discussion room.`
      });
      return;
    }
    if (!group && subcommand === "manage") {
      if (!await isRunecloakOrganizer(actor) && !await isAuthorizedRunecloakMarshal(actor)) {
        throw new UserFacingError("A Runecloak organizer or authorized Runecloak Marshal is required to view the operating record.");
      }
      await interaction.deferReply({ ephemeral: true });
      const [settings, cycle, applications, team] = await Promise.all([
        requireRunecloakSettings(interaction.guild.id),
        getCurrentRunecloakCycle(interaction.guild.id),
        listRunecloakApplications(["Submitted", "Survey Requested", "Survey Submitted", "Revision Requested", "Approved"]),
        listActiveRunecloakTeamAssignments()
      ]);
      const statusCounts = new Map<string, number>();
      for (const details of applications) {
        statusCounts.set(details.application.status, (statusCounts.get(details.application.status) ?? 0) + 1);
      }
      await interaction.editReply({
        content: [
          `**Runecloak program:** ${settings.program_state}`,
          `**Applications:** ${[...statusCounts].map(([status, count]) => `${status}: ${count}`).join(", ") || "none"}`,
          `**Team:** ${team.filter(({ assignment_kind }) => assignment_kind === "organizer").length} organizers, ${team.filter(({ assignment_kind }) => assignment_kind === "authorized_marshal").length} authorized Marshals`,
          cycle ? `**Current cycle:** ${cycle.cycle.label} (${cycle.spell.name}) - ${cycle.cycle.status}, ${cycle.members.length} learners, ${cycle.cycle.verified_points}/${cycle.cycle.point_target} points` : "**Current cycle:** none",
          "",
          "Use the `program`, `team`, `cycle`, and `stage` Runecloak command groups for audited changes."
        ].join("\n")
      });
      return;
    }
    if (!group && subcommand === "audit") {
      if (!await isAuthorizedRunecloakMarshal(actor)) {
        throw new UserFacingError("An authorized Runecloak Marshal or Captain is required to export the audit ledger.");
      }
      await interaction.deferReply({ ephemeral: true });
      const cycleId = interaction.options.getString("cycle");
      await interaction.editReply({
        content: cycleId ? "Runecloak audit for the selected study cycle:" : "Complete Runecloak audit ledger:",
        files: [await runecloakAuditAttachment(interaction.guild.id, cycleId)]
      });
      return;
    }

    if (group === "program") {
      assertRunecloakCaptain(actor);
      const state = interaction.options.getString("state", true) as RunecloakProgramState;
      const reference = interaction.options.getString("moonshadow_reference");
      await interaction.deferReply({ ephemeral: true });
      await setRunecloakProgramState({
        guildId: interaction.guild.id,
        state,
        actorDiscordUserId: actor.id,
        registrationReference: reference
      });
      await updateRunecloakObserverAccess(interaction.guild, state === "Registered");
      await refreshRunecloakDesk(interaction.guild);
      await interaction.editReply({ content: `The Runecloak program is now **${state}**.` });
      return;
    }

    if (group === "team") {
      assertRunecloakCaptain(actor);
      const targetUser = interaction.options.getUser("member", true);
      const target = await requireRangerByDiscordId(targetUser.id);
      const kind = interaction.options.getString("kind", true) as "organizer" | "authorized_marshal";
      const active = subcommand === "add";
      const reason = interaction.options.getString("reason");
      await interaction.deferReply({ ephemeral: true });
      await setRunecloakTeamAssignment({
        guildId: interaction.guild.id,
        target,
        kind,
        active,
        actorDiscordUserId: actor.id,
        reason
      });
      await reconcileRunecloakRoles(interaction.guild);
      await interaction.editReply({ content: `${targetUser} is ${active ? "now" : "no longer"} recorded as ${kind === "organizer" ? "a Runecloak organizer" : "an authorized Runecloak Marshal"}.` });
      return;
    }

    if (group === "cycle") {
      if (subcommand === "create" || subcommand === "add" || subcommand === "remove") {
        if (!await isAuthorizedRunecloakMarshal(actor)) {
          throw new UserFacingError("An authorized Runecloak Marshal or Captain is required to build a study roster.");
        }
      } else {
        assertRunecloakCaptain(actor);
      }
      await interaction.deferReply({ ephemeral: true });
      if (subcommand === "create") {
        const cycle = await createRunecloakCycle({
          guildId: interaction.guild.id,
          spellId: interaction.options.getString("spell", true),
          label: interaction.options.getString("label", true),
          actorDiscordUserId: actor.id
        });
        await interaction.editReply({ content: `Created draft cycle **${cycle.label}**. Add only applicants whose surveys and admissions are approved.` });
        return;
      }
      const cycleId = interaction.options.getString("cycle", true);
      if (subcommand === "add") {
        const applicantUser = interaction.options.getUser("applicant", true);
        const ranger = await requireRangerByDiscordId(applicantUser.id);
        const application = await getOpenRunecloakApplication(ranger.id);
        if (!application || application.status !== "Approved") {
          throw new UserFacingError("That Ranger is not in the approved Runecloak waiting pool.");
        }
        await addRunecloakCycleMember({ cycleId, applicationId: application.id, actorDiscordUserId: actor.id });
        await interaction.editReply({ content: `${applicantUser} has been added to the draft roster.` });
        return;
      }
      if (subcommand === "remove") {
        const learner = interaction.options.getUser("learner", true);
        const ranger = await requireRangerByDiscordId(learner.id);
        await removeRunecloakCycleMember({ cycleId, rangerId: ranger.id, actorDiscordUserId: actor.id });
        await interaction.editReply({ content: `${learner} has been removed from the draft roster.` });
        return;
      }
      if (subcommand === "lock") {
        await lockRunecloakCycle(cycleId, actor.id);
        const details = await getRunecloakCycleDetails(cycleId);
        await reconcileRunecloakRoles(interaction.guild);
        await dispatchCycleRoster(interaction.guild.id, details, "Runecloak Study Roster Locked", `You have been selected for **${details?.cycle.label ?? "the next Runecloak study cycle"}**. Watch the Runecloak expedition board for the first paired study stage.`);
        await refreshRunecloakDesk(interaction.guild);
        await interaction.editReply({ content: `The roster is locked with **${details?.members.length ?? 0}** learners and now awaits Moonshadow start approval.` });
        return;
      }
      if (subcommand === "start") {
        const detailsBefore = await getRunecloakCycleDetails(cycleId);
        await startRunecloakCycle({
          guildId: interaction.guild.id,
          cycleId,
          reference: interaction.options.getString("moonshadow_reference", true),
          actorDiscordUserId: actor.id
        });
        await dispatchCycleRoster(interaction.guild.id, detailsBefore, "Runecloak Study Begins", `Moonshadow has cleared **${detailsBefore?.cycle.label ?? "your Runecloak cycle"}** to begin official study.`);
        await refreshRunecloakDesk(interaction.guild);
        await interaction.editReply({ content: "Moonshadow start approval is recorded. Official stages may now be opened." });
        return;
      }
      if (subcommand === "exclude") {
        const learner = interaction.options.getUser("learner", true);
        const ranger = await requireRangerByDiscordId(learner.id);
        const revalidatedStageIds = await setRunecloakCycleMemberStatus({
          guildId: interaction.guild.id,
          cycleId,
          rangerId: ranger.id,
          status: interaction.options.getString("status", true) as "Withdrawn" | "Ineligible",
          reason: interaction.options.getString("reason", true),
          actorDiscordUserId: actor.id
        });
        await reconcileRunecloakRoles(interaction.guild);
        for (const stageId of revalidatedStageIds) {
          await refreshRunecloakStagePost(interaction.guild, stageId);
        }
        await refreshRunecloakDesk(interaction.guild);
        await interaction.editReply({ content: `${learner} remains in the locked record and is now marked **${interaction.options.getString("status", true)}**.` });
        return;
      }
      if (subcommand === "complete") {
        await interaction.editReply(await runecloakCompletionPreviewPayload(interaction.guild, cycleId));
        return;
      }
    }

    if (group === "stage") {
      if (subcommand === "verify-session" || subcommand === "verify") {
        if (!await isAuthorizedRunecloakMarshal(actor)) {
          throw new UserFacingError("An authorized Runecloak Marshal or Captain is required to verify study evidence.");
        }
      } else if (!await isRunecloakOrganizer(actor) && !await isAuthorizedRunecloakMarshal(actor)) {
        throw new UserFacingError("A Runecloak organizer or authorized Marshal is required to file study expeditions.");
      }
      await interaction.deferReply({ ephemeral: true });
      if (subcommand === "create") {
        const result = await createRunecloakStage({
          guildId: interaction.guild.id,
          cycleId: interaction.options.getString("cycle", true),
          title: interaction.options.getString("title", true),
          theme: interaction.options.getString("theme", true),
          cooldownLabel: interaction.options.getString("study_window", true),
          euPlannedAt: normalizedDateOption(interaction.options.getString("eu_time")),
          naPlannedAt: normalizedDateOption(interaction.options.getString("na_time")),
          notes: interaction.options.getString("notes"),
          actorDiscordUserId: actor.id
        });
        await postRunecloakStage(interaction.guild, result.stage.id);
        await dispatchStage(interaction.guild.id, result.stage.id);
        await refreshRunecloakDesk(interaction.guild);
        await interaction.editReply({ content: `Opened **Stage ${result.stage.sequence}: ${result.stage.title}** with separate EU and NA participation controls.` });
        return;
      }
      const stageId = interaction.options.getString("stage", true);
      const slot = interaction.options.getString("slot") as "EU" | "NA" | null;
      if (subcommand === "submit-session") {
        await submitRunecloakSession({
          guildId: interaction.guild.id,
          stageId,
          regionalSlot: slot as "EU" | "NA",
          actualAt: interaction.options.getString("actual_time", true),
          siteId: interaction.options.getString("site", true),
          leaderDiscordUserId: interaction.options.getUser("leader", true).id,
          lessonSummary: interaction.options.getString("lesson_summary", true),
          studyMethod: interaction.options.getString("study_method", true),
          recordingUrl: interaction.options.getString("recording", true),
          moonshadowReference: interaction.options.getString("moonshadow_reference"),
          actorDiscordUserId: actor.id
        });
        await refreshRunecloakStagePost(interaction.guild, stageId);
        await interaction.editReply({ content: `The ${slot} session record is ready for Marshal verification.` });
        return;
      }
      if (subcommand === "verify-session") {
        await verifyRunecloakSession({
          guildId: interaction.guild.id,
          stageId,
          regionalSlot: slot as "EU" | "NA",
          basis: interaction.options.getString("basis", true) as "present" | "recording_review",
          actorDiscordUserId: actor.id
        });
        await refreshRunecloakStagePost(interaction.guild, stageId);
        await interaction.editReply({ content: `The ${slot} session and its submitted participation records are verified.` });
        return;
      }
      if (subcommand === "verify") {
        await verifyRunecloakStage({
          stageId,
          actorDiscordUserId: actor.id,
          reason: interaction.options.getString("note")
        });
        await refreshRunecloakStagePost(interaction.guild, stageId);
        await refreshRunecloakDesk(interaction.guild);
        const stage = await getRunecloakStage(stageId);
        await interaction.editReply({ content: `The paired stage is **${stage?.stage.status}** with **${stage?.stage.verified_points ?? 0}** verified points.` });
        return;
      }
    }

    throw new UserFacingError("That Runecloak command is not available.");
  }
};

async function dispatchCycleRoster(
  guildId: string,
  details: Awaited<ReturnType<typeof getRunecloakCycleDetails>>,
  title: string,
  body: string
): Promise<void> {
  if (!details) {
    return;
  }
  const { data: rangers, error } = await supabase.from("rangers").select("id, discord_user_id").in("id", details.members.map(({ ranger_id }) => ranger_id));
  assertNoDbError(error, "load Runecloak cycle recipients");
  await Promise.all((rangers ?? []).map((ranger) => queueBriefingDispatch({
    guildId,
    audience: "individual",
    targetDiscordUserId: ranger.discord_user_id,
    title,
    body,
    sourceKind: "runecloak-cycle",
    sourceId: `${details.cycle.id}:${title}`
  })));
}

async function dispatchStage(guildId: string, stageId: string): Promise<void> {
  const stage = await getRunecloakStage(stageId);
  if (!stage) {
    return;
  }
  const cycle = await getRunecloakCycleDetails(stage.cycle.id);
  await dispatchCycleRoster(
    guildId,
    cycle,
    `Runecloak Expedition: ${stage.stage.title}`,
    `A new paired ${stage.spell.name} study stage has opened. Attend either the EU or NA expedition and record your in-game \`/roll 100\` result on the expedition post.`
  );
}

function normalizedDateOption(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new UserFacingError("Use an ISO date and time such as `2026-09-14T20:00:00Z` for session schedules.");
  }
  return parsed.toISOString();
}
