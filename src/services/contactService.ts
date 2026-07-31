import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ForumChannel,
  type ButtonInteraction,
  type Guild,
  type GuildMember,
  type ThreadChannel
} from "discord.js";
import { HOLDS } from "../config/holds.js";
import { roleIdForRank } from "../config/roles.js";
import {
  assertNoDbError,
  supabase,
  type ContactAssessment,
  type ContactAssessmentRow,
  type RangerContactRow
} from "../db/supabase.js";
import { getBotMessageState, saveBotMessageState } from "./botMessageStateService.js";
import { emojiEmbed } from "../utils/guildEmojis.js";
import { UserFacingError } from "../utils/errors.js";
import { memberRankAtLeast } from "../utils/permissions.js";

const CONTACT_FORUM_STATE_KEY = "ranger-contacts-forum";
const CONTACT_FORUM_NAME = "contacts";

export const CONTACT_HOLD_CHOICES = [...HOLDS, "Cross-Skyrim", "Other"] as const;
export const CONTACT_OCCUPATIONS = [
  "Alchemist",
  "Blacksmith",
  "Merchant",
  "Healer",
  "Scholar",
  "Noble",
  "Other Occupation"
] as const;

const CONTACT_TAG_NAMES = [
  ...HOLDS,
  "Cross-Skyrim",
  "Other Region",
  ...CONTACT_OCCUPATIONS,
  "High Priority"
] as const;

const ASSESSMENT_LABELS: Record<ContactAssessment, string> = {
  good: "Confirmed",
  cold: "Cold",
  not_found: "Not found",
  mia: "MIA",
  archive: "Archive proposed"
};

export interface ContactAssessmentSummary {
  counts: Record<ContactAssessment, number>;
  status: string;
  lastVerifiedAt: string | null;
}

export interface ContactDetails {
  contact: RangerContactRow;
  assessments: ContactAssessmentRow[];
  summary: ContactAssessmentSummary;
}

export async function getContactsForum(guild: Guild): Promise<ForumChannel | null> {
  const state = await getBotMessageState(CONTACT_FORUM_STATE_KEY);
  if (state) {
    const stored = await guild.channels.fetch(state.discord_channel_id).catch(() => null);
    if (stored?.type === ChannelType.GuildForum) {
      return stored;
    }
  }

  return guild.channels.cache.find((channel) =>
    channel.type === ChannelType.GuildForum && channel.name === CONTACT_FORUM_NAME
  ) as ForumChannel | undefined ?? null;
}

export async function setupContactsForum(guild: Guild, categoryId?: string | null): Promise<ForumChannel> {
  const existing = await getContactsForum(guild);
  const forum = existing ?? await guild.channels.create({
    name: CONTACT_FORUM_NAME,
    type: ChannelType.GuildForum,
    ...(categoryId ? { parent: categoryId } : {}),
    topic: "A living record of people known to the Ranger Corps. Each post is maintained by Wayfinder."
  });

  await forum.setAvailableTags(CONTACT_TAG_NAMES.map((name) => ({ name })), "Set Ranger contact filters");
  await applyContactForumPermissions(forum);
  await saveBotMessageState(CONTACT_FORUM_STATE_KEY, forum.id, []);
  return forum;
}

export async function createContact(params: {
  guild: Guild;
  creator: GuildMember;
  name: string;
  race: string;
  sex: string;
  occupation: string;
  faction?: string | null;
  hold: string;
  usualLocations?: string | null;
  commentary?: string | null;
  highPriority: boolean;
}): Promise<{ contact: RangerContactRow; thread: ThreadChannel }> {
  requireRanger(params.creator);
  const forum = await getContactsForum(params.guild);
  if (!forum) {
    throw new UserFacingError("The Contacts Forum has not been set up. Ask a Marshal to run `/contact setup` first.");
  }

  const input = normalizeContactInput(params);
  const { data: inserted, error } = await supabase
    .from("ranger_contacts")
    .insert({
      name: input.name,
      race: input.race,
      sex: input.sex,
      occupation: input.occupation,
      faction: input.faction,
      hold: input.hold,
      usual_locations: input.usualLocations,
      commentary: input.commentary,
      high_priority: input.highPriority,
      active: true,
      created_by_discord_user_id: params.creator.id,
      forum_channel_id: forum.id,
      forum_thread_id: null,
      forum_message_id: null
    })
    .select("*")
    .single();
  assertNoDbError(error, "create Ranger contact");
  if (!inserted) {
    throw new Error("Supabase did not return the created Ranger contact.");
  }

  try {
    const thread = await forum.threads.create({
      name: contactThreadName(inserted),
      message: await contactMessagePayload(params.guild, inserted.id),
      appliedTags: contactTagIds(forum, inserted)
    });
    const starter = await thread.fetchStarterMessage();
    const { data: attached, error: attachError } = await supabase
      .from("ranger_contacts")
      .update({
        forum_thread_id: thread.id,
        forum_message_id: starter?.id ?? null
      })
      .eq("id", inserted.id)
      .select("*")
      .single();
    assertNoDbError(attachError, "attach Ranger contact Forum post");
    if (!attached) {
      throw new Error("Supabase did not return the attached Ranger contact.");
    }
    return { contact: attached, thread };
  } catch (error) {
    await supabase.from("ranger_contacts").delete().eq("id", inserted.id);
    throw error;
  }
}

