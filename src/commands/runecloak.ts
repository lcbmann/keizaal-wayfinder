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
import {
  postRunecloakStage,
  publishRunecloakCycleQualifications,
  reconcileRunecloakRoles,
  refreshRunecloakApplicationReview,
  refreshRunecloakDesk,
  refreshRunecloakStagePost,
  runecloakApplicationModal,
  runecloakAuditAttachment,
  runecloakCompletionPreviewPayload,
  runecloakPersonalRecordPayload,
  runecloakStatusPayload,
  runecloakSurveyModal,
  setupRunecloakDiscord
} from "../services/runecloakDiscordService.js";
import {
  DEFAULT_RUNECLOAK_ROLE_ID,
  assertRunecloakCaptain,
  assertRunecloakCommander,
  createRunecloakCycle,
  createRunecloakStage,
  getCurrentRunecloakCycle,
  getOpenRunecloakApplication,
  getRunecloakApplicationDetails,
  getRunecloakCycleDetails,
  getRunecloakStage,
  isRunecloakGuide,
  listActiveRunecloakTeamAssignments,
  listActiveRunecloakMemberships,
  listRunecloakApplications,
  listRunecloakCycles,
  listRunecloakSpells,
  requireRunecloakSettings,
  recordRunecloakSpellDelivery,
  setRunecloakAdmissionsOpen,
  setRunecloakCycleMemberStatus,
  setRunecloakProgramState,
  setRunecloakTeamAssignment,
  startRunecloakCycle,
  submitRunecloakSession,
  transitionRunecloakApplication,
  verifyRunecloakSession
} from "../services/runecloakService.js";
import { queueBriefingDispatch } from "../services/briefingService.js";
import { requireRangerByDiscordId } from "../services/rangerService.js";
import type { BotCommand } from "./types.js";

