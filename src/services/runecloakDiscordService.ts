import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ForumChannel,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  ThreadAutoArchiveDuration,
  type ButtonInteraction,
  type CategoryChannel,
  type Guild,
  type GuildMember,
  type ModalSubmitInteraction,
  type Role,
  type TextChannel
} from "discord.js";
import { roleIdForRank } from "../config/roles.js";
import { assertNoDbError, supabase, type RangerRow } from "../db/supabase.js";
import { UserFacingError } from "../utils/errors.js";
import { emojiEmbed, guildEmoji } from "../utils/guildEmojis.js";
import { mainRankFromMember, memberRankAtLeast } from "../utils/permissions.js";
import { queueBriefingDispatch } from "./briefingService.js";
import { appendQualificationToHonorsLedger } from "./honorsLedgerService.js";
import { syncGuildAtlasDiscordProfiles } from "./atlasDiscordProfileService.js";
import { postStrongboxThread } from "./strongboxService.js";
import {
  DEFAULT_RUNECLOAK_ROLE_ID,
  RUNECLOAK_QUALIFICATION_SLUG,
  addRunecloakCycleMember,
  assertRunecloakCaptain,
  attachRunecloakApplicationReview,
  attachRunecloakSiteForumPost,
  attachRunecloakStageForumPost,
  completeRunecloakCycle,
  createRunecloakApplication,
  getCurrentRunecloakCycle,
  getLatestRunecloakApplication,
  getOpenRunecloakApplication,
  getRunecloakApplicationDetails,
  getRunecloakCycleCompletionPreview,
  getRunecloakCycleDetails,
  getRunecloakSettings,
  getRunecloakStage,
  isAuthorizedRunecloakMarshal,
  listActiveRunecloakTeamAssignments,
  listRangerQualifications,
  listRunecloakApplications,
  listRunecloakAuditEvents,
  listRunecloakSpellProgress,
  parseDiscordUserIds,
  recordRunecloakParticipation,
  requireRunecloakSettings,
  reviewRunecloakSite,
  runecloakProgressBar,
  saveRunecloakSettings,
  setRunecloakDashboardMessage,
  submitRunecloakSurvey,
  transitionRunecloakApplication,
  type RunecloakApplicationDetails
} from "./runecloakService.js";

export const RUNECLOAK_BUTTON_PREFIX = "runecloak:";
export const RUNECLOAK_MODAL_PREFIX = "runecloak-modal:";

const INFORMATION_CHANNEL_NAME = "runecloak-information";
const EXPEDITION_FORUM_NAME = "runecloak-expeditions";
const LEARNER_ROLE_NAME = "Runecloak Learner";
const FORUM_TAGS = [
  "Research Site",
  "Study Stage",
  "Proposed",
  "Approved",
  "Retired",
  "Open",
  "Complete",
  "Oakflesh",
  "Lesser Ward"
];

export async function setupRunecloakDiscord(input: {
  guild: Guild;
  category: CategoryChannel;
  discussionChannel: TextChannel;
  qualificationRole: Role;
  actorDiscordUserId: string;
  informationChannel?: TextChannel | null;
  expeditionForum?: ForumChannel | null;
  organizerRole?: Role | null;
  learnerRole?: Role | null;
}): Promise<{
  informationChannel: TextChannel;
  expeditionForum: ForumChannel;
  learnerRole: Role;
}> {
  const { guild, category } = input;
  if (!guildEmoji(guild, "runecloak")) {
    throw new UserFacingError("The server needs a custom emoji named `:runecloak:` before Runecloak setup can continue.");
  }
  if (input.discussionChannel.parentId !== category.id) {
    throw new UserFacingError("Choose the existing `#runecloak` discussion channel inside the selected Runic Cloak category.");
  }
  if (!input.qualificationRole.editable) {
    throw new UserFacingError("Wayfinder's Discord role must be above the permanent Ranger Runecloak role before setup.");
  }
  if (input.organizerRole && !input.organizerRole.editable) {
    throw new UserFacingError("Wayfinder's Discord role must be above the optional organizer role before setup.");
  }
  if (input.learnerRole && !input.learnerRole.editable) {
    throw new UserFacingError("Wayfinder's Discord role must be above the selected learner role before setup.");
  }
  const existingSettings = await getRunecloakSettings(guild.id);
  const informationChannel = input.informationChannel
    ?? await fetchTextChannel(guild, existingSettings?.information_channel_id)
    ?? await guild.channels.create({
      name: INFORMATION_CHANNEL_NAME,
      type: ChannelType.GuildText,
      parent: category,
      topic: "Runecloak information, applications, and current study records.",
      reason: "Create the Ranger Runecloak information desk"
    });
  const expeditionForum = input.expeditionForum
    ?? await fetchForumChannel(guild, existingSettings?.expedition_forum_id)
    ?? await guild.channels.create({
      name: EXPEDITION_FORUM_NAME,
      type: ChannelType.GuildForum,
      parent: category,
      topic: "Approved research sites and official Runecloak study expeditions.",
      reason: "Create the Ranger Runecloak expedition Forum"
    });
  const learnerRole = input.learnerRole
    ?? (existingSettings?.learner_role_id ? guild.roles.cache.get(existingSettings.learner_role_id) : null)
    ?? await guild.roles.create({
      name: LEARNER_ROLE_NAME,
      hoist: false,
      mentionable: false,
      reason: "Create the temporary Runecloak study roster role"
    });

  if (informationChannel.parentId !== category.id) {
    await informationChannel.setParent(category, { lockPermissions: false, reason: "Keep the Runecloak information desk in the Runic Cloak category" });
  }
  if (expeditionForum.parentId !== category.id) {
    await expeditionForum.setParent(category, { lockPermissions: false, reason: "Keep Runecloak expeditions in the Runic Cloak category" });
  }

  await ensureRunecloakTags(expeditionForum);
  await configureRunecloakChannelPermissions({
    informationChannel,
    discussionChannel: input.discussionChannel,
    expeditionForum,
    qualificationRole: input.qualificationRole,
    organizerRole: input.organizerRole ?? null,
    learnerRole
  });
  await saveRunecloakSettings({
    guildId: guild.id,
    categoryId: category.id,
    informationChannelId: informationChannel.id,
    discussionChannelId: input.discussionChannel.id,
    expeditionForumId: expeditionForum.id,
    organizerRoleId: input.organizerRole?.id ?? existingSettings?.organizer_role_id ?? null,
    learnerRoleId: learnerRole.id,
    qualificationRoleId: input.qualificationRole.id || DEFAULT_RUNECLOAK_ROLE_ID,
    actorDiscordUserId: input.actorDiscordUserId
  });
  await refreshRunecloakDesk(guild);
  await reconcileRunecloakRoles(guild);
  return { informationChannel, expeditionForum, learnerRole };
}

export async function refreshRunecloakDesk(guild: Guild): Promise<boolean> {
  const settings = await getRunecloakSettings(guild.id);
  if (!settings) {
    return false;
  }
  const channel = await fetchTextChannel(guild, settings.information_channel_id);
  if (!channel) {
    return false;
  }
  let message = settings.dashboard_message_id
    ? await channel.messages.fetch(settings.dashboard_message_id).catch(() => null)
    : null;
  if (!message) {
    const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    message = recent?.find((candidate) =>
      candidate.author.id === guild.client.user.id && candidate.embeds[0]?.title?.includes("Runecloak Desk")
    ) ?? null;
  }
  const payload = await runecloakDeskPayload(guild);
  message = message ? await message.edit(payload) : await channel.send(payload);
  if (!message.pinned) {
    await message.pin("Keep the Runecloak desk available").catch(() => undefined);
  }
  await setRunecloakDashboardMessage(guild.id, message.id);
  return true;
}

