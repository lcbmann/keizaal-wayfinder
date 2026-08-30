import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ForumChannel,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ThreadAutoArchiveDuration,
  type ButtonInteraction,
  type Guild,
  type GuildMember,
  type ModalSubmitInteraction,
  type ThreadChannel
} from "discord.js";
import { HOLDS } from "../config/holds.js";
import { rankAtLeast } from "../config/ranks.js";
import {
  assertNoDbError,
  supabase,
  type ManagedAssignmentParticipantRow,
  type ManagedAssignmentRow
} from "../db/supabase.js";
import { UserFacingError } from "../utils/errors.js";
import { emojiEmbed } from "../utils/guildEmojis.js";
import { mainRankFromMember, memberRankAtLeast } from "../utils/permissions.js";
import { getBotMessageState, saveBotMessageState } from "./botMessageStateService.js";
import { queueBriefingDispatch } from "./briefingService.js";

const ASSIGNMENTS_FORUM_STATE_KEY = "managed-assignments-forum";
export const ASSIGNMENT_MODAL_PREFIX = "assignment:create-submit:";
export const ASSIGNMENT_BUTTON_PREFIX = "assignment:";
const REQUIRED_ASSIGNMENT_TAG_NAMES = ["Open", "Completed", "Apprentice+", "Ranger+"];
const OPTIONAL_ASSIGNMENT_TAG_NAMES = [...HOLDS, "Cross-Skyrim"];
const ASSIGNMENT_TAG_NAMES = [...REQUIRED_ASSIGNMENT_TAG_NAMES, ...OPTIONAL_ASSIGNMENT_TAG_NAMES];

export async function getManagedAssignmentsForum(guild: Guild): Promise<ForumChannel | null> {
  const state = await getBotMessageState(ASSIGNMENTS_FORUM_STATE_KEY);
  if (!state) {
    return null;
  }
  const channel = await guild.channels.fetch(state.discord_channel_id).catch(() => null);
  return channel?.type === ChannelType.GuildForum ? channel : null;
}

export async function setupManagedAssignmentsForum(forum: ForumChannel): Promise<void> {
  const existingTagNames = new Set(forum.availableTags.map((tag) => tag.name));
  const missingRequired = REQUIRED_ASSIGNMENT_TAG_NAMES.filter((name) => !existingTagNames.has(name));
  if (forum.availableTags.length + missingRequired.length > 20) {
    throw new UserFacingError("The Assignments Forum needs room for Wayfinder's four status and rank tags.");
  }
  const remainingSlots = 20 - forum.availableTags.length - missingRequired.length;
  const missingOptional = OPTIONAL_ASSIGNMENT_TAG_NAMES
    .filter((name) => !existingTagNames.has(name))
    .slice(0, remainingSlots);
  const missingTags = [...missingRequired, ...missingOptional];
  if (missingTags.length > 0) {
    await forum.setAvailableTags([
      ...forum.availableTags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        moderated: tag.moderated,
        emoji: tag.emoji ?? undefined
      })),
      ...missingTags.map((name) => ({ name }))
    ], "Add Wayfinder assignment tags");
  }
  await saveBotMessageState(ASSIGNMENTS_FORUM_STATE_KEY, forum.id, []);
}

export function createAssignmentModal(params: {
  minimumRank: "Apprentice" | "Ranger";
  hold: string | null;
}): ModalBuilder {
  const encodedHold = encodeURIComponent(params.hold ?? "none");
  return new ModalBuilder()
    .setCustomId(`${ASSIGNMENT_MODAL_PREFIX}${params.minimumRank}:${encodedHold}`)
    .setTitle("Create a Ranger Assignment")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("title")
          .setLabel("Assignment title")
          .setStyle(TextInputStyle.Short)
          .setMaxLength(100)
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("objective")
          .setLabel("Objective")
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(1000)
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("details")
          .setLabel("Details, risks, or requirements")
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(1800)
          .setRequired(false)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("location")
          .setLabel("Meeting point or operating area")
          .setStyle(TextInputStyle.Short)
          .setMaxLength(200)
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("timing")
          .setLabel("Timing or deadline")
          .setStyle(TextInputStyle.Short)
          .setMaxLength(200)
          .setRequired(false)
      )
    );
}