export async function editContact(params: {
  guild: Guild;
  editor: GuildMember;
  contactId: string;
  name?: string;
  race?: string;
  sex?: string;
  occupation?: string;
  faction?: string | null;
  hold?: string;
  usualLocations?: string | null;
  commentary?: string | null;
  highPriority?: boolean;
}): Promise<ContactDetails> {
  requireRanger(params.editor);
  const current = await getContactDetails(params.contactId);
  if (!current || !current.contact.active) {
    throw new UserFacingError("That contact is not active.");
  }

  const changes = normalizeContactChanges(params);
  if (Object.keys(changes).length === 0) {
    throw new UserFacingError("Provide at least one contact field to change.");
  }

  const { error } = await supabase.from("ranger_contacts").update(changes).eq("id", params.contactId);
  assertNoDbError(error, "edit Ranger contact");
  const updated = await getContactDetails(params.contactId);
  if (!updated) {
    throw new Error("The edited Ranger contact could not be loaded.");
  }
  await refreshContactForumPost(params.guild, updated.contact.id);
  return updated;
}

export async function archiveContact(params: {
  guild: Guild;
  contactId: string;
  archivedByDiscordUserId: string;
  reason: string;
}): Promise<void> {
  const contact = await getContactDetails(params.contactId);
  if (!contact || !contact.contact.active) {
    throw new UserFacingError("That contact is already archived or does not exist.");
  }

  const { error } = await supabase
    .from("ranger_contacts")
    .update({
      active: false,
      archived_by_discord_user_id: params.archivedByDiscordUserId,
      archived_at: new Date().toISOString(),
      archive_reason: params.reason.trim() || "Archived by a Marshal."
    })
    .eq("id", params.contactId);
  assertNoDbError(error, "archive Ranger contact");
  await refreshContactForumPost(params.guild, params.contactId);

  const thread = await fetchContactThread(params.guild, contact.contact);
  if (thread) {
    await thread.setArchived(true, "Archive Ranger contact").catch(() => undefined);
    await thread.setLocked(true, "Lock archived Ranger contact").catch(() => undefined);
  }
}

export async function recordContactAssessment(params: {
  guild: Guild;
  contactId: string;
  voter: GuildMember;
  assessment: ContactAssessment;
  note?: string | null;
}): Promise<ContactDetails> {
  requireRanger(params.voter);
  const current = await getContactDetails(params.contactId);
  if (!current || !current.contact.active) {
    throw new UserFacingError("That contact is no longer active.");
  }

  const note = params.note?.trim() || null;
  if (note && note.length > 1000) {
    throw new UserFacingError("Assessment notes must be 1,000 characters or fewer.");
  }

  const { error } = await supabase.from("contact_assessments").upsert({
    contact_id: params.contactId,
    voter_discord_user_id: params.voter.id,
    assessment: params.assessment,
    note
  }, { onConflict: "contact_id,voter_discord_user_id" });
  assertNoDbError(error, "record contact assessment");
  await refreshContactForumPost(params.guild, params.contactId);
  const updated = await getContactDetails(params.contactId);
  if (!updated) {
    throw new Error("The updated Ranger contact could not be loaded.");
  }
  return updated;
}

export async function listContacts(params: {
  hold?: string | null;
  occupation?: string | null;
  highPriority?: boolean | null;
} = {}): Promise<ContactDetails[]> {
  let query = supabase
    .from("ranger_contacts")
    .select("*")
    .eq("active", true)
    .order("high_priority", { ascending: false })
    .order("name", { ascending: true });
  if (params.hold) {
    query = query.eq("hold", params.hold);
  }
  if (params.occupation) {
    query = query.eq("occupation", params.occupation);
  }
  if (params.highPriority !== null && params.highPriority !== undefined) {
    query = query.eq("high_priority", params.highPriority);
  }

  const { data, error } = await query;
  assertNoDbError(error, "list Ranger contacts");
  const contacts = data ?? [];
  return Promise.all(contacts.map((contact) => getContactDetailsFromRow(contact)));
}