export function runecloakApplicationModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`${RUNECLOAK_MODAL_PREFIX}application`)
    .setTitle("Apply for Runecloak Study")
    .addComponents(
      modalRow("reason", "Why do you seek this qualification?", TextInputStyle.Paragraph, true, 1500),
      modalRow("experience", "Any relevant field or magical experience?", TextInputStyle.Paragraph, false, 1500, "None is fine."),
      modalRow("availability", "Availability and EU or NA preference", TextInputStyle.Paragraph, true, 1000),
      modalRow("conflicts", "Other loyalties, duties, or conflicts", TextInputStyle.Paragraph, false, 1500, "Write None if there are none.")
    );
}

export function runecloakSurveyModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`${RUNECLOAK_MODAL_PREFIX}survey`)
    .setTitle("File a Runecloak Site Survey")
    .addComponents(
      modalRow("site", "Research site", TextInputStyle.Short, true, 200),
      modalRow("region", "Hold or region", TextInputStyle.Short, true, 100),
      modalRow("atlas", "Atlas code or entry reference", TextInputStyle.Short, true, 500),
      modalRow("report", "Link to your Ranger report", TextInputStyle.Short, true, 500),
      modalRow("resonance", "Why is this site resonant with Magicka?", TextInputStyle.Paragraph, true, 1800)
    );
}

export function runecloakReviewNoteModal(input: {
  target: "application" | "site";
  action: "deny" | "revision";
  id: string;
}): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`${RUNECLOAK_MODAL_PREFIX}review:${input.target}:${input.action}:${input.id}`)
    .setTitle(input.action === "revision" ? "Request a Revision" : "Record a Decision")
    .addComponents(modalRow(
      "note",
      input.action === "revision" ? "What needs to be revised?" : "Reason",
      TextInputStyle.Paragraph,
      true,
      1500
    ));
}

export function runecloakRollModal(stageId: string, slot: "EU" | "NA"): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`${RUNECLOAK_MODAL_PREFIX}roll:${slot}:${stageId}`)
    .setTitle(`Record ${slot} Expedition Result`)
    .addComponents(modalRow(
      "roll",
      "Your in-game /roll 100 result",
      TextInputStyle.Short,
      true,
      3,
      "1 through 100"
    ));
}

function runecloakGrantModal(cycleId: string, confirmedDiscordUserIds: string[]): ModalBuilder {
  const confirmedValue = confirmedDiscordUserIds.join("\n");
  if (confirmedValue.length > 4000) {
    throw new UserFacingError("The eligible list is too large for one Discord form. Export the Runecloak audit and divide the grant before continuing.");
  }
  return new ModalBuilder()
    .setCustomId(`${RUNECLOAK_MODAL_PREFIX}grant:${cycleId}`)
    .setTitle("Record Moonshadow Grant")
    .addComponents(
      modalRow("reference", "Moonshadow grant reference", TextInputStyle.Short, true, 1000),
      modalRow(
        "confirmed",
        "Confirmed Ranger IDs (one per line)",
        TextInputStyle.Paragraph,
        true,
        4000,
        "Remove anyone Moonshadow did not confirm.",
        confirmedValue
      )
    );
}

export async function handleRunecloakModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) {
    throw new UserFacingError("Runecloak records are only available in the Ranger Corps server.");
  }
  const route = interaction.customId.slice(RUNECLOAK_MODAL_PREFIX.length);
  if (route === "application") {
    await interaction.deferReply({ ephemeral: true });
    const member = await interaction.guild.members.fetch(interaction.user.id);
    let details = await createRunecloakApplication({
      member,
      reason: interaction.fields.getTextInputValue("reason"),
      experience: optionalField(interaction, "experience"),
      availability: interaction.fields.getTextInputValue("availability"),
      loyaltiesConflicts: optionalField(interaction, "conflicts")
    });
    try {
      const review = await postStrongboxThread({
        guild: interaction.guild,
        threadName: `Runecloak Application - ${rangerDisplayName(details.applicant)}`,
        embed: runecloakApplicationReviewEmbed(interaction.guild, details),
        components: runecloakApplicationReviewRows(details),
        reason: `Runecloak application from ${rangerDisplayName(details.applicant)}`
      });
      details = {
        ...details,
        application: await attachRunecloakApplicationReview({
          applicationId: details.application.id,
          channelId: review.channel.id,
          messageId: review.message.id,
          threadId: review.thread.id
        })
      };
      await interaction.editReply({
        content: "Your Runecloak application has been placed in the Strongbox for review. Leadership will send the research survey through your briefing if you are selected to continue."
      });
      await refreshRunecloakDesk(interaction.guild);
    } catch (error) {
      await supabase.from("runecloak_applications").delete().eq("id", details.application.id);
      throw error;
    }
    return;
  }

  if (route === "survey") {
    await interaction.deferReply({ ephemeral: true });
    const details = await submitRunecloakSurvey({
      guildId: interaction.guild.id,
      rangerDiscordUserId: interaction.user.id,
      siteName: interaction.fields.getTextInputValue("site"),
      holdRegion: interaction.fields.getTextInputValue("region"),
      atlasReference: interaction.fields.getTextInputValue("atlas"),
      reportUrl: interaction.fields.getTextInputValue("report"),
      resonanceDescription: interaction.fields.getTextInputValue("resonance")
    });
    await upsertRunecloakSitePost(interaction.guild, details);
    await refreshRunecloakApplicationReview(interaction.guild, details.application.id);
    await interaction.editReply({
      content: `Your site survey for **${details.site?.name}** has been filed. Add a screenshot with \`/runecloak survey-screenshot\` if you have one.`
    });
    return;
  }

  if (route.startsWith("review:")) {
    const [, target, action, id] = route.split(":");
    if ((target !== "application" && target !== "site") || (action !== "deny" && action !== "revision") || !id) {
      throw new UserFacingError("That Runecloak review form is no longer valid.");
    }
    await interaction.deferReply({ ephemeral: true });
    const actor = await interaction.guild.members.fetch(interaction.user.id);
    const note = interaction.fields.getTextInputValue("note");
    if (target === "application") {
      if (action === "deny") {
        assertRunecloakCaptain(actor);
      } else if (!await isAuthorizedRunecloakMarshal(actor)) {
        throw new UserFacingError("An authorized Runecloak Marshal or Captain is required to request revisions.");
      }
      const details = await transitionRunecloakApplication({
        guildId: interaction.guild.id,
        applicationId: id,
        nextStatus: action === "deny" ? "Denied" : "Revision Requested",
        actorDiscordUserId: actor.id,
        note
      });
      await notifyRunecloakApplicant(interaction.guild, details, action === "deny" ? "Application Closed" : "Survey Revision Requested", note);
      await refreshRunecloakApplicationReview(interaction.guild, id);
    } else {
      if (action === "deny") {
        assertRunecloakCaptain(actor);
      } else if (!await isAuthorizedRunecloakMarshal(actor)) {
        throw new UserFacingError("An authorized Runecloak Marshal or Captain is required to request revisions.");
      }
      const details = await reviewRunecloakSite({
        guildId: interaction.guild.id,
        siteId: id,
        outcome: action === "deny" ? "Rejected" : "Revision Requested",
        actorDiscordUserId: actor.id,
        note
      });
      await notifyRunecloakApplicant(interaction.guild, details, action === "deny" ? "Research Site Rejected" : "Survey Revision Requested", note);
      await upsertRunecloakSitePost(interaction.guild, details);
      await refreshRunecloakApplicationReview(interaction.guild, details.application.id);
    }
    await interaction.editReply({ content: action === "deny" ? "The decision has been recorded." : "The applicant will receive the revision request in their next briefing." });
    await refreshRunecloakDesk(interaction.guild);
    return;
  }

  if (route.startsWith("roll:")) {
    const [, slot, stageId] = route.split(":");
    if ((slot !== "EU" && slot !== "NA") || !stageId) {
      throw new UserFacingError("That participation form is no longer valid.");
    }
    const roll = Number.parseInt(interaction.fields.getTextInputValue("roll"), 10);
    await interaction.deferReply({ ephemeral: true });
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const result = await recordRunecloakParticipation({
      guildId: interaction.guild.id,
      stageId,
      regionalSlot: slot,
      member,
      rollValue: roll
    });
    await refreshRunecloakStagePost(interaction.guild, stageId);
    await interaction.editReply({
      content: `Recorded your ${slot} attendance and in-game roll of **${result.participation.roll_value}**. It remains provisional until a Marshal verifies the session.`
    });
    return;
  }

  if (route.startsWith("grant:")) {
    const cycleId = route.split(":")[1];
    if (!cycleId) {
      throw new UserFacingError("That Runecloak grant form is no longer valid.");
    }
    const actor = await interaction.guild.members.fetch(interaction.user.id);
    assertRunecloakCaptain(actor);
    await interaction.deferReply({ ephemeral: true });
    const before = await getRunecloakCycleCompletionPreview(cycleId);
    const submittedDiscordIds = parseDiscordUserIds(interaction.fields.getTextInputValue("confirmed"));
    const rangerIdByDiscordId = new Map(before.candidates.map(({ ranger }) => [ranger.discord_user_id, ranger.id]));
    const unknownIds = submittedDiscordIds.filter((discordId) => !rangerIdByDiscordId.has(discordId));
    if (unknownIds.length) {
      throw new UserFacingError("The confirmed list contains a Discord ID that is not in this locked Runecloak roster.");
    }
    const confirmedRangerIds = submittedDiscordIds.flatMap((discordId) => {
      const rangerId = rangerIdByDiscordId.get(discordId);
      return rangerId ? [rangerId] : [];
    });
    if (!confirmedRangerIds.length) {
      throw new UserFacingError("Keep at least one Moonshadow-confirmed Ranger in the grant list.");
    }
    await completeRunecloakCycle({
      cycleId,
      actorDiscordUserId: actor.id,
      grantReference: interaction.fields.getTextInputValue("reference"),
      confirmedRangerIds
    });
    await reconcileRunecloakRoles(interaction.guild);
    await publishRunecloakCycleQualifications(interaction.guild, cycleId);
    await dispatchRunecloakCycleCompletion(interaction.guild.id, before.details);
    await refreshRunecloakDesk(interaction.guild);
    await interaction.editReply({
      content: `The Moonshadow grant is recorded for **${confirmedRangerIds.length}** Ranger${confirmedRangerIds.length === 1 ? "" : "s"}. First-time completers received the Ranger Runecloak qualification.`
    });
    return;
  }

  throw new UserFacingError("That Runecloak form is no longer valid.");
}