export function isAssignmentModal(customId: string): boolean {
  return customId.startsWith(ASSIGNMENT_MODAL_PREFIX);
}

export async function handleAssignmentModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) {
    throw new UserFacingError("Assignments are only available in the Ranger Corps server.");
  }
  const organizer = await interaction.guild.members.fetch(interaction.user.id);
  if (!memberRankAtLeast(organizer, "Ranger")) {
    throw new UserFacingError("Ranger or higher is required to create an assignment.");
  }
  const parsed = parseAssignmentModalId(interaction.customId);
  if (!parsed) {
    throw new UserFacingError("That assignment form is no longer valid. Please open it again.");
  }
  await interaction.deferReply({ ephemeral: true });
  const created = await createManagedAssignment({
    guild: interaction.guild,
    organizer,
    title: interaction.fields.getTextInputValue("title"),
    objective: interaction.fields.getTextInputValue("objective"),
    details: optionalModalValue(interaction, "details"),
    location: interaction.fields.getTextInputValue("location"),
    timing: optionalModalValue(interaction, "timing"),
    hold: parsed.hold,
    minimumRank: parsed.minimumRank
  });
  await interaction.editReply({ content: `Assignment posted: ${created.thread}.` });
}

export async function createManagedAssignment(params: {
  guild: Guild;
  organizer: GuildMember;
  title: string;
  objective: string;
  details: string | null;
  location: string;
  timing: string | null;
  hold: string | null;
  minimumRank: "Apprentice" | "Ranger";
}): Promise<{ assignment: ManagedAssignmentRow; thread: ThreadChannel }> {
  const forum = await getManagedAssignmentsForum(params.guild);
  if (!forum) {
    throw new UserFacingError("The Assignments Forum is not configured. Ask a Marshal to run `/assignment setup` first.");
  }
  const { data: inserted, error } = await supabase.from("managed_assignments").insert({
    guild_id: params.guild.id,
    forum_channel_id: forum.id,
    thread_id: null,
    starter_message_id: null,
    title: normalizeLine(params.title, 100),
    objective: normalizeBlock(params.objective, 1000),
    details: nullableBlock(params.details, 1800),
    location: normalizeLine(params.location, 200),
    hold: params.hold,
    timing: nullableLine(params.timing, 200),
    minimum_rank: params.minimumRank,
    organizer_discord_user_id: params.organizer.id,
    status: "Open"
  }).select("*").single();
  assertNoDbError(error, "create managed assignment");
  if (!inserted) {
    throw new Error("Supabase did not return the created assignment.");
  }

  try {
    const thread = await forum.threads.create({
      name: inserted.title,
      message: await assignmentMessagePayload(params.guild, inserted.id),
      appliedTags: assignmentTagIds(forum, inserted),
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
      reason: `Ranger assignment created by ${params.organizer.user.tag}`
    });
    const starter = await thread.fetchStarterMessage();
    const { data: attached, error: attachError } = await supabase.from("managed_assignments").update({
      thread_id: thread.id,
      starter_message_id: starter?.id ?? null
    }).eq("id", inserted.id).select("*").single();
    assertNoDbError(attachError, "attach managed assignment Forum post");
    if (!attached) {
      throw new Error("Supabase did not return the attached assignment.");
    }
    await queueBriefingDispatch({
      guildId: params.guild.id,
      audience: attached.minimum_rank === "Ranger" ? "ranger_plus" : "apprentice_plus",
      title: `New Assignment: ${attached.title}`,
      body: `${attached.objective}\n\nOperating area: ${attached.location}${attached.hold ? ` (${attached.hold})` : ""}.`,
      sourceKind: "managed-assignment",
      sourceId: attached.id,
      sourceUrl: `https://discord.com/channels/${params.guild.id}/${thread.id}`,
      authorDiscordUserId: params.organizer.id
    }).catch((dispatchError) => {
      console.warn(`Could not add assignment ${attached.id} to Ranger briefings:`, dispatchError);
    });
    return { assignment: attached, thread };
  } catch (creationError) {
    await supabase.from("managed_assignments").delete().eq("id", inserted.id);
    throw creationError;
  }
}