const command = new SlashCommandBuilder()
  .setName("runecloak")
  .setDescription("Join Runecloak field study and maintain its research records.")
  .addSubcommand((subcommand) => subcommand
    .setName("apply")
    .setDescription("Ranger+: apply for the Runecloak research specialization."))
  .addSubcommand((subcommand) => subcommand
    .setName("withdraw")
    .setDescription("Withdraw your open Runecloak application."))
  .addSubcommand((subcommand) => subcommand
    .setName("survey")
    .setDescription("Submit your researched field survey (required for every learner)."))
  .addSubcommand((subcommand) => subcommand
    .setName("status")
    .setDescription("View Runecloak admissions and the current research campaign."))
  .addSubcommand((subcommand) => subcommand
    .setName("record")
    .setDescription("View your private Runecloak application and study record."))
  .addSubcommand((subcommand) => subcommand
    .setName("delivery")
    .setDescription("Runecloak Guide: record a spell actually delivered to one learner in game.")
    .addUserOption((option) => option.setName("learner").setDescription("Ranger who received the spell in game.").setRequired(true))
    .addStringOption((option) => option.setName("spell").setDescription("Delivered spell.").setRequired(true).setAutocomplete(true))
    .addStringOption((option) => option.setName("reference").setDescription("GM ticket or in-game delivery reference.").setRequired(true)))
  .addSubcommand((subcommand) => subcommand
    .setName("manage")
    .setDescription("Runecloak staff: view the current operating record."))
  .addSubcommand((subcommand) => subcommand
    .setName("audit")
    .setDescription("Authorized staff: export the Runecloak audit ledger.")
    .addStringOption((option) => option
      .setName("cycle")
      .setDescription("Limit the export to one research campaign.")
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
      .setName("runecloak")
      .setDescription("The existing full-Runecloak channel.")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true))
    .addRoleOption((option) => option
      .setName("qualification_role")
      .setDescription("The permanent Ranger Runecloak role.")
      .setRequired(true))
    .addChannelOption((option) => option
      .setName("desk")
      .setDescription("Optional existing Runecloak desk; Wayfinder creates runecloak-desk if omitted.")
      .addChannelTypes(ChannelType.GuildText))
    .addChannelOption((option) => option
      .setName("applications")
      .setDescription("Optional private Guide review channel; Wayfinder creates one if omitted.")
      .addChannelTypes(ChannelType.GuildText))
    .addChannelOption((option) => option
      .setName("learner_channel")
      .setDescription("Optional learner channel; Wayfinder creates runecloak-learner if omitted.")
      .addChannelTypes(ChannelType.GuildText))
    .addChannelOption((option) => option
      .setName("expeditions")
      .setDescription("Optional existing expedition Forum; Wayfinder creates one if omitted.")
      .addChannelTypes(ChannelType.GuildForum))
    .addRoleOption((option) => option
      .setName("guide_role")
      .setDescription("Optional existing Runecloak Guide role; Wayfinder creates one if omitted."))
    .addRoleOption((option) => option
      .setName("learner_role")
      .setDescription("Optional existing learner role; Wayfinder creates one if omitted.")))
  .addSubcommandGroup((group) => group
    .setName("program")
    .setDescription("Manage Runecloak admissions and Moonshadow registration.")
    .addSubcommand((subcommand) => subcommand
      .setName("admissions")
      .setDescription("Runecloak Guide: open or close applications independently of research.")
      .addBooleanOption((option) => option
        .setName("open")
        .setDescription("Whether Ranger+ applications are open.")
        .setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("set")
      .setDescription("Captain+: set the Runecloak program state.")
      .addStringOption((option) => option
        .setName("state")
        .setDescription("The new program state.")
        .setRequired(true)
        .addChoices(
          { name: "Organizing", value: "Organizing" },
          { name: "Registration Pending", value: "Registration Pending" },
          { name: "Registered", value: "Registered" },
          { name: "Paused", value: "Paused" }
        ))
      .addStringOption((option) => option
        .setName("moonshadow_reference")
        .setDescription("Required when confirming registration."))))
  .addSubcommandGroup((group) => group
    .setName("team")
    .setDescription("Manage the Runecloak Guides who operate the specialization.")
    .addSubcommand((subcommand) => subcommand
      .setName("add")
      .setDescription("Captain+: appoint a Runecloak Guide.")
      .addUserOption((option) => option.setName("member").setDescription("Active Ranger+ to appoint.").setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("remove")
      .setDescription("Captain+: remove a Runecloak Guide.")
      .addUserOption((option) => option.setName("member").setDescription("Corps member.").setRequired(true))
      .addStringOption((option) => option.setName("reason").setDescription("Why the assignment ended.").setRequired(true))))
  .addSubcommandGroup((group) => group
    .setName("cycle")
    .setDescription("Build and operate a shared spell-research campaign.")
    .addSubcommand((subcommand) => subcommand
      .setName("create")
      .setDescription("Runecloak Guide: create a draft research campaign.")
      .addStringOption((option) => option.setName("spell").setDescription("Approved spell.").setRequired(true).setAutocomplete(true))
      .addStringOption((option) => option.setName("label").setDescription("Research campaign label.").setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("start")
      .setDescription("Runecloak Guide: record Moonshadow approval and open the campaign.")
      .addStringOption((option) => option.setName("cycle").setDescription("Validated campaign.").setRequired(true).setAutocomplete(true))
      .addStringOption((option) => option.setName("moonshadow_reference").setDescription("Approval or ticket reference.").setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("exclude")
      .setDescription("Runecloak Guide: mark a campaign learner withdrawn or ineligible.")
      .addStringOption((option) => option.setName("cycle").setDescription("Official campaign.").setRequired(true).setAutocomplete(true))
      .addUserOption((option) => option.setName("learner").setDescription("Campaign learner.").setRequired(true))
      .addStringOption((option) => option
        .setName("status")
        .setDescription("How to preserve the learner in the audit record.")
        .setRequired(true)
        .addChoices(
          { name: "Withdrawn", value: "Withdrawn" },
          { name: "Ineligible", value: "Ineligible" }
        ))
      .addStringOption((option) => option.setName("reason").setDescription("Required audit reason.").setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("complete")
      .setDescription("Runecloak Guide: record the GM's approval of completed shared research.")
      .addStringOption((option) => option.setName("cycle").setDescription("Campaign awaiting GM approval.").setRequired(true).setAutocomplete(true))))
  .addSubcommandGroup((group) => group
    .setName("stage")
    .setDescription("Open and verify paired regional study expeditions.")
    .addSubcommand((subcommand) => subcommand
      .setName("create")
      .setDescription("Runecloak Guide: open a paired stage.")
      .addStringOption((option) => option.setName("cycle").setDescription("Active research campaign.").setRequired(true).setAutocomplete(true))
      .addStringOption((option) => option.setName("title").setDescription("Short stage title.").setRequired(true))
      .addStringOption((option) => option.setName("theme").setDescription("What the expeditions will study.").setRequired(true))
      .addStringOption((option) => option.setName("eu_time").setDescription("Optional ISO date/time for the EU session."))
      .addStringOption((option) => option.setName("na_time").setDescription("Optional ISO date/time for the NA session."))
      .addStringOption((option) => option.setName("notes").setDescription("Optional planning notes.")))
    .addSubcommand((subcommand) => subcommand
      .setName("submit-session")
      .setDescription("Runecloak Guide: close, file, and verify one regional session after rolls are recorded.")
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
      .addStringOption((option) => option.setName("basis").setDescription("How the Guide verified this record.").setRequired(true).addChoices(
        { name: "I was present", value: "present" },
        { name: "I reviewed the recording", value: "recording_review" }
      ))
      .addStringOption((option) => option.setName("moonshadow_reference").setDescription("Optional submission reference."))));

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
      await refreshRunecloakApplicationReview(interaction.guild, application.id);
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
    if (!group && subcommand === "delivery") {
      if (!await isRunecloakGuide(actor)) {
        throw new UserFacingError("A Runecloak Guide is required to record an in-game spell delivery.");
      }
      const learnerUser = interaction.options.getUser("learner", true);
      const learner = await requireRangerByDiscordId(learnerUser.id);
      const spellId = interaction.options.getString("spell", true);
      const spell = (await listRunecloakSpells()).find(({ id }) => id === spellId);
      if (!spell) {
        throw new UserFacingError("Choose a configured Runecloak spell.");
      }
      await interaction.deferReply({ ephemeral: true });
      const result = await recordRunecloakSpellDelivery({
        guildId: interaction.guild.id,
        rangerId: learner.id,
        spellId,
        deliveryReference: interaction.options.getString("reference", true),
        actorDiscordUserId: actor.id
      });
      if (result.newly_completed) {
        await reconcileRunecloakRoles(interaction.guild);
        await publishRunecloakCycleQualifications(interaction.guild, result.source_cycle_id);
        await queueBriefingDispatch({
          guildId: interaction.guild.id,
          audience: "individual",
          targetDiscordUserId: learner.discord_user_id,
          title: `${spell.name} Delivered`,
          body: `A Runecloak Guide recorded that a GM delivered **${spell.name}** to you in game. Reference: ${result.delivery_reference}${spell.sequence === 1 ? " This is your first completed Runecloak spell, so you now hold the full Runecloak qualification." : ""}`,
          sourceKind: "runecloak-spell-delivery",
          sourceId: `${spell.id}:${learner.id}`
        });
        await refreshRunecloakDesk(interaction.guild);
      }
      await interaction.editReply({
        content: result.newly_completed
          ? `Recorded **${spell.name}** as delivered in game to ${learnerUser}. Their qualification and Discord access are now synchronized.`
          : `${learnerUser} was already recorded as having received **${spell.name}**; no duplicate award was created.`
      });
      return;
    }
    if (!group && subcommand === "setup") {
      assertRunecloakCommander(actor);
      const category = interaction.options.getChannel("category", true);
      const runecloakChannel = interaction.options.getChannel("runecloak", true);
      const qualificationRole = interaction.options.getRole("qualification_role", true);
      if (category.type !== ChannelType.GuildCategory || runecloakChannel.type !== ChannelType.GuildText) {
        throw new UserFacingError("Choose the existing Runic Cloak category and full-Runecloak text channel.");
      }
      if (qualificationRole.id !== DEFAULT_RUNECLOAK_ROLE_ID) {
        throw new UserFacingError(`Choose the permanent Ranger Runecloak role with ID ${DEFAULT_RUNECLOAK_ROLE_ID}.`);
      }
      await interaction.deferReply({ ephemeral: true });
      const result = await setupRunecloakDiscord({
        guild: interaction.guild,
        category: category as CategoryChannel,
        runecloakChannel: runecloakChannel as TextChannel,
        qualificationRole: qualificationRole as Role,
        deskChannel: interaction.options.getChannel("desk") as TextChannel | null,
        applicationReviewChannel: interaction.options.getChannel("applications") as TextChannel | null,
        learnerChannel: interaction.options.getChannel("learner_channel") as TextChannel | null,
        expeditionForum: interaction.options.getChannel("expeditions") as ForumChannel | null,
        guideRole: interaction.options.getRole("guide_role") as Role | null,
        learnerRole: interaction.options.getRole("learner_role") as Role | null,
        actorDiscordUserId: actor.id
      });
      await interaction.editReply({
        content: `The desk is ready in ${result.deskChannel}; Guide-only reviews go to ${result.applicationReviewChannel}; learners use ${result.learnerChannel}; full Runecloaks use ${runecloakChannel}; and expedition records are kept in ${result.expeditionForum}. The managed roles are ${result.guideRole}, ${result.learnerRole}, and ${qualificationRole}.`
      });
      return;
    }
    if (!group && subcommand === "manage") {
      if (!await isRunecloakGuide(actor)) {
        throw new UserFacingError("A Runecloak Guide is required to view the operating record.");
      }
      await interaction.deferReply({ ephemeral: true });
      const [settings, cycle, applications, team, memberships] = await Promise.all([
        requireRunecloakSettings(interaction.guild.id),
        getCurrentRunecloakCycle(interaction.guild.id),
        listRunecloakApplications(["Submitted", "Survey Requested", "Survey Submitted", "Revision Requested"]),
        listActiveRunecloakTeamAssignments(),
        listActiveRunecloakMemberships(interaction.guild.id)
      ]);
      const statusCounts = new Map<string, number>();
      for (const details of applications) {
        statusCounts.set(details.application.status, (statusCounts.get(details.application.status) ?? 0) + 1);
      }
      await interaction.editReply({
        content: [
          `**Runecloak program:** ${settings.program_state}`,
          `**Admissions:** ${settings.admissions_open ? "Open" : "Closed"} (independent of the active campaign)`,
          `**Applications:** ${[...statusCounts].map(([status, count]) => `${status}: ${count}`).join(", ") || "none"}`,
          `**Guides:** ${team.length} appointed, with Captain+ retaining administrative access`,
          cycle ? `**Current campaign:** ${cycle.cycle.label} (${cycle.spell.name}) - ${cycle.cycle.status}, ${memberships.length} active members, ${cycle.cycle.verified_points}/${cycle.cycle.point_target} shared points` : "**Current campaign:** none",
          "",
          "Use the `program`, `team`, `cycle`, and `stage` Runecloak command groups for audited changes."
        ].join("\n")
      });
      return;
    }
    if (!group && subcommand === "audit") {
      if (!await isRunecloakGuide(actor)) {
        throw new UserFacingError("A Runecloak Guide is required to export the audit ledger.");
      }
      await interaction.deferReply({ ephemeral: true });
      const cycleId = interaction.options.getString("cycle");
      await interaction.editReply({
        content: cycleId ? "Runecloak audit for the selected research campaign:" : "Complete Runecloak audit ledger:",
        files: [await runecloakAuditAttachment(interaction.guild.id, cycleId)]
      });
      return;
    }

    if (group === "program") {
      if (subcommand === "admissions") {
        if (!await isRunecloakGuide(actor)) {
          throw new UserFacingError("A Runecloak Guide is required to open or close applications.");
        }
      } else {
        assertRunecloakCaptain(actor);
      }
      await interaction.deferReply({ ephemeral: true });
      if (subcommand === "admissions") {
        const open = interaction.options.getBoolean("open", true);
        await setRunecloakAdmissionsOpen({
          guildId: interaction.guild.id,
          open,
          actorDiscordUserId: actor.id
        });
        await refreshRunecloakDesk(interaction.guild);
        await interaction.editReply({ content: `Runecloak applications are now **${open ? "open" : "closed"}**. The current research campaign is unchanged.` });
        return;
      }
      const state = interaction.options.getString("state", true) as RunecloakProgramState;
      const reference = interaction.options.getString("moonshadow_reference");
      await setRunecloakProgramState({
        guildId: interaction.guild.id,
        state,
        actorDiscordUserId: actor.id,
        registrationReference: reference
      });
      await refreshRunecloakDesk(interaction.guild);
      await interaction.editReply({ content: `The Runecloak program is now **${state}**.` });
      return;
    }

    if (group === "team") {
      assertRunecloakCaptain(actor);
      const targetUser = interaction.options.getUser("member", true);
      const target = await requireRangerByDiscordId(targetUser.id);
      const active = subcommand === "add";
      const reason = interaction.options.getString("reason");
      await interaction.deferReply({ ephemeral: true });
      await setRunecloakTeamAssignment({
        guildId: interaction.guild.id,
        target,
        active,
        actorDiscordUserId: actor.id,
        reason
      });
      await reconcileRunecloakRoles(interaction.guild);
      await interaction.editReply({ content: `${targetUser} is ${active ? "now" : "no longer"} a Runecloak Guide.` });
      return;
    }

    if (group === "cycle") {
      if (!await isRunecloakGuide(actor)) {
        throw new UserFacingError("A Runecloak Guide is required to manage a research campaign.");
      }
      await interaction.deferReply({ ephemeral: true });
      if (subcommand === "create") {
        const cycle = await createRunecloakCycle({
          guildId: interaction.guild.id,
          spellId: interaction.options.getString("spell", true),
          label: interaction.options.getString("label", true),
          actorDiscordUserId: actor.id
        });
        await interaction.editReply({ content: `Created draft research campaign **${cycle.label}**. Active Runecloak members are enrolled when each paired expedition opens, and newly admitted learners can join an open pair immediately.` });
        return;
      }
      const cycleId = interaction.options.getString("cycle", true);
      if (subcommand === "start") {
        await startRunecloakCycle({
          guildId: interaction.guild.id,
          cycleId,
          reference: interaction.options.getString("moonshadow_reference", true),
          actorDiscordUserId: actor.id
        });
        const detailsBefore = await getRunecloakCycleDetails(cycleId);
        await dispatchCycleRoster(interaction.guild.id, detailsBefore, "Runecloak Study Begins", `Moonshadow has cleared **${detailsBefore?.cycle.label ?? "the Runecloak campaign"}** to begin official study. Each valid paired expedition adds to the shared spell effort and to your own earliest unfinished spell.`);
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
        await interaction.editReply({ content: `${learner} remains in the audit record and is now marked **${interaction.options.getString("status", true)}**.` });
        return;
      }
      if (subcommand === "complete") {
        await interaction.editReply(await runecloakCompletionPreviewPayload(interaction.guild, cycleId));
        return;
      }
    }

    if (group === "stage") {
      if (!await isRunecloakGuide(actor)) {
        throw new UserFacingError("A Runecloak Guide is required to operate and verify study expeditions.");
      }
      await interaction.deferReply({ ephemeral: true });
      if (subcommand === "create") {
        const result = await createRunecloakStage({
          guildId: interaction.guild.id,
          cycleId: interaction.options.getString("cycle", true),
          title: interaction.options.getString("title", true),
          theme: interaction.options.getString("theme", true),
          euPlannedAt: normalizedDateOption(interaction.options.getString("eu_time")),
          naPlannedAt: normalizedDateOption(interaction.options.getString("na_time")),
          notes: interaction.options.getString("notes"),
          actorDiscordUserId: actor.id
        });
        await postRunecloakStage(interaction.guild, result.stage.id);
        await dispatchStage(interaction.guild.id, result.stage.id);
        await refreshRunecloakDesk(interaction.guild);
        await interaction.editReply({ content: `Opened **Stage ${result.stage.sequence}: ${result.stage.title}** with separate EU and NA sessions. Each regional slot observes its own 72-hour cooldown.` });
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
        await verifyRunecloakSession({
          guildId: interaction.guild.id,
          stageId,
          regionalSlot: slot as "EU" | "NA",
          basis: interaction.options.getString("basis", true) as "present" | "recording_review",
          actorDiscordUserId: actor.id
        });
        await refreshRunecloakStagePost(interaction.guild, stageId);
        await refreshRunecloakDesk(interaction.guild);
        const stage = await getRunecloakStage(stageId);
        await interaction.editReply({
          content: stage?.stage.status === "Open"
            ? `The ${slot} session, evidence, and submitted participation records are filed and verified. The paired stage remains open for the other regional session.`
            : `The ${slot} session is filed. With both regions complete, Wayfinder automatically evaluated the pair as **${stage?.stage.status}** with **${stage?.stage.verified_points ?? 0}** verified points.`
        });
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
  const rangerIds = details.members
    .filter(({ participation_status }) => participation_status === "Active" || participation_status === "Selected")
    .map(({ ranger_id }) => ranger_id);
  if (!rangerIds.length) {
    return;
  }
  const { data: rangers, error } = await supabase.from("rangers").select("id, discord_user_id").in("id", rangerIds);
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
    `A new paired ${stage.spell.name} research stage has opened. Attend either the EU or NA expedition and record your in-game \`/roll 100\` result on the expedition post. Valid work advances the shared campaign and your own earliest unfinished spell.`
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