export async function handleRunecloakButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) {
    throw new UserFacingError("Runecloak records are only available in the Ranger Corps server.");
  }
  const parts = interaction.customId.split(":");
  if (parts[0] !== "runecloak") {
    throw new UserFacingError("That Runecloak control is no longer valid.");
  }
  const action = parts[1];
  if (action === "apply") {
    await interaction.showModal(runecloakApplicationModal());
    return;
  }
  if (action === "survey") {
    await interaction.showModal(runecloakSurveyModal());
    return;
  }
  if (action === "record") {
    await interaction.deferReply({ ephemeral: true });
    await interaction.editReply(await runecloakPersonalRecordPayload(interaction.guild, interaction.user.id));
    return;
  }
  if (action === "status") {
    await interaction.deferReply({ ephemeral: true });
    await interaction.editReply(await runecloakStatusPayload(interaction.guild));
    return;
  }

  if (action === "complete") {
    const cycleId = parts[2];
    if (!cycleId) {
      throw new UserFacingError("That Runecloak completion control is no longer valid.");
    }
    const actor = await interaction.guild.members.fetch(interaction.user.id);
    assertRunecloakCaptain(actor);
    const eligibleDiscordIds = parseDiscordUserIds(interaction.message.embeds.flatMap((embed) => (
      embed.fields.map(({ value }) => value)
    )).join("\n"));
    if (!eligibleDiscordIds.length) {
      throw new UserFacingError("The completion preview does not contain any eligible Rangers. Run `/runecloak cycle complete` again.");
    }
    await interaction.showModal(runecloakGrantModal(cycleId, eligibleDiscordIds));
    return;
  }

  if (action === "application") {
    const reviewAction = parts[2];
    const applicationId = parts[3];
    if (!applicationId) {
      throw new UserFacingError("That application review is no longer valid.");
    }
    const actor = await interaction.guild.members.fetch(interaction.user.id);
    if (reviewAction === "deny" || reviewAction === "revision") {
      await interaction.showModal(runecloakReviewNoteModal({ target: "application", action: reviewAction, id: applicationId }));
      return;
    }
    if (reviewAction === "request-survey") {
      if (!await isAuthorizedRunecloakMarshal(actor)) {
        throw new UserFacingError("An authorized Runecloak Marshal or Captain is required to request surveys.");
      }
      await interaction.deferReply({ ephemeral: true });
      const details = await transitionRunecloakApplication({
        guildId: interaction.guild.id,
        applicationId,
        nextStatus: "Survey Requested",
        actorDiscordUserId: actor.id
      });
      await notifyRunecloakApplicant(
        interaction.guild,
        details,
        "Runecloak Survey Requested",
        "Scout a place in Skyrim that is resonant with Magicka. Add it to the Atlas, file a short Ranger report, then submit both references with `/runecloak survey`. A screenshot is encouraged."
      );
      await refreshRunecloakApplicationReview(interaction.guild, applicationId);
      await interaction.editReply({ content: "The applicant will receive the survey dispatch in their next briefing." });
      return;
    }
    if (reviewAction === "approve") {
      assertRunecloakCaptain(actor);
      await interaction.deferReply({ ephemeral: true });
      const details = await transitionRunecloakApplication({
        guildId: interaction.guild.id,
        applicationId,
        nextStatus: "Approved",
        actorDiscordUserId: actor.id
      });
      await notifyRunecloakApplicant(
        interaction.guild,
        details,
        "Runecloak Admission Approved",
        "Your survey has been accepted. You are now in the waiting pool for a future locked study cycle. This does not yet grant the Runecloak qualification."
      );
      await refreshRunecloakApplicationReview(interaction.guild, applicationId);
      await refreshRunecloakDesk(interaction.guild);
      await interaction.editReply({ content: "The applicant is now approved for the Runecloak waiting pool." });
      return;
    }
  }

  if (action === "site") {
    const reviewAction = parts[2];
    const siteId = parts[3];
    if (!siteId) {
      throw new UserFacingError("That research-site review is no longer valid.");
    }
    const actor = await interaction.guild.members.fetch(interaction.user.id);
    if (reviewAction === "deny" || reviewAction === "revision") {
      await interaction.showModal(runecloakReviewNoteModal({ target: "site", action: reviewAction, id: siteId }));
      return;
    }
    if (!await isAuthorizedRunecloakMarshal(actor)) {
      throw new UserFacingError("An authorized Runecloak Marshal or Captain is required to review research sites.");
    }
    await interaction.deferReply({ ephemeral: true });
    const outcome = reviewAction === "approve" ? "Approved" : reviewAction === "retire" ? "Retired" : null;
    if (!outcome) {
      throw new UserFacingError("That research-site action is no longer valid.");
    }
    const details = await reviewRunecloakSite({
      guildId: interaction.guild.id,
      siteId,
      outcome,
      actorDiscordUserId: actor.id
    });
    await upsertRunecloakSitePost(interaction.guild, details);
    await refreshRunecloakApplicationReview(interaction.guild, details.application.id);
    await interaction.editReply({ content: outcome === "Approved" ? "The research site is approved. A Captain may now approve the admission." : "The research site has been retired from active use." });
    return;
  }

  if (action === "participate") {
    const slot = parts[2];
    const stageId = parts[3];
    if ((slot !== "EU" && slot !== "NA") || !stageId) {
      throw new UserFacingError("That expedition control is no longer valid.");
    }
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const ranger = await supabase.from("rangers").select("id").eq("discord_user_id", member.id).maybeSingle();
    assertNoDbError(ranger.error, "check Runecloak participant");
    const stage = await getRunecloakStage(stageId);
    const cycleMember = ranger.data
      ? await supabase.from("runecloak_cycle_members").select("id, participation_status").eq("cycle_id", stage?.cycle.id ?? "").eq("ranger_id", ranger.data.id).maybeSingle()
      : { data: null, error: null };
    assertNoDbError(cycleMember.error, "check active Runecloak learner");
    if (cycleMember.data?.participation_status === "Active") {
      const priorRoll = stage?.participation.find((entry) => entry.ranger_id === ranger.data?.id && entry.roll_value !== null && entry.status !== "rejected");
      if (!priorRoll) {
        await interaction.showModal(runecloakRollModal(stageId, slot));
        return;
      }
    }
    await interaction.deferReply({ ephemeral: true });
    const result = await recordRunecloakParticipation({
      guildId: interaction.guild.id,
      stageId,
      regionalSlot: slot,
      member,
      rollValue: cycleMember.data?.participation_status === "Active" ? stage?.participation.find((entry) => entry.ranger_id === ranger.data?.id && entry.roll_value !== null)?.roll_value ?? null : null
    });
    await refreshRunecloakStagePost(interaction.guild, stageId);
    await interaction.editReply({
      content: result.kind === "observer"
        ? `You are listed as a non-counting observer for the ${slot} expedition.`
        : `Your ${slot} attendance is recorded. Your existing paired-stage roll remains **${result.participation.roll_value}**.`
    });
    return;
  }

  throw new UserFacingError("That Runecloak control is no longer valid.");
}