export async function handleAssignmentButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) {
    throw new UserFacingError("Assignments are only available in the Ranger Corps server.");
  }
  const parsed = parseAssignmentButtonId(interaction.customId);
  if (!parsed) {
    throw new UserFacingError("That assignment control is no longer valid.");
  }
  const actor = await interaction.guild.members.fetch(interaction.user.id);
  const assignment = await getManagedAssignment(parsed.assignmentId);
  if (!assignment) {
    throw new UserFacingError("That assignment no longer exists.");
  }
  const rank = mainRankFromMember(actor);
  if (!rank || !rankAtLeast(rank, assignment.minimum_rank)) {
    throw new UserFacingError(`${assignment.minimum_rank} or higher is required for this assignment.`);
  }

  await interaction.deferReply({ ephemeral: true });
  if (parsed.action === "join") {
    if (assignment.status !== "Open") {
      throw new UserFacingError("That assignment is no longer open.");
    }
    const { error } = await supabase.from("managed_assignment_participants").upsert({
      assignment_id: assignment.id,
      discord_user_id: actor.id
    });
    assertNoDbError(error, "join managed assignment");
    await refreshManagedAssignmentPost(interaction.guild, assignment.id);
    await interaction.editReply({ content: `You joined **${assignment.title}**.` });
    return;
  }

  if (parsed.action === "withdraw") {
    if (assignment.status !== "Open") {
      throw new UserFacingError("That assignment is no longer open.");
    }
    const { error } = await supabase.from("managed_assignment_participants")
      .delete()
      .eq("assignment_id", assignment.id)
      .eq("discord_user_id", actor.id);
    assertNoDbError(error, "withdraw from managed assignment");
    await refreshManagedAssignmentPost(interaction.guild, assignment.id);
    await interaction.editReply({ content: `You withdrew from **${assignment.title}**.` });
    return;
  }

  if (actor.id !== assignment.organizer_discord_user_id && !memberRankAtLeast(actor, "Ranger Marshal")) {
    throw new UserFacingError("Only the assignment organizer or a Ranger Marshal may mark it complete.");
  }
  if (assignment.status !== "Open") {
    throw new UserFacingError("That assignment is already closed.");
  }
  const { error } = await supabase.from("managed_assignments").update({
    status: "Completed",
    completed_at: new Date().toISOString()
  }).eq("id", assignment.id);
  assertNoDbError(error, "complete managed assignment");
  await refreshManagedAssignmentPost(interaction.guild, assignment.id);
  await interaction.editReply({ content: `Marked **${assignment.title}** complete.` });
}

export async function refreshManagedAssignmentPost(guild: Guild, assignmentId: string): Promise<void> {
  const assignment = await getManagedAssignment(assignmentId);
  if (!assignment?.thread_id) {
    return;
  }
  const thread = await guild.channels.fetch(assignment.thread_id).catch(() => null);
  if (!thread?.isThread()) {
    return;
  }
  const starter = await thread.fetchStarterMessage().catch(() => null);
  if (starter) {
    await starter.edit(await assignmentMessagePayload(guild, assignment.id));
  }
  const forum = thread.parent?.type === ChannelType.GuildForum ? thread.parent : null;
  if (forum) {
    await thread.setAppliedTags(assignmentTagIds(forum, assignment), "Refresh assignment status");
  }
}

export async function getManagedAssignment(id: string): Promise<ManagedAssignmentRow | null> {
  const { data, error } = await supabase.from("managed_assignments").select("*").eq("id", id).maybeSingle();
  assertNoDbError(error, "get managed assignment");
  return data;
}

async function listAssignmentParticipants(assignmentId: string): Promise<ManagedAssignmentParticipantRow[]> {
  const { data, error } = await supabase.from("managed_assignment_participants")
    .select("*")
    .eq("assignment_id", assignmentId)
    .order("joined_at", { ascending: true });
  assertNoDbError(error, "list assignment participants");
  return data ?? [];
}

