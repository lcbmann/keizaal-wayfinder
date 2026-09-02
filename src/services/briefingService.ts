import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type ModalSubmitInteraction,
  type TextChannel
} from "discord.js";
import { rankAtLeast, type MainRank } from "../config/ranks.js";
import {
  assertNoDbError,
  supabase,
  type BriefingAudience,
  type BriefingDispatchRow,
  type BriefingKind,
  type BriefingUserSettingsRow
} from "../db/supabase.js";
import { UserFacingError } from "../utils/errors.js";
import { emojiEmbed } from "../utils/guildEmojis.js";
import { mainRankFromMember, memberRankAtLeast } from "../utils/permissions.js";
import {
  deleteStoredMessages,
  getBotMessageState,
  getStoredTextChannel,
  saveBotMessageState
} from "./botMessageStateService.js";

const BRIEFING_DESK_STATE_KEY = "ranger-briefing-desk";
export const BRIEFING_COLLECT_BUTTON_ID = "briefing:collect";
export const BRIEFING_DISPATCH_MODAL_PREFIX = "briefing:dispatch-submit:";
const DISPATCHES_PER_EMBED = 1;

type BriefingInteraction = ChatInputCommandInteraction<"cached"> | ButtonInteraction<"cached">;

export interface QueueBriefingDispatchInput {
  guildId: string;
  kind?: BriefingKind;
  audience: BriefingAudience;
  targetDiscordUserId?: string | null;
  title: string;
  body: string;
  sourceKind?: string | null;
  sourceId?: string | null;
  sourceUrl?: string | null;
  authorDiscordUserId?: string | null;
}

export async function getBriefingDeskChannel(guild: Guild): Promise<TextChannel | null> {
  return getStoredTextChannel(guild, BRIEFING_DESK_STATE_KEY);
}

export async function refreshBriefingDesk(guild: Guild): Promise<boolean> {
  const channel = await getBriefingDeskChannel(guild);
  if (!channel) {
    return false;
  }
  await setupBriefingDesk(guild, channel);
  return true;
}

export async function setupBriefingDesk(guild: Guild, channel: TextChannel): Promise<void> {
  const state = await getBotMessageState(BRIEFING_DESK_STATE_KEY);
  let message = state?.discord_channel_id === channel.id && state.discord_message_ids[0]
    ? await channel.messages.fetch(state.discord_message_ids[0]).catch(() => null)
    : null;

  if (!message && state) {
    await deleteStoredMessages(guild, BRIEFING_DESK_STATE_KEY);
  }

  const payload = {
    embeds: [briefingDeskEmbed(guild)],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(BRIEFING_COLLECT_BUTTON_ID)
        .setLabel("Check My Briefing")
        .setStyle(ButtonStyle.Primary)
    )]
  };
  message = message ? await message.edit(payload) : await channel.send(payload);
  if (!message.pinned) {
    await message.pin("Keep the Headquarters Dispatch Desk available").catch((error) => {
      console.warn(`Could not pin the Headquarters Dispatch Desk message ${message?.id}:`, error);
    });
  }
  await saveBotMessageState(BRIEFING_DESK_STATE_KEY, channel.id, [message.id]);
}

function briefingDeskEmbed(guild: Guild): EmbedBuilder {
  return emojiEmbed(guild, "wayfinder", "Ranger Dispatch Desk")
    .setDescription([
      "Orders, reports, and messages for members of the Corps are kept at this desk.",
      "",
      "Check the desk when you return to Headquarters. Wayfinder will gather anything added since your last visit."
    ].join("\n"))
    .setColor(0x587c4a);
}

export function createBriefingDispatchModal(params: {
  kind: BriefingKind;
  audience: BriefingAudience;
  targetDiscordUserId?: string | null;
}): ModalBuilder {
  const target = params.targetDiscordUserId ?? "none";
  return new ModalBuilder()
    .setCustomId(`${BRIEFING_DISPATCH_MODAL_PREFIX}${params.kind}:${params.audience}:${target}`)
    .setTitle(params.kind === "ic" ? "Write a Corps Dispatch" : "Write an OOC Note")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("title")
          .setLabel(params.kind === "ic" ? "Dispatch heading" : "Note heading")
          .setStyle(TextInputStyle.Short)
          .setMaxLength(150)
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("body")
          .setLabel(params.kind === "ic" ? "Dispatch text" : "OOC note")
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(3000)
          .setRequired(true)
      )
    );
}