export async function addRunecloakSurveyScreenshot(input: {
  guild: Guild;
  discordUserId: string;
  screenshotUrl: string;
}): Promise<RunecloakApplicationDetails> {
  const ranger = await supabase.from("rangers").select("id").eq("discord_user_id", input.discordUserId).maybeSingle();
  assertNoDbError(ranger.error, "get Runecloak applicant");
  if (!ranger.data) {
    throw new UserFacingError("You do not have a Ranger Corps record.");
  }
  const application = await getOpenRunecloakApplication(ranger.data.id);
  const details = application ? await getRunecloakApplicationDetails(application.id) : null;
  if (!details?.site || !["Proposed", "Revision Requested", "Approved"].includes(details.site.status)) {
    throw new UserFacingError("Submit your Runecloak survey before attaching its screenshot.");
  }
  const { error } = await supabase.from("runecloak_research_sites").update({ screenshot_url: input.screenshotUrl }).eq("id", details.site.id);
  assertNoDbError(error, "attach Runecloak survey screenshot");
  const refreshed = await getRunecloakApplicationDetails(details.application.id);
  if (!refreshed) {
    throw new Error("The updated Runecloak survey could not be loaded.");
  }
  await upsertRunecloakSitePost(input.guild, refreshed);
  await refreshRunecloakApplicationReview(input.guild, refreshed.application.id);
  return refreshed;
}

export async function upsertRunecloakSitePost(guild: Guild, details: RunecloakApplicationDetails): Promise<void> {
  if (!details.site) {
    return;
  }
  const settings = await requireRunecloakSettings(guild.id);
  const forum = await fetchForumChannel(guild, settings.expedition_forum_id);
  if (!forum) {
    throw new UserFacingError("The Runecloak Expeditions Forum is unavailable. Run `/runecloak setup` again.");
  }
  const payload = runecloakSitePayload(guild, details);
  let thread = details.site.forum_thread_id
    ? await guild.channels.fetch(details.site.forum_thread_id).catch(() => null)
    : null;
  if (!thread?.isThread()) {
    thread = await forum.threads.create({
      name: `Research Site - ${details.site.name}`.slice(0, 100),
      message: payload,
      appliedTags: runecloakTagIds(forum, ["Research Site", siteStatusTag(details.site.status)]),
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
      reason: `Runecloak research survey by ${rangerDisplayName(details.applicant)}`
    });
    const starter = await thread.fetchStarterMessage();
    await attachRunecloakSiteForumPost({ siteId: details.site.id, threadId: thread.id, messageId: starter?.id ?? null });
  } else {
    const starter = await thread.fetchStarterMessage().catch(() => null);
    await starter?.edit(payload);
    await thread.setAppliedTags(runecloakTagIds(forum, ["Research Site", siteStatusTag(details.site.status)]), "Update Runecloak research-site status");
  }
}

export async function postRunecloakStage(guild: Guild, stageId: string): Promise<void> {
  const settings = await requireRunecloakSettings(guild.id);
  const forum = await fetchForumChannel(guild, settings.expedition_forum_id);
  const details = await getRunecloakStage(stageId);
  if (!forum || !details) {
    throw new UserFacingError("The Runecloak expedition Forum or stage is unavailable.");
  }
  const thread = await forum.threads.create({
    name: `${details.spell.name} ${details.stage.sequence} - ${details.stage.title}`.slice(0, 100),
    message: runecloakStagePayload(guild, details),
    appliedTags: runecloakTagIds(forum, ["Study Stage", "Open", details.spell.name]),
    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    reason: `Open Runecloak study stage ${details.stage.sequence}`
  });
  const starter = await thread.fetchStarterMessage();
  await attachRunecloakStageForumPost({ stageId, threadId: thread.id, messageId: starter?.id ?? null });
}

export async function refreshRunecloakStagePost(guild: Guild, stageId: string): Promise<void> {
  const details = await getRunecloakStage(stageId);
  if (!details?.stage.forum_thread_id) {
    return;
  }
  const thread = await guild.channels.fetch(details.stage.forum_thread_id).catch(() => null);
  if (!thread?.isThread()) {
    return;
  }
  const starter = await thread.fetchStarterMessage().catch(() => null);
  await starter?.edit(runecloakStagePayload(guild, details));
  if (thread.parent?.type === ChannelType.GuildForum) {
    await thread.setAppliedTags(runecloakTagIds(thread.parent, [
      "Study Stage",
      details.stage.status === "Valid" || details.stage.status === "Invalid" ? "Complete" : "Open",
      details.spell.name
    ]), "Update Runecloak stage status");
  }
}