export async function getContactDetails(contactId: string): Promise<ContactDetails | null> {
  const { data, error } = await supabase
    .from("ranger_contacts")
    .select("*")
    .eq("id", contactId)
    .maybeSingle();
  assertNoDbError(error, "get Ranger contact");
  return data ? getContactDetailsFromRow(data) : null;
}

export async function refreshContactForumPost(guild: Guild, contactId: string): Promise<void> {
  const details = await getContactDetails(contactId);
  if (!details) {
    return;
  }
  const thread = await fetchContactThread(guild, details.contact);
  const starter = thread ? await thread.fetchStarterMessage().catch(() => null) : null;
  if (!thread || !starter) {
    console.warn(`Could not refresh contact Forum post for ${contactId}: thread or starter message is missing.`);
    return;
  }

  await starter.edit(await contactMessagePayload(guild, contactId));
  const forum = thread.parent?.type === ChannelType.GuildForum ? thread.parent : null;
  if (forum) {
    await thread.setAppliedTags(contactTagIds(forum, details.contact), "Refresh Ranger contact tags");
  }
}

export async function refreshActiveContactForumPosts(guild: Guild): Promise<number> {
  const contacts = await listContacts();
  let refreshed = 0;

  for (const { contact } of contacts) {
    await refreshContactForumPost(guild, contact.id);
    refreshed += 1;
  }

  return refreshed;
}

export async function handleContactButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) {
    throw new UserFacingError("Contact assessments are only available in the Ranger Corps server.");
  }
  const [, action, contactId, assessment] = interaction.customId.split(":");
  if (action !== "assess" || !contactId || !isContactAssessment(assessment)) {
    throw new UserFacingError("That contact control is invalid.");
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!memberRankAtLeast(member, "Ranger")) {
    await interaction.reply({
      content: "Ranger or higher is required for contact records.",
      ephemeral: true
    });
    return;
  }

  await interaction.deferUpdate();
  try {
    await recordContactAssessment({
      guild: interaction.guild,
      contactId,
      voter: member,
      assessment
    });
    await interaction.followUp({
      content: `Your assessment is recorded as **${ASSESSMENT_LABELS[assessment]}**. You can change it later.`,
      ephemeral: true
    });
  } catch (error) {
    console.error(`Failed to record contact assessment for ${contactId}:`, error);
    await interaction.followUp({
      content: error instanceof UserFacingError
        ? error.message
        : "Something went wrong while recording that assessment. The contact record was left unchanged.",
      ephemeral: true
    });
  }
}

export function summarizeContactAssessments(assessments: ReadonlyArray<Pick<ContactAssessmentRow, "assessment" | "updated_at">>): ContactAssessmentSummary {
  const counts: Record<ContactAssessment, number> = {
    good: 0,
    cold: 0,
    not_found: 0,
    mia: 0,
    archive: 0
  };
  let lastVerifiedAt: string | null = null;
  for (const assessment of assessments) {
    counts[assessment.assessment] += 1;
    if (assessment.assessment === "good" && (!lastVerifiedAt || assessment.updated_at > lastVerifiedAt)) {
      lastVerifiedAt = assessment.updated_at;
    }
  }

  const ranked = (Object.keys(counts) as ContactAssessment[])
    .filter((assessment) => assessment !== "archive")
    .sort((a, b) => counts[b] - counts[a]);
  const top = ranked[0];
  const tied = top && ranked.filter((assessment) => counts[assessment] === counts[top] && counts[top] > 0).length > 1;
  const status = counts.archive > 0
    ? ASSESSMENT_LABELS.archive
    : !top || counts[top] === 0
      ? "Unverified"
      : tied
        ? "Mixed reports"
        : ASSESSMENT_LABELS[top];

  return { counts, status, lastVerifiedAt };
}

export function contactTagNames(contact: Pick<RangerContactRow, "hold" | "occupation" | "high_priority">): string[] {
  const tags: string[] = [];
  if (HOLDS.includes(contact.hold as (typeof HOLDS)[number])) {
    tags.push(contact.hold);
  } else if (contact.hold === "Cross-Skyrim") {
    tags.push("Cross-Skyrim");
  } else {
    tags.push("Other Region");
  }

  const occupation = CONTACT_OCCUPATIONS.includes(contact.occupation as (typeof CONTACT_OCCUPATIONS)[number])
    ? contact.occupation
    : "Other Occupation";
  tags.push(occupation);
  if (contact.high_priority) {
    tags.push("High Priority");
  }
  return tags;
}