export function isBriefingDispatchModal(customId: string): boolean {
  return customId.startsWith(BRIEFING_DISPATCH_MODAL_PREFIX);
}

export async function handleBriefingDispatchModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) {
    throw new UserFacingError("Briefing dispatches are only available in the Ranger Corps server.");
  }
  const actor = await interaction.guild.members.fetch(interaction.user.id);
  if (!memberRankAtLeast(actor, "Ranger Marshal")) {
    throw new UserFacingError("Ranger Marshal or higher is required to file briefing dispatches.");
  }

  const parsed = parseDispatchModalId(interaction.customId);
  if (!parsed) {
    throw new UserFacingError("That briefing form is no longer valid. Please open it again.");
  }
  await interaction.deferReply({ ephemeral: true });
  const dispatch = await queueBriefingDispatch({
    guildId: interaction.guild.id,
    kind: parsed.kind,
    audience: parsed.audience,
    targetDiscordUserId: parsed.targetDiscordUserId,
    title: interaction.fields.getTextInputValue("title"),
    body: interaction.fields.getTextInputValue("body"),
    authorDiscordUserId: actor.id
  });
  await interaction.editReply({
    content: `Added **${dispatch.title}** to the next briefing for ${briefingAudienceLabel(dispatch.audience, dispatch.target_discord_user_id)}.`
  });
}

export async function queueBriefingDispatch(input: QueueBriefingDispatchInput): Promise<BriefingDispatchRow> {
  const title = input.title.replace(/\s+/gu, " ").trim().slice(0, 150);
  const body = input.body.trim().slice(0, 3000);
  if (!title || !body) {
    throw new Error("Briefing dispatches require both a title and body.");
  }
  if (input.audience === "individual" && !input.targetDiscordUserId) {
    throw new Error("Individual briefing dispatches require a target Discord user.");
  }

  const record = {
    guild_id: input.guildId,
    kind: input.kind ?? "ic",
    audience: input.audience,
    target_discord_user_id: input.audience === "individual" ? input.targetDiscordUserId ?? null : null,
    title,
    body,
    source_kind: input.sourceKind ?? null,
    source_id: input.sourceId ?? null,
    source_url: input.sourceUrl ?? null,
    author_discord_user_id: input.authorDiscordUserId ?? null,
    created_at: new Date().toISOString()
  };

  const query = input.sourceKind && input.sourceId
    ? supabase.from("briefing_dispatches").upsert(record, {
        onConflict: "guild_id,source_kind,source_id"
      })
    : supabase.from("briefing_dispatches").insert(record);
  const { data, error } = await query.select("*").single();
  assertNoDbError(error, "file briefing dispatch");
  if (!data) {
    throw new Error("Supabase did not return the filed briefing dispatch.");
  }
  return data;
}

export async function setBriefingDmEnabled(guildId: string, discordUserId: string, enabled: boolean): Promise<void> {
  const existing = await getBriefingUserSettings(guildId, discordUserId);
  const { error } = await supabase.from("briefing_user_settings").upsert({
    guild_id: guildId,
    discord_user_id: discordUserId,
    dm_enabled: enabled,
    last_collected_at: existing?.last_collected_at ?? null,
    updated_at: new Date().toISOString()
  });
  assertNoDbError(error, "update briefing delivery settings");
}