export async function refreshRunecloakApplicationReview(guild: Guild, applicationId: string): Promise<void> {
  const details = await getRunecloakApplicationDetails(applicationId);
  if (!details?.application.strongbox_channel_id || !details.application.strongbox_message_id) {
    return;
  }
  const channel = await fetchTextChannel(guild, details.application.strongbox_channel_id);
  const message = await channel?.messages.fetch(details.application.strongbox_message_id).catch(() => null);
  await message?.edit({
    embeds: [runecloakApplicationReviewEmbed(guild, details)],
    components: runecloakApplicationReviewRows(details)
  });
}

export async function reconcileRunecloakRoles(guild: Guild): Promise<{ added: number; removed: number }> {
  const settings = await getRunecloakSettings(guild.id);
  if (!settings) {
    return { added: 0, removed: 0 };
  }
  const qualificationId = await getRunecloakQualificationId();
  const [members, qualificationsResult, rangersResult, team, currentCycle] = await Promise.all([
    guild.members.fetch(),
    supabase.from("ranger_qualifications").select("ranger_id").eq("qualification_id", qualificationId).is("revoked_at", null),
    supabase.from("rangers").select("id, discord_user_id"),
    listActiveRunecloakTeamAssignments(),
    getCurrentRunecloakCycle(guild.id)
  ]);
  assertNoDbError(qualificationsResult.error, "load Runecloak qualifications for role sync");
  assertNoDbError(rangersResult.error, "load Rangers for Runecloak role sync");
  const discordByRanger = new Map((rangersResult.data ?? []).map((ranger) => [ranger.id, ranger.discord_user_id]));
  const qualified = new Set((qualificationsResult.data ?? []).map(({ ranger_id }) => discordByRanger.get(ranger_id)).filter(Boolean));
  const learners = new Set((currentCycle?.members ?? [])
    .filter(({ participation_status }) => participation_status === "Active")
    .map(({ ranger_id }) => discordByRanger.get(ranger_id)).filter(Boolean));
  const organizers = new Set(team.filter(({ assignment_kind }) => assignment_kind === "organizer")
    .map(({ ranger_id }) => discordByRanger.get(ranger_id)).filter(Boolean));
  let added = 0;
  let removed = 0;
  for (const member of members.values()) {
    if (member.user.bot) {
      continue;
    }
    const changes = await Promise.all([
      syncRole(member, settings.qualification_role_id, qualified.has(member.id)),
      settings.learner_role_id ? syncRole(member, settings.learner_role_id, learners.has(member.id)) : Promise.resolve(0),
      settings.organizer_role_id ? syncRole(member, settings.organizer_role_id, organizers.has(member.id)) : Promise.resolve(0)
    ]);
    added += changes.filter((change) => change === 1).length;
    removed += changes.filter((change) => change === -1).length;
  }
  return { added, removed };
}

export async function reconcileRunecloakMemberRoles(member: GuildMember): Promise<void> {
  const settings = await getRunecloakSettings(member.guild.id);
  if (!settings || member.user.bot) {
    return;
  }
  const { data: ranger, error: rangerError } = await supabase.from("rangers").select("*").eq("discord_user_id", member.id).maybeSingle();
  assertNoDbError(rangerError, "get Ranger for Runecloak role sync");
  const qualificationId = await getRunecloakQualificationId();
  const eligibleRanger = Boolean(ranger && ranger.status === "Active" && ["Ranger", "Ranger Marshal", "Ranger Captain", "Ranger Commander"].includes(ranger.current_rank));
  const [qualificationResult, teamResult, currentCycle] = await Promise.all([
    ranger
      ? supabase.from("ranger_qualifications").select("id").eq("qualification_id", qualificationId).eq("ranger_id", ranger.id).is("revoked_at", null).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    ranger
      ? supabase.from("runecloak_team_assignments").select("assignment_kind").eq("ranger_id", ranger.id).eq("active", true)
      : Promise.resolve({ data: [], error: null }),
    getCurrentRunecloakCycle(member.guild.id)
  ]);
  assertNoDbError(qualificationResult.error, "check Ranger Runecloak qualification");
  assertNoDbError(teamResult.error, "check Runecloak team role");
  const cycleMember = ranger ? currentCycle?.members.find(({ ranger_id }) => ranger_id === ranger.id) : null;
  await Promise.all([
    syncRole(member, settings.qualification_role_id, Boolean(qualificationResult.data)),
    settings.learner_role_id
      ? syncRole(member, settings.learner_role_id, eligibleRanger && cycleMember?.participation_status === "Active")
      : Promise.resolve(0),
    settings.organizer_role_id
      ? syncRole(member, settings.organizer_role_id, eligibleRanger && (teamResult.data ?? []).some(({ assignment_kind }) => assignment_kind === "organizer"))
      : Promise.resolve(0)
  ]);
}

export async function publishRunecloakCycleQualifications(guild: Guild, cycleId: string): Promise<number> {
  const [awardsResult, qualificationsResult, rangersResult] = await Promise.all([
    supabase.from("ranger_qualifications").select("*").eq("source_cycle_id", cycleId).is("revoked_at", null),
    supabase.from("corps_qualifications").select("*").eq("slug", "ranger-runecloak").maybeSingle(),
    supabase.from("rangers").select("*")
  ]);
  assertNoDbError(awardsResult.error, "load Runecloak qualification awards");
  assertNoDbError(qualificationsResult.error, "load Runecloak qualification definition");
  assertNoDbError(rangersResult.error, "load Rangers for Runecloak qualification record");
  const qualification = qualificationsResult.data;
  if (!qualification) {
    return 0;
  }
  const rangersById = new Map((rangersResult.data ?? []).map((ranger) => [ranger.id, ranger]));
  let published = 0;
  for (const award of awardsResult.data ?? []) {
    const ranger = rangersById.get(award.ranger_id);
    if (ranger && await appendQualificationToHonorsLedger({ guild, ranger, qualification, award })) {
      published += 1;
    }
  }
  await syncGuildAtlasDiscordProfiles(guild).catch((error) => {
    console.warn("Could not refresh Atlas profiles after Runecloak qualification awards:", error);
  });
  return published;
}

export async function runecloakCompletionPreviewPayload(guild: Guild, cycleId: string) {
  const preview = await getRunecloakCycleCompletionPreview(cycleId);
  const eligible = preview.candidates.filter(({ eligible }) => eligible);
  if (!eligible.length) {
    throw new UserFacingError("No learners currently meet the personal attendance requirement for this grant.");
  }
  const ineligible = preview.candidates.filter(({ eligible: isEligible }) => !isEligible);
  const embed = emojiEmbed(guild, "runecloak", `Review Final Grant: ${preview.details.cycle.label}`)
    .setDescription([
      `**Study:** ${preview.details.spell.name}`,
      `**Shared record:** ${preview.details.cycle.verified_points.toLocaleString()} / ${preview.details.cycle.point_target.toLocaleString()} verified points across ${preview.validStageCount} valid paired stages.`,
      "The list below is prefilled from Wayfinder's attendance record. Continue only after Moonshadow confirms the actual recipients. Remove anyone Moonshadow did not approve in the final form."
    ].join("\n"))
    .setColor(0x5b7fc4);
  addLineFields(embed, "Eligible grant recipients", eligible.map((candidate) => (
    `${rangerDisplayName(candidate.ranger)} <@${candidate.ranger.discord_user_id}> - ${candidate.retainedAttendanceCredits}/${candidate.requiredAttendanceCredits} attendance credits`
  )));
  if (ineligible.length) {
    addLineFields(embed, "Not eligible", ineligible.map((candidate) => (
      `${rangerDisplayName(candidate.ranger)} - ${candidate.retainedAttendanceCredits}/${candidate.requiredAttendanceCredits} attendance credits (${candidate.participationStatus})`
    )));
  }
  return {
    embeds: [embed],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`runecloak:complete:${cycleId}`)
        .setLabel("Record Moonshadow Grant")
        .setStyle(ButtonStyle.Success)
    )],
    allowedMentions: { parse: [] as const }
  };
}

