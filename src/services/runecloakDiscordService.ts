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
import { queueBriefingDispatch } from "./briefingService.js";
import { appendQualificationToHonorsLedger } from "./honorsLedgerService.js";
import { syncGuildAtlasDiscordProfiles } from "./atlasDiscordProfileService.js";
import {
  DEFAULT_RUNECLOAK_ROLE_ID,
  RUNECLOAK_QUALIFICATION_SLUG,
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
  isRunecloakGuide,
  listActiveRunecloakTeamAssignments,
  listRangerQualifications,
  listRunecloakApplications,
  listRunecloakAuditEvents,
  listRunecloakSpellProgress,
  listRunecloakSpells,
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

const DESK_CHANNEL_NAME = "runecloak-desk";
const APPLICATION_REVIEW_CHANNEL_NAME = "runecloak-applications";
const EXPEDITION_FORUM_NAME = "runecloak-expeditions";
const LEARNER_CHANNEL_NAME = "runecloak-learner";
const GUIDE_ROLE_NAME = "Runecloak Guide";
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
  runecloakChannel: TextChannel;
  qualificationRole: Role;
  actorDiscordUserId: string;
  deskChannel?: TextChannel | null;
  applicationReviewChannel?: TextChannel | null;
  learnerChannel?: TextChannel | null;
  expeditionForum?: ForumChannel | null;
  guideRole?: Role | null;
  learnerRole?: Role | null;
}): Promise<{
  deskChannel: TextChannel;
  applicationReviewChannel: TextChannel;
  learnerChannel: TextChannel;
  expeditionForum: ForumChannel;
  guideRole: Role;
  learnerRole: Role;
}> {
  const { guild, category } = input;
  if (!guildEmoji(guild, "runecloak")) {
    throw new UserFacingError("The server needs a custom emoji named `:runecloak:` before Runecloak setup can continue.");
  }
  if (input.runecloakChannel.parentId !== category.id) {
    throw new UserFacingError("Choose the existing `#runecloak` channel inside the selected Runic Cloak category.");
  }
  if (!input.qualificationRole.editable) {
    throw new UserFacingError("Wayfinder's Discord role must be above the permanent Ranger Runecloak role before setup.");
  }
  if (input.guideRole && !input.guideRole.editable) {
    throw new UserFacingError("Wayfinder's Discord role must be above the selected Runecloak Guide role before setup.");
  }
  if (input.learnerRole && !input.learnerRole.editable) {
    throw new UserFacingError("Wayfinder's Discord role must be above the selected learner role before setup.");
  }
  const existingSettings = await getRunecloakSettings(guild.id);
  const deskChannel = input.deskChannel
    ?? await fetchTextChannel(guild, existingSettings?.desk_channel_id)
    ?? await guild.channels.create({
      name: DESK_CHANNEL_NAME,
      type: ChannelType.GuildText,
      parent: category,
      topic: "Runecloak information, applications, and current study records.",
      reason: "Create the Ranger Runecloak information desk"
    });
  const applicationReviewChannel = input.applicationReviewChannel
    ?? await fetchTextChannel(guild, existingSettings?.application_review_channel_id)
    ?? await guild.channels.create({
      name: APPLICATION_REVIEW_CHANNEL_NAME,
      type: ChannelType.GuildText,
      parent: category,
      topic: "Private Runecloak applications and field-survey reviews for Runecloak Guides.",
      reason: "Create the private Runecloak application review channel"
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
  const learnerChannel = input.learnerChannel
    ?? await fetchTextChannel(guild, existingSettings?.learner_channel_id)
    ?? await guild.channels.create({
      name: LEARNER_CHANNEL_NAME,
      type: ChannelType.GuildText,
      parent: category,
      topic: "Runecloak Learner discussion, preparation, and field-study coordination.",
      reason: "Create the Runecloak Learner channel"
    });
  const learnerRole = input.learnerRole
    ?? (existingSettings?.learner_role_id ? guild.roles.cache.get(existingSettings.learner_role_id) : null)
    ?? await guild.roles.create({
      name: LEARNER_ROLE_NAME,
      hoist: false,
      mentionable: false,
      reason: "Create the Runecloak learner role"
    });
  const guideRole = input.guideRole
    ?? (existingSettings?.guide_role_id ? guild.roles.cache.get(existingSettings.guide_role_id) : null)
    ?? await guild.roles.create({
      name: GUIDE_ROLE_NAME,
      hoist: false,
      mentionable: false,
      reason: "Create the Runecloak Guide role"
    });

  if (new Set([input.qualificationRole.id, learnerRole.id, guideRole.id]).size !== 3) {
    throw new UserFacingError("The Runecloak, Learner, and Guide roles must be three different roles.");
  }
  if (new Set([deskChannel.id, applicationReviewChannel.id, expeditionForum.id, learnerChannel.id, input.runecloakChannel.id]).size !== 5) {
    throw new UserFacingError("The Runecloak desk, applications, learner, full-member, and expedition destinations must be different channels.");
  }
  if (!guideRole.editable || !learnerRole.editable) {
    throw new UserFacingError("Wayfinder's Discord role must be above the Runecloak Guide and Runecloak Learner roles before setup.");
  }

  if (deskChannel.parentId !== category.id) {
    await deskChannel.setParent(category, { lockPermissions: false, reason: "Keep the Runecloak desk in the Runic Cloak category" });
  }
  if (applicationReviewChannel.parentId !== category.id) {
    await applicationReviewChannel.setParent(category, { lockPermissions: false, reason: "Keep Runecloak application reviews in the Runic Cloak category" });
  }
  if (expeditionForum.parentId !== category.id) {
    await expeditionForum.setParent(category, { lockPermissions: false, reason: "Keep Runecloak expeditions in the Runic Cloak category" });
  }
  if (learnerChannel.parentId !== category.id) {
    await learnerChannel.setParent(category, { lockPermissions: false, reason: "Keep the Runecloak Learner channel in the Runic Cloak category" });
  }

  await ensureRunecloakTags(expeditionForum);
  await configureRunecloakChannelPermissions({
    deskChannel,
    applicationReviewChannel,
    runecloakChannel: input.runecloakChannel,
    learnerChannel,
    expeditionForum,
    qualificationRole: input.qualificationRole,
    guideRole,
    learnerRole
  });
  await saveRunecloakSettings({
    guildId: guild.id,
    categoryId: category.id,
    deskChannelId: deskChannel.id,
    applicationReviewChannelId: applicationReviewChannel.id,
    runecloakChannelId: input.runecloakChannel.id,
    learnerChannelId: learnerChannel.id,
    expeditionForumId: expeditionForum.id,
    guideRoleId: guideRole.id,
    learnerRoleId: learnerRole.id,
    qualificationRoleId: input.qualificationRole.id || DEFAULT_RUNECLOAK_ROLE_ID,
    actorDiscordUserId: input.actorDiscordUserId
  });
  await refreshRunecloakDesk(guild);
  await reconcileRunecloakRoles(guild);
  return { deskChannel, applicationReviewChannel, learnerChannel, expeditionForum, guideRole, learnerRole };
}

export async function refreshRunecloakDesk(guild: Guild): Promise<boolean> {
  const settings = await getRunecloakSettings(guild.id);
  if (!settings) {
    return false;
  }
  const channel = await fetchTextChannel(guild, settings.desk_channel_id);
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
    .setTitle("Apply for Runecloak Field Study")
    .addComponents(
      modalRow("reason", "Why do you want to join this research?", TextInputStyle.Paragraph, true, 1500),
      modalRow("experience", "Relevant field or magical experience?", TextInputStyle.Paragraph, false, 1500, "None is fine; prior magical expertise is not required."),
      modalRow("availability", "Timezone, availability, and EU/NA preference", TextInputStyle.Paragraph, true, 1000),
      modalRow("conflicts", "Other duties or scheduling conflicts", TextInputStyle.Paragraph, false, 1500, "Write None if there are none.")
    );
}

export function runecloakSurveyModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`${RUNECLOAK_MODAL_PREFIX}survey`)
    .setTitle("File a Runecloak Site Survey")
    .addComponents(
      modalRow("site", "Research site", TextInputStyle.Short, true, 200),
      modalRow("region", "Hold or region", TextInputStyle.Short, true, 100),
      modalRow("atlas", "Atlas location code or reference", TextInputStyle.Short, true, 500, "Paste the Atlas location code or identifying reference."),
      modalRow(
        "rationale",
        "Survey notes and research value",
        TextInputStyle.Paragraph,
        true,
        1800,
        "Cover records, people consulted, access, hazards, and why the site seems worth revisiting."
      ),
      modalRow("image", "Survey image link (optional)", TextInputStyle.Short, false, 500, "Use an Imgur link or a Discord attachment link.")
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

function runecloakApprovalModal(cycleId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`${RUNECLOAK_MODAL_PREFIX}approval:${cycleId}`)
    .setTitle("Record GM Research Approval")
    .addComponents(modalRow("reference", "GM ticket or approval reference", TextInputStyle.Short, true, 1000));
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
    details = await ensureRunecloakApplicationReview(interaction.guild, details);
    await interaction.editReply({
      content: "Your application has been sent privately to the Runecloak Guides. If selected, you will receive a field-survey request through your briefing. Marshal+ may skip this initial application screening, but must still complete and pass the same survey."
    });
    await refreshRunecloakDesk(interaction.guild);
    return;
  }

  if (route === "survey") {
    await interaction.deferReply({ ephemeral: true });
    let details = await submitRunecloakSurvey({
      guildId: interaction.guild.id,
      rangerDiscordUserId: interaction.user.id,
      siteName: interaction.fields.getTextInputValue("site"),
      holdRegion: interaction.fields.getTextInputValue("region"),
      atlasReference: interaction.fields.getTextInputValue("atlas"),
      researchRationale: interaction.fields.getTextInputValue("rationale"),
      screenshotUrl: optionalField(interaction, "image")
    });
    // Marshal+ may enter directly through the survey. Their audited synthetic
    // application still receives the same Guide-only review record as everyone else.
    details = await ensureRunecloakApplicationReview(interaction.guild, details);
    await refreshRunecloakApplicationReview(interaction.guild, details.application.id);
    await interaction.editReply({
      content: `Your site survey for **${details.site?.name}** has been filed privately for Runecloak Guide review.`
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
    if (!await isRunecloakGuide(actor)) {
      throw new UserFacingError("A Runecloak Guide is required to review applications and surveys.");
    }
    if (target === "application") {
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
      const details = await reviewRunecloakSite({
        guildId: interaction.guild.id,
        siteId: id,
        outcome: action === "deny" ? "Rejected" : "Revision Requested",
        actorDiscordUserId: actor.id,
        note
      });
      await notifyRunecloakApplicant(interaction.guild, details, action === "deny" ? "Research Site Rejected" : "Survey Revision Requested", note);
      if (details.site?.forum_thread_id) {
        await upsertRunecloakSitePost(interaction.guild, details);
      }
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
      content: result.kind === "observer"
        ? `You were added to the ${slot} expedition as a non-counting observer because you are not an active Runecloak Learner.`
        : result.participation.roll_value === null
          ? `Recorded your ${slot} attendance. Your one permitted roll for this paired stage was already on file and remains provisional until verification.`
          : `Recorded your ${slot} attendance and in-game roll of **${result.participation.roll_value}**. It remains provisional until a Guide verifies the session; once valid, it supports the shared campaign and your earliest unfinished spell.`
    });
    return;
  }

  if (route.startsWith("approval:")) {
    const cycleId = route.split(":")[1];
    if (!cycleId) {
      throw new UserFacingError("That Runecloak approval form is no longer valid.");
    }
    const actor = await interaction.guild.members.fetch(interaction.user.id);
    if (!await isRunecloakGuide(actor)) {
      throw new UserFacingError("A Runecloak Guide is required to record GM research approval.");
    }
    await interaction.deferReply({ ephemeral: true });
    const before = await getRunecloakCycleCompletionPreview(cycleId);
    const result = await completeRunecloakCycle({
      cycleId,
      actorDiscordUserId: actor.id,
      gmApprovalReference: interaction.fields.getTextInputValue("reference")
    });
    await dispatchRunecloakCycleCompletion(interaction.guild.id, before.details);
    await refreshRunecloakDesk(interaction.guild);
    await interaction.editReply({
      content: `The GM approval is recorded. **${result.eligible_learners}** Ranger${result.eligible_learners === 1 ? " is" : "s are"} currently eligible for in-game delivery; no personal spell delivery or Runecloak qualification was recorded automatically.`
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
    if (!await isRunecloakGuide(actor)) {
      throw new UserFacingError("A Runecloak Guide is required to record GM research approval.");
    }
    await interaction.showModal(runecloakApprovalModal(cycleId));
    return;
  }

  if (action === "application") {
    const reviewAction = parts[2];
    const applicationId = parts[3];
    if (!applicationId) {
      throw new UserFacingError("That application review is no longer valid.");
    }
    const actor = await interaction.guild.members.fetch(interaction.user.id);
    if (!await isRunecloakGuide(actor)) {
      throw new UserFacingError("A Runecloak Guide is required to review applications.");
    }
    if (reviewAction === "deny" || reviewAction === "revision") {
      await interaction.showModal(runecloakReviewNoteModal({ target: "application", action: reviewAction, id: applicationId }));
      return;
    }
    if (reviewAction === "request-survey") {
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
        "Conduct a serious field survey of a place in Skyrim that seems promising for the study of nature, runes, wilderness fieldcraft, or practical magic. Mark it on the Atlas; search nearby Atlas records, Ranger reports, and available intelligence; ask people familiar with the area; and document what you learned, how to reach it, any hazards, and why it seems worth revisiting. You are not expected to identify magical phenomena as an expert, and you should not take unnecessary risks to prove a site's value. Then use **Submit Field Survey** at the Runecloak Desk. The form includes an optional place for an Imgur or Discord image link."
      );
      await refreshRunecloakApplicationReview(interaction.guild, applicationId);
      await interaction.editReply({ content: "The applicant will receive the survey dispatch in their next briefing." });
      return;
    }
    if (reviewAction === "approve") {
      await interaction.deferReply({ ephemeral: true });
      const before = await getRunecloakApplicationDetails(applicationId);
      if (before?.site?.status === "Proposed") {
        const approvedSite = await reviewRunecloakSite({
          guildId: interaction.guild.id,
          siteId: before.site.id,
          outcome: "Approved",
          actorDiscordUserId: actor.id
        });
        await upsertRunecloakSitePost(interaction.guild, approvedSite);
      }
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
        "Your field survey has been accepted and you are now a Runecloak Learner. You now have access to `#runecloak-learner` and the Runecloak Expeditions Forum. You may join any currently open expedition immediately, and your valid participation will count toward your personal study and the shared campaign. This does not yet grant the full Runecloak qualification."
      );
      await refreshRunecloakApplicationReview(interaction.guild, applicationId);
      await refreshRunecloakDesk(interaction.guild);
      await reconcileRunecloakRoles(interaction.guild);
      const currentCycle = await getCurrentRunecloakCycle(interaction.guild.id);
      await Promise.all((currentCycle?.stages ?? [])
        .filter(({ status }) => status === "Open")
        .map(({ id }) => refreshRunecloakStagePost(interaction.guild, id)));
      await interaction.editReply({ content: "The applicant is now a Runecloak Learner and may record counted participation in any currently open expedition." });
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
    if (!await isRunecloakGuide(actor)) {
      throw new UserFacingError("A Runecloak Guide is required to review research sites.");
    }
    if (reviewAction === "deny" || reviewAction === "revision") {
      await interaction.showModal(runecloakReviewNoteModal({ target: "site", action: reviewAction, id: siteId }));
      return;
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
    await interaction.editReply({ content: outcome === "Approved" ? "The research site is approved. A Guide may now approve the admission." : "The research site has been retired from active use." });
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
    const [membership, stageEligibility] = ranger.data
      ? await Promise.all([
        supabase.from("runecloak_memberships").select("id, status").eq("guild_id", interaction.guild.id).eq("ranger_id", ranger.data.id).maybeSingle(),
        supabase.from("runecloak_stage_eligible_learners").select("ranger_id").eq("stage_id", stageId).eq("ranger_id", ranger.data.id).maybeSingle()
      ])
      : [{ data: null, error: null }, { data: null, error: null }];
    assertNoDbError(membership.error, "check active Runecloak learner");
    assertNoDbError(stageEligibility.error, "check Runecloak stage eligibility");
    const isCountingMember = Boolean(stageEligibility.data)
      && (membership.data?.status === "Learner" || membership.data?.status === "Qualified");
    const priorRoll = stage?.participation.find((entry) =>
      entry.ranger_id === ranger.data?.id && entry.roll_value !== null && entry.status !== "rejected"
    );
    if (isCountingMember) {
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
      rollValue: isCountingMember ? priorRoll?.roll_value ?? null : null
    });
    await refreshRunecloakStagePost(interaction.guild, stageId);
    await interaction.editReply({
      content: result.kind === "observer"
        ? `You are listed as a non-counting observer for the ${slot} expedition.`
        : `Your ${slot} attendance is recorded. Your existing paired-stage roll remains **${priorRoll?.roll_value}**.`
    });
    return;
  }

  throw new UserFacingError("That Runecloak control is no longer valid.");
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
  if (!details?.application.review_channel_id || !details.application.review_message_id) {
    return;
  }
  const channel = await fetchTextChannel(guild, details.application.review_channel_id);
  const message = await channel?.messages.fetch(details.application.review_message_id).catch(() => null);
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
  const [members, qualificationsResult, rangersResult, membershipsResult, team] = await Promise.all([
    guild.members.fetch(),
    supabase.from("ranger_qualifications").select("ranger_id").eq("qualification_id", qualificationId).is("revoked_at", null),
    supabase.from("rangers").select("id, discord_user_id, status, current_rank"),
    supabase.from("runecloak_memberships").select("ranger_id, status").eq("guild_id", guild.id).in("status", ["Learner", "Qualified"]),
    listActiveRunecloakTeamAssignments()
  ]);
  assertNoDbError(qualificationsResult.error, "load Runecloak qualifications for role sync");
  assertNoDbError(rangersResult.error, "load Rangers for Runecloak role sync");
  assertNoDbError(membershipsResult.error, "load active Runecloak memberships for role sync");
  const discordByRanger = new Map((rangersResult.data ?? []).map((ranger) => [ranger.id, ranger.discord_user_id]));
  const eligibleRangerIds = new Set((rangersResult.data ?? [])
    .filter((ranger) => ranger.status === "Active" && ["Ranger", "Ranger Marshal", "Ranger Captain", "Ranger Commander"].includes(ranger.current_rank))
    .map(({ id }) => id));
  const qualified = new Set((qualificationsResult.data ?? [])
    .filter(({ ranger_id }) => eligibleRangerIds.has(ranger_id))
    .map(({ ranger_id }) => discordByRanger.get(ranger_id)).filter(Boolean));
  const learners = new Set((membershipsResult.data ?? [])
    .filter(({ ranger_id, status }) => status === "Learner" && eligibleRangerIds.has(ranger_id))
    .map(({ ranger_id }) => discordByRanger.get(ranger_id)).filter(Boolean));
  const guides = new Set(team.filter(({ ranger_id, assignment_kind }) => assignment_kind === "guide" && eligibleRangerIds.has(ranger_id))
    .map(({ ranger_id }) => discordByRanger.get(ranger_id)).filter(Boolean));
  let added = 0;
  let removed = 0;
  for (const member of members.values()) {
    if (member.user.bot) {
      continue;
    }
    const changes = await Promise.all([
      syncRole(member, settings.qualification_role_id, qualified.has(member.id)),
      syncRole(member, settings.learner_role_id, learners.has(member.id)),
      syncRole(member, settings.guide_role_id, guides.has(member.id))
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
  const [qualificationResult, teamResult, membershipResult] = await Promise.all([
    ranger
      ? supabase.from("ranger_qualifications").select("id").eq("qualification_id", qualificationId).eq("ranger_id", ranger.id).is("revoked_at", null).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    ranger
      ? supabase.from("runecloak_team_assignments").select("assignment_kind").eq("ranger_id", ranger.id).eq("active", true)
      : Promise.resolve({ data: [], error: null }),
    ranger
      ? supabase.from("runecloak_memberships").select("status").eq("guild_id", member.guild.id).eq("ranger_id", ranger.id).maybeSingle()
      : Promise.resolve({ data: null, error: null })
  ]);
  assertNoDbError(qualificationResult.error, "check Ranger Runecloak qualification");
  assertNoDbError(teamResult.error, "check Runecloak team role");
  assertNoDbError(membershipResult.error, "check Runecloak learner membership");
  await Promise.all([
    syncRole(member, settings.qualification_role_id, Boolean(qualificationResult.data)),
    syncRole(member, settings.learner_role_id, eligibleRanger && membershipResult.data?.status === "Learner"),
    syncRole(member, settings.guide_role_id, eligibleRanger && (teamResult.data ?? []).some(({ assignment_kind }) => assignment_kind === "guide"))
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
  const ineligible = preview.candidates.filter(({ eligible: isEligible }) => !isEligible);
  const embed = emojiEmbed(guild, "runecloak", `Record GM Research Approval: ${preview.details.cycle.label}`)
    .setDescription([
      `**Study:** ${preview.details.spell.name}`,
      `**Shared record:** ${preview.details.cycle.verified_points.toLocaleString()} / ${preview.details.cycle.point_target.toLocaleString()} verified points across ${preview.validStageCount} valid paired stages.`,
      "Record the GM ticket or approval reference once. This approves the spell for learners who meet their personal requirements, but it does not claim that anyone has received the spell in game. A Guide records each actual delivery separately after the learner and GM meet in game."
    ].join("\n"))
    .setColor(0x5b7fc4);
  if (eligible.length) {
    addLineFields(embed, "Ready for in-game delivery", eligible.map((candidate) => (
      `${rangerDisplayName(candidate.ranger)} <@${candidate.ranger.discord_user_id}> - ${candidate.verifiedPoints}/${candidate.requiredPoints} points; ${candidate.verifiedStages}/${candidate.requiredStages} valid paired expeditions`
    )));
  } else {
    embed.addFields({
      name: "Ready for in-game delivery",
      value: "None yet. The shared research may still be approved now; later learners become delivery-eligible automatically when their personal requirements are met."
    });
  }
  if (ineligible.length) {
    addLineFields(embed, "Not eligible", ineligible.map((candidate) => (
      `${rangerDisplayName(candidate.ranger)} - ${candidate.verifiedPoints}/${candidate.requiredPoints} points; ${candidate.verifiedStages}/${candidate.requiredStages} expeditions (${candidate.membershipStatus})`
    )));
  }
  return {
    embeds: [embed],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`runecloak:complete:${cycleId}`)
        .setLabel("Record GM Approval")
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
    title: member.participation_status === "Eligible for Delivery" ? `${after.spell.name} Ready for Delivery` : `${after.spell.name} Study Record Retained`,
    body: member.participation_status === "Eligible for Delivery"
      ? `The GMs approved the shared **${after.spell.name}** research and you have met its personal study requirements. You still need to arrange an in-game ticket and be online with a GM before a Guide records the spell as delivered.`
      : `The GMs approved the shared **${after.spell.name}** research. Your verified personal work remains attached to that spell, and you may continue toward its requirement in later expeditions. Points do not transfer to another spell.`,
    sourceKind: "runecloak-cycle-result",
    sourceId: `${after.cycle.id}:${member.ranger_id}`
  })));
}

export async function runecloakStatusPayload(guild: Guild) {
  const settings = await requireRunecloakSettings(guild.id);
  const [cycle, membershipsResult, unlocksResult, spells] = await Promise.all([
    getCurrentRunecloakCycle(guild.id),
    supabase.from("runecloak_memberships").select("ranger_id, status").eq("guild_id", guild.id).in("status", ["Learner", "Qualified"]),
    supabase.from("runecloak_spell_unlocks").select("spell_id, unlocked_at").eq("guild_id", guild.id).order("unlocked_at"),
    listRunecloakSpells()
  ]);
  assertNoDbError(membershipsResult.error, "load Runecloak memberships for status");
  assertNoDbError(unlocksResult.error, "load unlocked Runecloak spells for status");
  const activeMemberships = membershipsResult.data ?? [];
  const learners = activeMemberships.filter(({ status }) => status === "Learner").length;
  const spellNameById = new Map(spells.map((spell) => [spell.id, spell.name]));
  const unlockedSpells = (unlocksResult.data ?? []).map(({ spell_id }) => spellNameById.get(spell_id)).filter(Boolean);
  const embed = emojiEmbed(guild, "runecloak", "Runecloak Study Record")
    .setDescription(`**Program:** ${settings.program_state}\n**Admissions:** ${settings.admissions_open ? "Open" : "Closed"}`)
    .addFields(
      { name: "Active Runecloaks and learners", value: `${activeMemberships.length}`, inline: true },
      { name: "Learners pursuing first spell", value: `${learners}`, inline: true },
      { name: "GM-approved shared research", value: unlockedSpells.join(", ") || "None yet" }
    )
    .setColor(0x5b7fc4);
  if (cycle) {
    const currentStage = [...cycle.stages].reverse().find(({ status }) => status === "Open" || status === "Ready for Review");
    embed.addFields(
      { name: "Current study", value: cycle.spell.name, inline: true },
      { name: "Campaign", value: cycle.cycle.label, inline: true },
      { name: "Campaign status", value: cycle.cycle.status, inline: true },
      {
        name: "Verified progress",
        value: `${runecloakProgressBar(cycle.cycle.verified_points, cycle.cycle.point_target)} ${cycle.cycle.verified_points.toLocaleString()} / ${cycle.cycle.point_target.toLocaleString()}`
      },
      { name: "Active membership", value: `${activeMemberships.length}`, inline: true },
      {
        name: "Current paired-stage quorum",
        value: currentStage ? `${currentStage.required_unique_attendance} of ${currentStage.eligible_learner_count}` : "No pair is open",
        inline: true
      }
    );
  } else {
    embed.addFields({ name: "Current study", value: "No official research campaign is active." });
  }
  return { embeds: [embed] };
}

export async function runecloakPersonalRecordPayload(guild: Guild, discordUserId: string) {
  const rangerResult = await supabase.from("rangers").select("*").eq("discord_user_id", discordUserId).maybeSingle();
  assertNoDbError(rangerResult.error, "get Ranger for Runecloak record");
  if (!rangerResult.data) {
    throw new UserFacingError("You do not have a Ranger Corps record.");
  }
  const [application, qualifications, spellProgress, currentCycle, membershipResult] = await Promise.all([
    getLatestRunecloakApplication(rangerResult.data.id),
    listRangerQualifications(rangerResult.data.id),
    listRunecloakSpellProgress(rangerResult.data.id, guild.id),
    getCurrentRunecloakCycle(guild.id),
    supabase.from("runecloak_memberships").select("status, preferred_regional_slot").eq("guild_id", guild.id).eq("ranger_id", rangerResult.data.id).maybeSingle()
  ]);
  assertNoDbError(membershipResult.error, "load personal Runecloak membership");
  const applicationDetails = application ? await getRunecloakApplicationDetails(application.id) : null;
  const cycleMember = currentCycle?.members.find(({ ranger_id }) => ranger_id === rangerResult.data?.id);
  const embed = emojiEmbed(guild, "runecloak", `Runecloak Record: ${rangerDisplayName(rangerResult.data)}`)
    .setColor(0x5b7fc4)
    .addFields(
      { name: "Application", value: application?.status ?? (qualifications.length ? "Completed" : "Not filed"), inline: true },
      { name: "Entry survey", value: applicationDetails?.site ? `${applicationDetails.site.status}: ${applicationDetails.site.name}` : "Not submitted", inline: true },
      { name: "Membership", value: membershipResult.data ? `${membershipResult.data.status} (${membershipResult.data.preferred_regional_slot ?? "Flexible"})` : "Not admitted", inline: true },
      { name: "Qualification", value: qualifications.map(({ name }) => name).join("\n") || "Not yet held", inline: true },
      { name: "Current campaign", value: cycleMember ? `${currentCycle?.spell.name}: ${cycleMember.participation_status}` : "Not currently participating", inline: true },
      {
        name: "Spell studies",
        value: spellProgress.length
          ? spellProgress.map(({ progress, spell, unlock }) => `${progress.status === "completed" ? "Delivered in game" : progress.status === "eligible" && unlock ? "Ready for in-game delivery" : progress.status === "eligible" ? "Personal requirement met; awaiting shared GM approval" : "In progress"}: **${spell.name}** (${progress.verified_points}/${progress.required_points} points; ${progress.verified_valid_stages}/${progress.required_valid_stages} valid paired expeditions)`).join("\n")
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
  const settings = await requireRunecloakSettings(guild.id);
  const status = await runecloakStatusPayload(guild);
  const baseEmbed = status.embeds[0];
  if (!baseEmbed) {
    throw new Error("The Runecloak status embed could not be built.");
  }
  const embed = EmbedBuilder.from(baseEmbed)
    .setTitle(`${guildEmoji(guild, "runecloak") ? `${guildEmoji(guild, "runecloak")} - ` : ""}Ranger Runecloak Desk`)
    .setDescription([
      "The Runecloaks are an open Ranger+ field-research and training specialization: serious magical study for useful Corps fieldcraft, not a separate magical institution.",
      `**Admission:** Rangers apply, and the Runecloak Guides may request a field survey. Marshal+ may begin with the survey, but nobody skips it. An approved survey grants the Runecloak Learner role and access to <#${settings.learner_channel_id}>. Admissions stay open during research, and a newly admitted learner can join any currently open expedition immediately.`,
      `**Where things happen:** Application and survey buttons open private Discord forms. Guide reviews stay in <#${settings.application_review_channel_id}>. Approved research sites and each paired EU/NA expedition receive their own durable post in <#${settings.expedition_forum_id}>; that Forum is not another submission form.`,
      "**Field survey:** Find a place that seems promising for studying nature, runes, wilderness fieldcraft, or practical magic. Mark it on the Atlas, search nearby Atlas entries and existing Ranger or intelligence reports, ask people familiar with the area, and document what you learned, access, hazards, and why it seems worth revisiting. No magical expertise is expected. The form accepts an optional Imgur or Discord image link.",
      "**Risks:** This is serious field research. Hostile terrain, wildlife, ruins, and unstable or poorly understood magic may all be involved. Participation is voluntary; follow normal Corps safety practice and do not take unnecessary risks to produce a survey or roll.",
      `**Progress:** Shared research becomes ready for GM approval at **${settings.point_target.toLocaleString()} verified points**. An individual needs **${settings.personal_point_requirement.toLocaleString()} verified points across at least ${settings.personal_stage_requirement} valid paired expeditions**. Extra points still help the shared target but do not carry into another spell.`,
      `EU and NA sessions each observe their own **${settings.regional_cooldown_hours}-hour cooldown**. The same expedition may advance the active shared campaign while a late learner studies their earliest unfinished spell. Receiving your first spell in game grants the full Runecloak qualification.`
    ].join("\n\n"));
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("runecloak:apply").setLabel("Apply (Ranger+)").setStyle(ButtonStyle.Primary).setDisabled(!settings.admissions_open),
        new ButtonBuilder().setCustomId("runecloak:survey").setLabel("Submit Field Survey").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("runecloak:record").setLabel("My Progress").setStyle(ButtonStyle.Secondary),
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
      { name: "Entry path", value: details.application.initial_screening_skipped ? "Marshal+ direct field survey" : "Standard application and screening", inline: true },
      { name: "Why they seek the qualification", value: details.application.reason?.slice(0, 1024) || "Initial application screening skipped for Marshal+." },
      { name: "Relevant field or magical experience", value: details.application.experience?.slice(0, 1024) || "None recorded." },
      { name: "Availability", value: details.application.availability?.slice(0, 1024) || "Not collected on the Marshal+ direct path." },
      { name: "Regional preference", value: details.application.preferred_regional_slot ?? "Flexible / not recorded", inline: true },
      { name: "Other duties or scheduling conflicts", value: details.application.loyalties_conflicts?.slice(0, 1024) || "None recorded." }
    )
    .setColor(details.application.status === "Approved" ? 0x4f8f5b : details.application.status === "Denied" ? 0xa43b3b : 0x5b7fc4)
    .setTimestamp(new Date(details.application.updated_at));
  if (site) {
    embed.addFields(
      {
        name: "Entry survey",
        value: [
          `**${site.name}**, ${site.hold_region}`,
          `Atlas location code/reference: ${site.atlas_reference}`,
          site.screenshot_url ? `[Screenshot](${site.screenshot_url})` : "No screenshot attached.",
          `Site status: **${site.status}**${site.forum_thread_id ? ` - <#${site.forum_thread_id}>` : ""}`
        ].join("\n").slice(0, 1024)
      },
      { name: "Why it seems worth revisiting", value: site.research_rationale.slice(0, 1024) }
    );
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
  if (status === "Survey Submitted" && details.site?.status === "Proposed") {
    return [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`runecloak:application:approve:${details.application.id}`).setLabel("Approve Survey & Admit").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`runecloak:application:revision:${details.application.id}`).setLabel("Request Revision").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`runecloak:site:deny:${details.site.id}`).setLabel("Reject").setStyle(ButtonStyle.Danger)
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
    .setDescription(site.research_rationale)
    .addFields(
      { name: "Hold or region", value: site.hold_region, inline: true },
      { name: "Status", value: site.status, inline: true },
      { name: "Surveyed by", value: rangerDisplayName(details.applicant), inline: true },
      { name: "Atlas location code/reference", value: site.atlas_reference.slice(0, 1024) }
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
  const sessionRecord = (slot: "EU" | "NA") => {
    const session = details.sessions.find(({ regional_slot }) => regional_slot === slot);
    if (!session || session.status === "Planned") {
      return "The expedition record has not been submitted yet.";
    }
    return [
      `**Status:** ${session.status}`,
      session.actual_at ? `**Held:** <t:${Math.floor(new Date(session.actual_at).getTime() / 1000)}:F>` : null,
      session.leader_discord_user_id ? `**Guide/leader:** <@${session.leader_discord_user_id}>` : null,
      session.recording_url ? `**Evidence:** [Open recording](${session.recording_url})` : null,
      session.verification_basis ? `**Verified from:** ${session.verification_basis === "present" ? "direct attendance" : "recording review"}` : null,
      session.lesson_summary ? `**Lesson:** ${session.lesson_summary.slice(0, 320)}` : null,
      session.study_method ? `**Method:** ${session.study_method.slice(0, 320)}` : null,
      session.moonshadow_reference ? `**Reference:** ${session.moonshadow_reference.slice(0, 200)}` : null
    ].filter((line): line is string => Boolean(line)).join("\n").slice(0, 1024);
  };
  const embed = emojiEmbed(guild, "runecloak", `${details.spell.name} Stage ${details.stage.sequence}: ${details.stage.title}`)
    .setDescription(`${details.stage.theme}\n\nValid participation advances the shared campaign and each learner's earliest unfinished spell.`)
    .addFields(
      { name: "Regional cooldowns", value: "EU and NA each reset independently after 72 hours.", inline: true },
      { name: "Stage status", value: details.stage.status, inline: true },
      { name: "Sessions", value: `${sessionLine("EU")}\n${sessionLine("NA")}` },
      { name: "EU expedition record", value: sessionRecord("EU") },
      { name: "NA expedition record", value: sessionRecord("NA") },
      { name: "Attendance", value: `${uniqueLearners.size} / ${details.stage.required_unique_attendance} unique learners`, inline: true },
      { name: "Points", value: `${details.stage.verified_points} verified${pendingPoints ? `, ${pendingPoints} pending` : ""}`, inline: true },
      { name: "Notes", value: details.stage.notes?.slice(0, 1024) ?? "No additional notes." }
    )
    .setColor(details.stage.status === "Valid" ? 0x4f8f5b : details.stage.status === "Invalid" ? 0xa43b3b : 0x5b7fc4)
    .setTimestamp(new Date(details.stage.updated_at));
  const openSessionButtons = details.stage.status === "Open"
    ? details.sessions
      .filter(({ status }) => status === "Planned" || status === "Submitted")
      .map((session) => new ButtonBuilder()
        .setCustomId(`runecloak:participate:${session.regional_slot}:${details.stage.id}`)
        .setLabel(`Record ${session.regional_slot} Participation`)
        .setStyle(ButtonStyle.Primary))
    : [];
  const components = openSessionButtons.length
    ? [new ActionRowBuilder<ButtonBuilder>().addComponents(openSessionButtons)]
    : [];
  return { embeds: [embed], components };
}

async function ensureRunecloakApplicationReview(
  guild: Guild,
  details: RunecloakApplicationDetails
): Promise<RunecloakApplicationDetails> {
  if (
    details.application.review_channel_id
    && details.application.review_message_id
    && details.application.review_thread_id
  ) {
    return details;
  }
  const settings = await requireRunecloakSettings(guild.id);
  const channel = await fetchTextChannel(guild, settings.application_review_channel_id);
  if (!channel) {
    throw new UserFacingError("The private Runecloak application channel is unavailable. Run `/runecloak setup` again.");
  }
  const reason = `Runecloak application from ${rangerDisplayName(details.applicant)}`;
  const message = await channel.send({
    embeds: [runecloakApplicationReviewEmbed(guild, details)],
    components: runecloakApplicationReviewRows(details),
    allowedMentions: { parse: [] }
  });
  const thread = await message.startThread({
    name: `Runecloak Application - ${rangerDisplayName(details.applicant)}`.slice(0, 100),
    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    reason
  });
  return {
    ...details,
    application: await attachRunecloakApplicationReview({
      applicationId: details.application.id,
      channelId: channel.id,
      messageId: message.id,
      threadId: thread.id
    })
  };
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
  deskChannel: TextChannel;
  applicationReviewChannel: TextChannel;
  runecloakChannel: TextChannel;
  learnerChannel: TextChannel;
  expeditionForum: ForumChannel;
  qualificationRole: Role;
  guideRole: Role;
  learnerRole: Role;
}): Promise<void> {
  const guild = input.deskChannel.guild;
  const botId = guild.client.user.id;
  const captainRoleId = roleIdForRank("Ranger Captain");
  await Promise.all([
    input.deskChannel.permissionOverwrites.set([
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: roleIdForRank("Ranger"), allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] },
      { id: botId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ManageMessages] }
    ], "Apply Runecloak desk permissions"),
    input.applicationReviewChannel.permissionOverwrites.set([
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: input.guideRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages, PermissionFlagsBits.SendMessagesInThreads, PermissionFlagsBits.CreatePublicThreads] },
      { id: captainRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages, PermissionFlagsBits.SendMessagesInThreads, PermissionFlagsBits.CreatePublicThreads] },
      { id: botId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages, PermissionFlagsBits.SendMessagesInThreads, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.ManageThreads, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.EmbedLinks] }
    ], "Apply Runecloak application-review permissions"),
    input.expeditionForum.permissionOverwrites.set([
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: input.learnerRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessagesInThreads] },
      { id: input.qualificationRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessagesInThreads] },
      { id: input.guideRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessagesInThreads] },
      { id: captainRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessagesInThreads] },
      { id: botId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages, PermissionFlagsBits.SendMessagesInThreads, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.ManageThreads, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.EmbedLinks] }
    ], "Apply Runecloak expedition permissions"),
    input.runecloakChannel.permissionOverwrites.set([
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: input.qualificationRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages] },
      { id: input.guideRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages] },
      { id: captainRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages] },
      { id: botId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks] }
    ], "Apply full Runecloak channel permissions"),
    input.learnerChannel.permissionOverwrites.set([
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: input.learnerRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages] },
      { id: input.guideRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages] },
      { id: captainRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages] },
      { id: botId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks] }
    ], "Apply Runecloak learner-channel permissions")
  ]);
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