export async function collectRangerBriefing(interaction: BriefingInteraction): Promise<void> {
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const rank = mainRankFromMember(member);
  if (!rank) {
    throw new UserFacingError("An Apprentice or Ranger Corps rank is required to collect a briefing.");
  }
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true });
  }

  const settings = await getBriefingUserSettings(interaction.guild.id, member.id);
  const collectedThrough = new Date().toISOString();
  let query = supabase
    .from("briefing_dispatches")
    .select("*")
    .eq("guild_id", interaction.guild.id)
    .lte("created_at", collectedThrough)
    .order("created_at", { ascending: true });
  if (settings?.last_collected_at) {
    query = query.gt("created_at", settings.last_collected_at);
  }
  const { data, error } = await query;
  assertNoDbError(error, "collect Ranger briefing dispatches");
  const eligibleDispatches = (data ?? []).filter((dispatch) => briefingAudienceIncludes(
    dispatch.audience,
    dispatch.target_discord_user_id,
    rank,
    member.id
  ));
  const dispatches = await suppressResolvedDispatches(eligibleDispatches);
  const embeds = buildBriefingEmbeds(interaction.guild, member, dispatches, settings?.last_collected_at ?? null);

  let deliveredByDm = false;
  if (settings?.dm_enabled !== false) {
    try {
      for (const embed of embeds) {
        await member.send({ embeds: [embed] });
      }
      deliveredByDm = true;
      await interaction.editReply({
        content: dispatches.length
          ? `Your briefing with ${dispatches.length} new dispatch${dispatches.length === 1 ? "" : "es"} has been sent by DM.`
          : "Your briefing has been sent by DM. There were no new dispatches."
      });
    } catch (error) {
      console.warn(`Could not DM Ranger briefing to ${member.id}; using the private interaction response:`, error);
    }
  }

  if (!deliveredByDm) {
    const firstEmbed = embeds[0];
    if (!firstEmbed) {
      throw new Error("The Ranger briefing did not produce any messages.");
    }
    await interaction.editReply({ embeds: [firstEmbed], content: "" });
    for (const embed of embeds.slice(1)) {
      await interaction.followUp({ embeds: [embed], ephemeral: true });
    }
  }

  await markBriefingCollected(interaction.guild.id, member.id, settings?.dm_enabled !== false, collectedThrough);
}

export async function handleBriefingCollectButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) {
    throw new UserFacingError("Briefings are only available in the Ranger Corps server.");
  }
  await collectRangerBriefing(interaction);
}

export function briefingAudienceIncludes(
  audience: BriefingAudience,
  targetDiscordUserId: string | null,
  rank: MainRank,
  discordUserId: string
): boolean {
  if (audience === "individual") {
    return targetDiscordUserId === discordUserId;
  }
  const minimum: Record<Exclude<BriefingAudience, "individual">, MainRank> = {
    everyone: "Apprentice",
    apprentice_plus: "Apprentice",
    ranger_plus: "Ranger",
    marshal_plus: "Ranger Marshal",
    captain_plus: "Ranger Captain"
  };
  return rankAtLeast(rank, minimum[audience]);
}

function parseDispatchModalId(customId: string): {
  kind: BriefingKind;
  audience: BriefingAudience;
  targetDiscordUserId: string | null;
} | null {
  const [kind, audience, target] = customId.slice(BRIEFING_DISPATCH_MODAL_PREFIX.length).split(":");
  if ((kind !== "ic" && kind !== "ooc") || !audience || !isBriefingAudience(audience)) {
    return null;
  }
  const targetDiscordUserId = target && target !== "none" ? target : null;
  if ((audience === "individual") !== Boolean(targetDiscordUserId)) {
    return null;
  }
  return { kind, audience, targetDiscordUserId };
}

function isBriefingAudience(value: string): value is BriefingAudience {
  return ["everyone", "apprentice_plus", "ranger_plus", "marshal_plus", "captain_plus", "individual"].includes(value);
}

function briefingAudienceLabel(audience: BriefingAudience, targetDiscordUserId: string | null): string {
  switch (audience) {
    case "everyone":
    case "apprentice_plus":
      return "all Corps members";
    case "ranger_plus":
      return "Ranger or higher";
    case "marshal_plus":
      return "Ranger Marshal or higher";
    case "captain_plus":
      return "Ranger Captain or higher";
    case "individual":
      return targetDiscordUserId ? `<@${targetDiscordUserId}>` : "one Corps member";
  }
}

async function getBriefingUserSettings(guildId: string, discordUserId: string): Promise<BriefingUserSettingsRow | null> {
  const { data, error } = await supabase
    .from("briefing_user_settings")
    .select("*")
    .eq("guild_id", guildId)
    .eq("discord_user_id", discordUserId)
    .maybeSingle();
  assertNoDbError(error, "get briefing delivery settings");
  return data;
}

async function markBriefingCollected(
  guildId: string,
  discordUserId: string,
  dmEnabled: boolean,
  collectedThrough: string
): Promise<void> {
  const { error } = await supabase.from("briefing_user_settings").upsert({
    guild_id: guildId,
    discord_user_id: discordUserId,
    dm_enabled: dmEnabled,
    last_collected_at: collectedThrough,
    updated_at: new Date().toISOString()
  });
  assertNoDbError(error, "mark Ranger briefing collected");
}