async function dispatchRunecloakCycleCompletion(guildId: string, before: Awaited<ReturnType<typeof getRunecloakCycleDetails>>): Promise<void> {
  if (!before) {
    return;
  }
  const after = await getRunecloakCycleDetails(before.cycle.id);
  if (!after) {
    return;
  }
  const { data: rangers, error } = await supabase.from("rangers").select("id, discord_user_id").in("id", after.members.map(({ ranger_id }) => ranger_id));
  assertNoDbError(error, "load completed Runecloak cycle recipients");
  const byId = new Map((rangers ?? []).map((ranger) => [ranger.id, ranger.discord_user_id]));
  const recipients = after.members.flatMap((member) => {
    const discordUserId = byId.get(member.ranger_id);
    return discordUserId ? [{ member, discordUserId }] : [];
  });
  await Promise.all(recipients.map(({ member, discordUserId }) => queueBriefingDispatch({
    guildId,
    audience: "individual",
    targetDiscordUserId: discordUserId,
    title: member.participation_status === "Completed" ? `${after.spell.name} Study Confirmed` : `${after.spell.name} Study Record Retained`,
    body: member.participation_status === "Completed"
      ? `Moonshadow confirmed your completion of **${after.spell.name}**.${after.spell.sequence === 1 ? " You now hold the Ranger Runecloak qualification." : ""}`
      : `This study cycle has ended. Your verified attendance credit remains on record for a later **${after.spell.name}** cycle; your old roll points will not be counted again.`,
    sourceKind: "runecloak-cycle-result",
    sourceId: `${after.cycle.id}:${member.ranger_id}`
  })));
}

export async function runecloakStatusPayload(guild: Guild) {
  const settings = await requireRunecloakSettings(guild.id);
  const cycle = await getCurrentRunecloakCycle(guild.id);
  const approvedApplications = await listRunecloakApplications(["Approved"]);
  const selectedRangerIds = new Set(cycle?.members.map(({ ranger_id }) => ranger_id) ?? []);
  let qualifiedRangerIds = new Set<string>();
  const approvedRangerIds = approvedApplications.map(({ applicant }) => applicant.id);
  if (approvedRangerIds.length) {
    const { data: qualification, error: qualificationError } = await supabase
      .from("corps_qualifications")
      .select("id")
      .eq("slug", "ranger-runecloak")
      .maybeSingle();
    assertNoDbError(qualificationError, "get Runecloak qualification for waiting pool");
    if (qualification) {
      const { data: awards, error: awardsError } = await supabase
        .from("ranger_qualifications")
        .select("ranger_id")
        .eq("qualification_id", qualification.id)
        .is("revoked_at", null)
        .in("ranger_id", approvedRangerIds);
      assertNoDbError(awardsError, "get qualified Rangers for waiting pool");
      qualifiedRangerIds = new Set((awards ?? []).map(({ ranger_id }) => ranger_id));
    }
  }
  const approved = approvedApplications.filter(({ applicant }) => (
    !selectedRangerIds.has(applicant.id) && !qualifiedRangerIds.has(applicant.id)
  )).length;
  const embed = emojiEmbed(guild, "runecloak", "Runecloak Study Record")
    .setDescription(`**Program:** ${settings.program_state}`)
    .addFields({ name: "Approved waiting pool", value: `${approved}`, inline: true })
    .setColor(0x5b7fc4);
  if (cycle) {
    embed.addFields(
      { name: "Current study", value: cycle.spell.name, inline: true },
      { name: "Company", value: cycle.cycle.label, inline: true },
      { name: "Cycle status", value: cycle.cycle.status, inline: true },
      {
        name: "Verified progress",
        value: `${runecloakProgressBar(cycle.cycle.verified_points, cycle.cycle.point_target)} ${cycle.cycle.verified_points.toLocaleString()} / ${cycle.cycle.point_target.toLocaleString()}`
      },
      { name: "Locked roster", value: `${cycle.cycle.locked_roster_count ?? cycle.members.length}`, inline: true },
      { name: "Stage quorum", value: `${cycle.cycle.required_stage_attendance ?? "Not locked"}`, inline: true }
    );
  } else {
    embed.addFields({ name: "Current study", value: "No official cycle is active." });
  }
  return { embeds: [embed] };
}

export async function runecloakPersonalRecordPayload(guild: Guild, discordUserId: string) {
  const rangerResult = await supabase.from("rangers").select("*").eq("discord_user_id", discordUserId).maybeSingle();
  assertNoDbError(rangerResult.error, "get Ranger for Runecloak record");
  if (!rangerResult.data) {
    throw new UserFacingError("You do not have a Ranger Corps record.");
  }
  const [application, qualifications, spellProgress, currentCycle] = await Promise.all([
    getLatestRunecloakApplication(rangerResult.data.id),
    listRangerQualifications(rangerResult.data.id),
    listRunecloakSpellProgress(rangerResult.data.id),
    getCurrentRunecloakCycle(guild.id)
  ]);
  const applicationDetails = application ? await getRunecloakApplicationDetails(application.id) : null;
  const cycleMember = currentCycle?.members.find(({ ranger_id }) => ranger_id === rangerResult.data?.id);
  const embed = emojiEmbed(guild, "runecloak", `Runecloak Record: ${rangerDisplayName(rangerResult.data)}`)
    .setColor(0x5b7fc4)
    .addFields(
      { name: "Application", value: application?.status ?? (qualifications.length ? "Completed" : "Not filed"), inline: true },
      { name: "Entry survey", value: applicationDetails?.site ? `${applicationDetails.site.status}: ${applicationDetails.site.name}` : "Not submitted", inline: true },
      { name: "Qualification", value: qualifications.map(({ name }) => name).join("\n") || "Not yet held", inline: true },
      { name: "Current cycle", value: cycleMember ? `${currentCycle?.spell.name}: ${cycleMember.participation_status}` : "Not selected", inline: true },
      {
        name: "Spell studies",
        value: spellProgress.length
          ? spellProgress.map(({ progress, spell }) => `${progress.status === "completed" ? "Complete" : "In progress"}: **${spell.name}** (${progress.verified_attendance_credits}/${progress.required_attendance_credits} attendance credits)`).join("\n")
          : "No confirmed spell study yet."
      }
    );
  return { embeds: [embed] };
}

export async function runecloakAuditAttachment(guildId: string, cycleId?: string | null): Promise<AttachmentBuilder> {
  const events = await listRunecloakAuditEvents(guildId, cycleId);
  const lines = [
    ["time", "entity_type", "entity_id", "action", "actor_discord_user_id", "reason", "before", "after", "source_url"].join("\t"),
    ...events.map((event) => [
      event.created_at,
      event.entity_type,
      event.entity_id ?? "",
      event.action,
      event.actor_discord_user_id,
      tsvValue(event.reason),
      tsvValue(JSON.stringify(event.before_snapshot ?? null)),
      tsvValue(JSON.stringify(event.after_snapshot ?? null)),
      event.source_url ?? ""
    ].join("\t"))
  ];
  return new AttachmentBuilder(Buffer.from(lines.join("\n"), "utf8"), {
    name: `runecloak-${cycleId ?? "all"}-audit.tsv`
  });
}