async function assignmentMessagePayload(guild: Guild, assignmentId: string) {
  const assignment = await getManagedAssignment(assignmentId);
  if (!assignment) {
    throw new Error("The managed assignment could not be loaded for its Forum post.");
  }
  const participants = await listAssignmentParticipants(assignment.id);
  const open = assignment.status === "Open";
  const embed = emojiEmbed(guild, "rangerorders", `Assignment - ${assignment.title}`)
    .setDescription(assignment.objective)
    .addFields(
      { name: "Status", value: assignment.status, inline: true },
      { name: "Minimum rank", value: `${assignment.minimum_rank}+`, inline: true },
      { name: "Organizer", value: `<@${assignment.organizer_discord_user_id}>`, inline: true },
      { name: "Operating area", value: assignment.hold ? `${assignment.location} (${assignment.hold})` : assignment.location, inline: false },
      { name: "Timing", value: assignment.timing ?? "No fixed deadline recorded.", inline: false },
      { name: "Details", value: assignment.details ?? "No additional requirements recorded.", inline: false },
      {
        name: `Participants (${participants.length})`,
        value: participants.length ? participants.map((participant) => `<@${participant.discord_user_id}>`).join("\n").slice(0, 1024) : "None signed on yet.",
        inline: false
      }
    )
    .setColor(open ? 0x587c4a : 0x747f8d)
    .setTimestamp(new Date(assignment.updated_at));
  const components = open
    ? [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`assignment:join:${assignment.id}`).setLabel("Join").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`assignment:withdraw:${assignment.id}`).setLabel("Withdraw").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`assignment:complete:${assignment.id}`).setLabel("Mark Complete").setStyle(ButtonStyle.Primary)
      )]
    : [];
  return { embeds: [embed], components };
}

function assignmentTagIds(forum: ForumChannel, assignment: ManagedAssignmentRow): string[] {
  const names = [assignment.status === "Open" ? "Open" : "Completed", `${assignment.minimum_rank}+`];
  if (assignment.hold && ASSIGNMENT_TAG_NAMES.includes(assignment.hold)) {
    names.push(assignment.hold);
  }
  return names.map((name) => forum.availableTags.find((tag) => tag.name === name)?.id).filter((id): id is string => Boolean(id));
}

function parseAssignmentModalId(customId: string): { minimumRank: "Apprentice" | "Ranger"; hold: string | null } | null {
  const [minimumRank, encodedHold] = customId.slice(ASSIGNMENT_MODAL_PREFIX.length).split(":");
  if ((minimumRank !== "Apprentice" && minimumRank !== "Ranger") || encodedHold === undefined) {
    return null;
  }
  const hold = decodeURIComponent(encodedHold);
  return { minimumRank, hold: hold === "none" ? null : hold };
}

function parseAssignmentButtonId(customId: string): {
  action: "join" | "withdraw" | "complete";
  assignmentId: string;
} | null {
  const [prefix, action, assignmentId] = customId.split(":");
  if (prefix !== "assignment" || (action !== "join" && action !== "withdraw" && action !== "complete") || !assignmentId) {
    return null;
  }
  return { action, assignmentId };
}

function optionalModalValue(interaction: ModalSubmitInteraction, customId: string): string | null {
  const value = interaction.fields.getTextInputValue(customId).trim();
  return value || null;
}

function normalizeLine(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (!normalized) {
    throw new UserFacingError("Required assignment fields cannot be blank.");
  }
  return normalized.slice(0, maxLength);
}

function normalizeBlock(value: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new UserFacingError("Required assignment fields cannot be blank.");
  }
  return normalized.slice(0, maxLength);
}

function nullableLine(value: string | null, maxLength: number): string | null {
  return value ? normalizeLine(value, maxLength) : null;
}

function nullableBlock(value: string | null, maxLength: number): string | null {
  return value ? normalizeBlock(value, maxLength) : null;
}