interface ContactMessagePayload {
  content: string;
  embeds: ReturnType<typeof emojiEmbed>[];
  components: ActionRowBuilder<ButtonBuilder>[];
}

async function contactMessagePayload(guild: Guild, contactId: string): Promise<ContactMessagePayload> {
  const details = await getContactDetails(contactId);
  if (!details) {
    throw new Error("The Ranger contact could not be loaded for its Forum post.");
  }
  const { contact, summary } = details;
  const rating = ratingText(summary);
  const embed = emojiEmbed(guild, "wayfinder", `Contact - ${contact.name}`)
    .setColor(contact.high_priority ? 0xa64d3f : 0x587c4a)
    .setDescription(`${contact.high_priority ? "**High-priority contact.**\n" : ""}**Current rating:** ${summary.status}\n${rating}`)
    .addFields(
      { name: "Name", value: contact.name, inline: true },
      { name: "Race", value: contact.race, inline: true },
      { name: "Sex", value: contact.sex, inline: true },
      { name: "Occupation", value: contact.occupation, inline: true },
      { name: "Faction", value: contact.faction ?? "Unknown", inline: true },
      { name: "Hold / Region", value: contact.hold, inline: true },
      { name: "Usual locations", value: contact.usual_locations ?? "Unknown", inline: false },
      { name: "Commentary", value: contact.commentary ?? "None recorded.", inline: false },
      { name: "Last verified", value: summary.lastVerifiedAt ? formatDiscordTime(summary.lastVerifiedAt) : "No Ranger has confirmed this contact yet.", inline: false },
      { name: "Originally recorded by", value: `<@${contact.created_by_discord_user_id}>`, inline: true }
    )
    .setFooter({ text: contact.active ? "Use the buttons to record your current knowledge. Discuss details in this post's thread." : `Archived: ${contact.archive_reason ?? "No reason recorded."}` });

  return {
    content: `**${contact.name}** - ${summary.status} | ${rating}`.slice(0, 2000),
    embeds: [embed],
    components: [contactAssessmentRow(contact.id, contact.active)]
  };
}

function contactAssessmentRow(contactId: string, active: boolean): ActionRowBuilder<ButtonBuilder> {
  const buttons: Array<[ContactAssessment, string, ButtonStyle]> = [
    ["good", "Still good", ButtonStyle.Success],
    ["cold", "Cold", ButtonStyle.Danger],
    ["not_found", "Not found", ButtonStyle.Secondary],
    ["mia", "MIA", ButtonStyle.Secondary],
    ["archive", "Propose archive", ButtonStyle.Danger]
  ];
  return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.map(([assessment, label, style]) =>
    new ButtonBuilder()
      .setCustomId(`contact:assess:${contactId}:${assessment}`)
      .setLabel(label)
      .setStyle(style)
      .setDisabled(!active)
  ));
}

async function getContactDetailsFromRow(contact: RangerContactRow): Promise<ContactDetails> {
  const { data, error } = await supabase
    .from("contact_assessments")
    .select("*")
    .eq("contact_id", contact.id)
    .order("updated_at", { ascending: false });
  assertNoDbError(error, "list contact assessments");
  return {
    contact,
    assessments: data ?? [],
    summary: summarizeContactAssessments(data ?? [])
  };
}

async function fetchContactThread(guild: Guild, contact: RangerContactRow): Promise<ThreadChannel | null> {
  if (!contact.forum_thread_id) {
    return null;
  }
  const channel = await guild.channels.fetch(contact.forum_thread_id).catch(() => null);
  return channel?.isThread() ? channel : null;
}

function contactTagIds(forum: ForumChannel, contact: RangerContactRow): string[] {
  const tagNames = contactTagNames(contact);
  return forum.availableTags
    .filter((tag) => tagNames.includes(tag.name))
    .map((tag) => tag.id)
    .slice(0, 5);
}

async function applyContactForumPermissions(forum: ForumChannel): Promise<void> {
  await forum.permissionOverwrites.edit(forum.guild.roles.everyone, {
    ViewChannel: false,
    ReadMessageHistory: false,
    SendMessages: false,
    SendMessagesInThreads: false
  }, { reason: "Restrict Ranger contact records" });

  const rankRoleNames = ["Ranger", "Ranger Marshal", "Ranger Captain", "Ranger Commander"] as const;
  for (const rank of rankRoleNames) {
    const roleId = roleIdForRank(rank);
    await forum.permissionOverwrites.edit(roleId, {
      ViewChannel: true,
      ReadMessageHistory: true,
      AddReactions: true,
      SendMessages: false,
      SendMessagesInThreads: true
    }, { reason: `Allow ${rank} access to Ranger contacts` });
  }

  const botId = forum.guild.members.me?.id ?? forum.guild.client.user?.id;
  if (botId) {
    await forum.permissionOverwrites.edit(botId, {
      ViewChannel: true,
      ReadMessageHistory: true,
      SendMessages: true,
      SendMessagesInThreads: true,
      ManageMessages: true,
      ManageThreads: true,
      EmbedLinks: true
    }, { reason: "Allow Wayfinder to maintain Ranger contacts" });
  }
}