async function runecloakDeskPayload(guild: Guild) {
  const status = await runecloakStatusPayload(guild);
  const baseEmbed = status.embeds[0];
  if (!baseEmbed) {
    throw new Error("The Runecloak status embed could not be built.");
  }
  const embed = EmbedBuilder.from(baseEmbed)
    .setTitle(`${guildEmoji(guild, "runecloak") ? `${guildEmoji(guild, "runecloak")} - ` : ""}Ranger Runecloak Desk`)
    .setDescription([
      "Runecloak applications, research-site surveys, and current study records are kept here.",
      "Every applicant, including the original organizing group, must scout a Magicka-resonant place in Skyrim, add it to the Atlas, and file a Ranger report before admission.",
      "A screenshot is encouraged."
    ].join("\n\n"));
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("runecloak:apply").setLabel("Apply").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("runecloak:survey").setLabel("Submit Survey").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("runecloak:record").setLabel("My Record").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("runecloak:status").setLabel("Current Study").setStyle(ButtonStyle.Secondary)
      )
    ]
  };
}

function runecloakApplicationReviewEmbed(guild: Guild, details: RunecloakApplicationDetails): EmbedBuilder {
  const site = details.site;
  const embed = emojiEmbed(guild, "runecloak", `Runecloak Application: ${rangerDisplayName(details.applicant)}`)
    .setDescription(`**Status:** ${details.application.status}`)
    .addFields(
      { name: "Applicant", value: `<@${details.applicant.discord_user_id}> - ${rangerDisplayName(details.applicant)}`, inline: true },
      { name: "Current rank", value: details.applicant.current_rank, inline: true },
      { name: "Why they seek the qualification", value: details.application.reason.slice(0, 1024) },
      { name: "Relevant field or magical experience", value: details.application.experience?.slice(0, 1024) || "None recorded." },
      { name: "Availability", value: details.application.availability.slice(0, 1024) },
      { name: "Other loyalties, duties, or conflicts", value: details.application.loyalties_conflicts?.slice(0, 1024) || "None recorded." }
    )
    .setColor(details.application.status === "Approved" ? 0x4f8f5b : details.application.status === "Denied" ? 0xa43b3b : 0x5b7fc4)
    .setTimestamp(new Date(details.application.updated_at));
  if (site) {
    embed.addFields({
      name: "Entry survey",
      value: [
        `**${site.name}**, ${site.hold_region}`,
        `Atlas: ${site.atlas_reference}`,
        `[Ranger report](${site.report_url})`,
        site.screenshot_url ? `[Screenshot](${site.screenshot_url})` : "No screenshot attached.",
        `Site status: **${site.status}**${site.forum_thread_id ? ` - <#${site.forum_thread_id}>` : ""}`
      ].join("\n").slice(0, 1024)
    });
  }
  if (details.application.review_note) {
    embed.addFields({ name: "Latest review note", value: details.application.review_note.slice(0, 1024) });
  }
  return embed;
}

function runecloakApplicationReviewRows(details: RunecloakApplicationDetails): ActionRowBuilder<ButtonBuilder>[] {
  const status = details.application.status;
  if (status === "Submitted") {
    return [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`runecloak:application:request-survey:${details.application.id}`).setLabel("Request Survey").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`runecloak:application:deny:${details.application.id}`).setLabel("Deny").setStyle(ButtonStyle.Danger)
    )];
  }
  if (status === "Survey Submitted" && details.site?.status === "Approved") {
    return [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`runecloak:application:approve:${details.application.id}`).setLabel("Approve Admission").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`runecloak:application:revision:${details.application.id}`).setLabel("Request Revision").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`runecloak:application:deny:${details.application.id}`).setLabel("Deny").setStyle(ButtonStyle.Danger)
    )];
  }
  if (status === "Survey Submitted") {
    return [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`runecloak:application:revision:${details.application.id}`).setLabel("Request Revision").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`runecloak:application:deny:${details.application.id}`).setLabel("Deny").setStyle(ButtonStyle.Danger)
    )];
  }
  return [];
}

function runecloakSitePayload(guild: Guild, details: RunecloakApplicationDetails) {
  const site = details.site;
  if (!site) {
    throw new Error("A Runecloak research-site payload requires a site.");
  }
  const embed = emojiEmbed(guild, "runecloak", `Research Site: ${site.name}`)
    .setDescription(site.resonance_description)
    .addFields(
      { name: "Hold or region", value: site.hold_region, inline: true },
      { name: "Status", value: site.status, inline: true },
      { name: "Surveyed by", value: rangerDisplayName(details.applicant), inline: true },
      { name: "Atlas reference", value: site.atlas_reference.slice(0, 1024) },
      { name: "Ranger report", value: `[Open report](${site.report_url})` }
    )
    .setColor(site.status === "Approved" ? 0x4f8f5b : site.status === "Rejected" || site.status === "Retired" ? 0x747f8d : 0x5b7fc4)
    .setTimestamp(new Date(site.updated_at));
  if (site.screenshot_url) {
    embed.setImage(site.screenshot_url);
  }
  if (site.review_note) {
    embed.addFields({ name: "Review note", value: site.review_note.slice(0, 1024) });
  }
  const components = site.status === "Proposed"
    ? [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`runecloak:site:approve:${site.id}`).setLabel("Approve Site").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`runecloak:site:revision:${site.id}`).setLabel("Request Revision").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`runecloak:site:deny:${site.id}`).setLabel("Reject").setStyle(ButtonStyle.Danger)
    )]
    : site.status === "Approved"
      ? [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`runecloak:site:retire:${site.id}`).setLabel("Retire Site").setStyle(ButtonStyle.Secondary)
      )]
      : [];
  return { embeds: [embed], components };
}

function runecloakStagePayload(guild: Guild, details: NonNullable<Awaited<ReturnType<typeof getRunecloakStage>>>) {
  const uniqueLearners = new Set(details.participation
    .filter(({ participation_kind, status }) => participation_kind === "learner" && status !== "rejected")
    .map(({ ranger_id }) => ranger_id));
  const pendingPoints = [...new Map(details.participation
    .filter(({ participation_kind, status, roll_value }) => participation_kind === "learner" && status === "provisional" && roll_value !== null)
    .map((entry) => [entry.ranger_id, entry.roll_value ?? 0])).values()].reduce((sum, value) => sum + value, 0);
  const sessionLine = (slot: "EU" | "NA") => {
    const session = details.sessions.find(({ regional_slot }) => regional_slot === slot);
    const scheduled = session?.planned_at ? `<t:${Math.floor(new Date(session.planned_at).getTime() / 1000)}:F>` : "Not scheduled";
    return `**${slot}:** ${scheduled} - ${session?.status ?? "Missing"}`;
  };
  const embed = emojiEmbed(guild, "runecloak", `${details.spell.name} Stage ${details.stage.sequence}: ${details.stage.title}`)
    .setDescription(details.stage.theme)
    .addFields(
      { name: "Study window", value: details.stage.cooldown_label, inline: true },
      { name: "Stage status", value: details.stage.status, inline: true },
      { name: "Sessions", value: `${sessionLine("EU")}\n${sessionLine("NA")}` },
      { name: "Attendance", value: `${uniqueLearners.size} / ${details.stage.required_unique_attendance} unique learners`, inline: true },
      { name: "Points", value: `${details.stage.verified_points} verified${pendingPoints ? `, ${pendingPoints} pending` : ""}`, inline: true },
      { name: "Notes", value: details.stage.notes?.slice(0, 1024) ?? "No additional notes." }
    )
    .setColor(details.stage.status === "Valid" ? 0x4f8f5b : details.stage.status === "Invalid" ? 0xa43b3b : 0x5b7fc4)
    .setTimestamp(new Date(details.stage.updated_at));
  const components = details.stage.status === "Open"
    ? [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`runecloak:participate:EU:${details.stage.id}`).setLabel("Record EU Participation").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`runecloak:participate:NA:${details.stage.id}`).setLabel("Record NA Participation").setStyle(ButtonStyle.Primary)
    )]
    : [];
  return { embeds: [embed], components };
}