async function suppressResolvedDispatches(dispatches: BriefingDispatchRow[]): Promise<BriefingDispatchRow[]> {
  const promotionIds = sourceIds(dispatches, "promotion-vote");
  const assignmentIds = sourceIds(dispatches, "managed-assignment");
  const contactIds = sourceIds(dispatches, "contact-record");
  const [openPromotions, openAssignments, activeContacts] = await Promise.all([
    currentSourceIds("promotion_votes", promotionIds, "status", "Open"),
    currentSourceIds("managed_assignments", assignmentIds, "status", "Open"),
    currentSourceIds("ranger_contacts", contactIds, "active", true)
  ]);
  return dispatches.filter((dispatch) => {
    if (!dispatch.source_id) {
      return true;
    }
    if (dispatch.source_kind === "promotion-vote") {
      return openPromotions.has(dispatch.source_id);
    }
    if (dispatch.source_kind === "managed-assignment") {
      return openAssignments.has(dispatch.source_id);
    }
    if (dispatch.source_kind === "contact-record") {
      return activeContacts.has(dispatch.source_id);
    }
    return true;
  });
}

function sourceIds(dispatches: BriefingDispatchRow[], sourceKind: string): string[] {
  return dispatches
    .filter((dispatch) => dispatch.source_kind === sourceKind && dispatch.source_id)
    .map((dispatch) => dispatch.source_id as string);
}

async function currentSourceIds(
  table: "promotion_votes" | "managed_assignments" | "ranger_contacts",
  ids: string[],
  field: "status" | "active",
  value: string | boolean
): Promise<Set<string>> {
  if (ids.length === 0) {
    return new Set();
  }
  const { data, error } = await supabase.from(table).select("id").in("id", ids).eq(field, value);
  assertNoDbError(error, `check current ${table} briefing sources`);
  return new Set((data ?? []).map((row) => row.id));
}

function buildBriefingEmbeds(
  guild: Guild,
  member: GuildMember,
  dispatches: BriefingDispatchRow[],
  lastCollectedAt: string | null
): EmbedBuilder[] {
  if (dispatches.length === 0) {
    return [emojiEmbed(guild, "wayfinder", `Ranger Briefing: ${member.displayName}`)
      .setDescription([
        "**RANGER CORPS HEADQUARTERS**",
        `Checked <t:${Math.floor(Date.now() / 1000)}:f>`,
        "",
        "There are no new dispatches for you."
      ].join("\n"))
      .setColor(0x587c4a)];
  }

  const ic = dispatches.filter((dispatch) => dispatch.kind === "ic");
  const ooc = dispatches.filter((dispatch) => dispatch.kind === "ooc");
  const embeds: EmbedBuilder[] = [];
  for (const [index, group] of chunked(ic, DISPATCHES_PER_EMBED).entries()) {
    const heading = index === 0
      ? [
          "**RANGER CORPS HEADQUARTERS**",
          `Prepared for **${member.displayName}**`,
          `Checked <t:${Math.floor(Date.now() / 1000)}:f>`,
          lastCollectedAt ? `Messages since <t:${Math.floor(new Date(lastCollectedAt).getTime() / 1000)}:f>` : "First briefing from this desk",
          ""
        ].join("\n")
      : "";
    embeds.push(emojiEmbed(guild, "wayfinder", index === 0 ? `Ranger Briefing: ${member.displayName}` : "Ranger Briefing: Continued")
      .setDescription(`${heading}${formatDispatchGroup(guild, group)}`.slice(0, 4096))
      .setColor(0x587c4a));
  }
  for (const [index, group] of chunked(ooc, DISPATCHES_PER_EMBED).entries()) {
    embeds.push(new EmbedBuilder()
      .setTitle(index === 0 ? "OOC Notes" : "OOC Notes: Continued")
      .setDescription(formatDispatchGroup(guild, group).slice(0, 4096))
      .setColor(0x747f8d));
  }
  return embeds;
}

function formatDispatchGroup(guild: Guild, dispatches: BriefingDispatchRow[]): string {
  return dispatches.map((dispatch) => {
    const filedAt = Math.floor(new Date(dispatch.created_at).getTime() / 1000);
    const author = dispatch.author_discord_user_id
      ? guild.members.cache.get(dispatch.author_discord_user_id)?.displayName ?? "Corps leadership"
      : null;
    return [
      `### ${dispatch.title}`,
      truncate(dispatch.body, 3000),
      dispatch.source_url ? `[Open record](${dispatch.source_url})` : null,
      `-# Sent <t:${filedAt}:R>${author ? ` by ${author}` : ""}`
    ].filter(Boolean).join("\n");
  }).join("\n\n");
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function chunked<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}