function normalizeContactInput(params: {
  name: string;
  race: string;
  sex: string;
  occupation: string;
  faction?: string | null;
  hold: string;
  usualLocations?: string | null;
  commentary?: string | null;
  highPriority: boolean;
}): {
  name: string;
  race: string;
  sex: string;
  occupation: string;
  faction: string | null;
  hold: string;
  usualLocations: string | null;
  commentary: string | null;
  highPriority: boolean;
} {
  const name = requiredText(params.name, "Name", 100);
  const race = requiredText(params.race, "Race", 100);
  const sex = requiredText(params.sex, "Sex", 100);
  const occupation = requiredText(params.occupation, "Occupation", 100);
  const hold = requiredText(params.hold, "Hold or region", 100);
  if (!CONTACT_HOLD_CHOICES.includes(hold as (typeof CONTACT_HOLD_CHOICES)[number])) {
    throw new UserFacingError("Choose a valid Hold or region.");
  }
  return {
    name,
    race,
    sex,
    occupation,
    faction: optionalText(params.faction, 150),
    hold,
    usualLocations: optionalText(params.usualLocations, 500),
    commentary: optionalText(params.commentary, 1500),
    highPriority: params.highPriority
  };
}

function normalizeContactChanges(params: {
  name?: string;
  race?: string;
  sex?: string;
  occupation?: string;
  faction?: string | null;
  hold?: string;
  usualLocations?: string | null;
  commentary?: string | null;
  highPriority?: boolean;
}): Partial<RangerContactRow> {
  const changes: Partial<RangerContactRow> = {};
  if (params.name !== undefined) changes.name = requiredText(params.name, "Name", 100);
  if (params.race !== undefined) changes.race = requiredText(params.race, "Race", 100);
  if (params.sex !== undefined) changes.sex = requiredText(params.sex, "Sex", 100);
  if (params.occupation !== undefined) changes.occupation = requiredText(params.occupation, "Occupation", 100);
  if (params.faction !== undefined) changes.faction = optionalText(params.faction, 150);
  if (params.hold !== undefined) {
    changes.hold = requiredText(params.hold, "Hold or region", 100);
    if (!CONTACT_HOLD_CHOICES.includes(changes.hold as (typeof CONTACT_HOLD_CHOICES)[number])) {
      throw new UserFacingError("Choose a valid Hold or region.");
    }
  }
  if (params.usualLocations !== undefined) changes.usual_locations = optionalText(params.usualLocations, 500);
  if (params.commentary !== undefined) changes.commentary = optionalText(params.commentary, 1500);
  if (params.highPriority !== undefined) changes.high_priority = params.highPriority;
  return changes;
}

function requireRanger(member: GuildMember): void {
  if (!memberRankAtLeast(member, "Ranger")) {
    throw new UserFacingError("Ranger or higher is required for contact records.");
  }
}

function requiredText(value: string, label: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new UserFacingError(`${label} is required.`);
  }
  if (normalized.length > maxLength) {
    throw new UserFacingError(`${label} must be ${maxLength} characters or fewer.`);
  }
  return normalized;
}

function optionalText(value: string | null | undefined, maxLength: number): string | null {
  const normalized = value?.trim() ?? "";
  if (normalized.length > maxLength) {
    throw new UserFacingError(`This field must be ${maxLength} characters or fewer.`);
  }
  return normalized || null;
}

function isContactAssessment(value: string | undefined): value is ContactAssessment {
  return value === "good" || value === "cold" || value === "not_found" || value === "mia" || value === "archive";
}

function ratingText(summary: ContactAssessmentSummary): string {
  return `✅ ${summary.counts.good} · ❌ ${summary.counts.cold} · ❔ ${summary.counts.not_found} · 💀 ${summary.counts.mia} · 🗑️ ${summary.counts.archive}`;
}

function contactThreadName(contact: Pick<RangerContactRow, "name">): string {
  return `Contact - ${contact.name}`.slice(0, 100);
}

function formatDiscordTime(value: string | null): string {
  return value ? `<t:${Math.floor(new Date(value).getTime() / 1000)}:R>` : "Never";
}