async function notifyRunecloakApplicant(guild: Guild, details: RunecloakApplicationDetails, title: string, body: string): Promise<void> {
  await queueBriefingDispatch({
    guildId: guild.id,
    audience: "individual",
    targetDiscordUserId: details.applicant.discord_user_id,
    title,
    body,
    sourceKind: "runecloak-application",
    sourceId: `${details.application.id}:${details.application.status}`
  });
}

async function configureRunecloakChannelPermissions(input: {
  informationChannel: TextChannel;
  discussionChannel: TextChannel;
  expeditionForum: ForumChannel;
  qualificationRole: Role;
  organizerRole: Role | null;
  learnerRole: Role;
}): Promise<void> {
  const guild = input.informationChannel.guild;
  const botId = guild.client.user.id;
  await Promise.all([
    input.informationChannel.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: false }),
    input.informationChannel.permissionOverwrites.edit(roleIdForRank("Ranger"), {
      ViewChannel: true,
      ReadMessageHistory: true,
      SendMessages: false
    }),
    input.informationChannel.permissionOverwrites.edit(botId, {
      ViewChannel: true,
      ReadMessageHistory: true,
      SendMessages: true,
      EmbedLinks: true,
      ManageMessages: true
    }),
    input.expeditionForum.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: false }),
    input.expeditionForum.permissionOverwrites.edit(roleIdForRank("Ranger"), {
      ViewChannel: true,
      ReadMessageHistory: true,
      SendMessages: false,
      SendMessagesInThreads: true
    }),
    input.expeditionForum.permissionOverwrites.edit(botId, {
      ViewChannel: true,
      ReadMessageHistory: true,
      SendMessages: true,
      SendMessagesInThreads: true,
      CreatePublicThreads: true,
      ManageThreads: true,
      ManageChannels: true,
      EmbedLinks: true
    }),
    input.discussionChannel.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: false }),
    input.discussionChannel.permissionOverwrites.edit(input.qualificationRole, {
      ViewChannel: true,
      ReadMessageHistory: true,
      SendMessages: true
    }),
    input.discussionChannel.permissionOverwrites.edit(input.learnerRole, {
      ViewChannel: true,
      ReadMessageHistory: true,
      SendMessages: true
    }),
    input.discussionChannel.permissionOverwrites.edit(botId, {
      ViewChannel: true,
      ReadMessageHistory: true,
      SendMessages: true,
      EmbedLinks: true
    })
  ]);
  if (input.organizerRole) {
    await input.discussionChannel.permissionOverwrites.edit(input.organizerRole, {
      ViewChannel: true,
      ReadMessageHistory: true,
      SendMessages: true
    });
  }
}

async function getRunecloakQualificationId(): Promise<string> {
  const { data, error } = await supabase.from("corps_qualifications")
    .select("id")
    .eq("slug", RUNECLOAK_QUALIFICATION_SLUG)
    .maybeSingle();
  assertNoDbError(error, "get Ranger Runecloak qualification");
  if (!data) {
    throw new Error("The Ranger Runecloak qualification is missing. Apply migration 046 before starting Wayfinder.");
  }
  return data.id;
}

export async function updateRunecloakObserverAccess(guild: Guild, enabled: boolean): Promise<void> {
  const settings = await requireRunecloakSettings(guild.id);
  const forum = await fetchForumChannel(guild, settings.expedition_forum_id);
  if (!forum) {
    return;
  }
  await forum.permissionOverwrites.edit(roleIdForRank("Apprentice"), enabled ? {
    ViewChannel: true,
    ReadMessageHistory: true,
    SendMessages: false,
    SendMessagesInThreads: true
  } : {
    ViewChannel: false,
    ReadMessageHistory: false
  });
}

async function ensureRunecloakTags(forum: ForumChannel): Promise<void> {
  const existing = new Set(forum.availableTags.map(({ name }) => name));
  const missing = FORUM_TAGS.filter((name) => !existing.has(name));
  if (forum.availableTags.length + missing.length > 20) {
    throw new UserFacingError("The Runecloak Expeditions Forum does not have room for Wayfinder's required tags.");
  }
  if (missing.length) {
    await forum.setAvailableTags([
      ...forum.availableTags.map((tag) => ({ id: tag.id, name: tag.name, moderated: tag.moderated, emoji: tag.emoji ?? undefined })),
      ...missing.map((name) => ({ name }))
    ], "Add Runecloak expedition tags");
  }
}

function runecloakTagIds(forum: ForumChannel, names: string[]): string[] {
  return names.map((name) => forum.availableTags.find((tag) => tag.name === name)?.id).filter((id): id is string => Boolean(id));
}

function siteStatusTag(status: string): string {
  if (status === "Approved") {
    return "Approved";
  }
  if (status === "Retired" || status === "Rejected") {
    return "Retired";
  }
  return "Proposed";
}

async function fetchTextChannel(guild: Guild, id?: string | null): Promise<TextChannel | null> {
  if (!id) {
    return null;
  }
  const channel = await guild.channels.fetch(id).catch(() => null);
  return channel?.type === ChannelType.GuildText ? channel : null;
}

async function fetchForumChannel(guild: Guild, id?: string | null): Promise<ForumChannel | null> {
  if (!id) {
    return null;
  }
  const channel = await guild.channels.fetch(id).catch(() => null);
  return channel?.type === ChannelType.GuildForum ? channel : null;
}

async function syncRole(member: GuildMember, roleId: string, shouldHave: boolean): Promise<-1 | 0 | 1> {
  const hasRole = member.roles.cache.has(roleId);
  if (hasRole === shouldHave) {
    return 0;
  }
  if (shouldHave) {
    await member.roles.add(roleId, "Synchronize Runecloak study status");
    return 1;
  }
  await member.roles.remove(roleId, "Synchronize Runecloak study status");
  return -1;
}

function modalRow(
  id: string,
  label: string,
  style: TextInputStyle,
  required: boolean,
  maxLength: number,
  placeholder?: string,
  value?: string
): ActionRowBuilder<TextInputBuilder> {
  const input = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(maxLength);
  if (placeholder) {
    input.setPlaceholder(placeholder);
  }
  if (value) {
    input.setValue(value);
  }
  return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
}

function addLineFields(embed: EmbedBuilder, name: string, lines: string[]): void {
  let chunk = "";
  let part = 1;
  for (const line of lines) {
    const next = chunk ? `${chunk}\n${line}` : line;
    if (next.length > 1000 && chunk) {
      embed.addFields({ name: part === 1 ? name : `${name} (${part})`, value: chunk });
      part += 1;
      chunk = line;
    } else {
      chunk = next;
    }
  }
  if (chunk) {
    embed.addFields({ name: part === 1 ? name : `${name} (${part})`, value: chunk });
  }
}

function optionalField(interaction: ModalSubmitInteraction, id: string): string | null {
  return interaction.fields.getTextInputValue(id).trim() || null;
}

function rangerDisplayName(ranger: RangerRow): string {
  return ranger.in_game_name ?? ranger.discord_display_name ?? ranger.discord_username ?? "Unknown Ranger";
}

function tsvValue(value: string | null): string {
  return (value ?? "").replace(/[\t\r\n]+/gu, " ").trim();
}
