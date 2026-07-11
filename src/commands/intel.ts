import { ChannelType, EmbedBuilder, SlashCommandBuilder, type GuildBasedChannel, type NewsChannel, type TextChannel } from "discord.js";
import {
  backfillTrailmarkIntel,
  createIntelTopic,
  findIntelTopicsByName,
  getIntelSettings,
  getIntelTopic,
  listIntelTopics,
  refreshIntelTopicBulletin,
  setIntelCatchallTopic,
  setIntelHqTrailmark,
  updateIntelTopicKeywords
} from "../services/intelService.js";
import { findTrailmarksByName, getTrailmark } from "../services/trailmarkService.js";
import { UserFacingError } from "../utils/errors.js";
import { canCreateTrailmarks } from "../utils/permissions.js";
import { slugify } from "../utils/slugs.js";
import type { BotCommand } from "./types.js";
import { env } from "../config/env.js";
import { syncAllianceTopicMirrors } from "../services/allianceIntelService.js";


export const intelCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("intel")
    .setDescription("Trailmark intelligence bulletins.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set-hq")
        .setDescription("Set the Trailmark used as the HQ delivery point.")
        .addStringOption((option) =>
          option.setName("trailmark").setDescription("HQ Trailmark.").setRequired(true).setAutocomplete(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("topic-add")
        .setDescription("Create an intel topic and report bulletin.")
        .addStringOption((option) => option.setName("name").setDescription("Topic name.").setRequired(true).setMaxLength(80))
        .addStringOption((option) =>
          option
            .setName("keywords")
            .setDescription("Comma-separated keywords, such as vampire,vampires.")
            .setRequired(true)
            .setMaxLength(500)
        )
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Existing report channel. If omitted, Wayfinder creates one in Intel.")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("topic-edit")
        .setDescription("Add or replace keywords for an existing intel topic.")
        .addStringOption((option) =>
          option.setName("topic").setDescription("Intel topic to update.").setRequired(true).setAutocomplete(true)
        )
        .addStringOption((option) =>
          option
            .setName("keywords")
            .setDescription("Comma-separated keywords to add or use as the replacement list.")
            .setRequired(true)
            .setMaxLength(500)
        )
        .addBooleanOption((option) =>
          option.setName("append").setDescription("Append to existing keywords. Defaults to yes.")
        )
    )
    .addSubcommand((subcommand) => subcommand.setName("topic-list").setDescription("List intel topics and HQ setup."))
    .addSubcommand((subcommand) =>
      subcommand
        .setName("catchall-set")
        .setDescription("Set or create the fallback topic for uncategorized delivered reports.")
        .addStringOption((option) =>
          option.setName("topic").setDescription("Existing intel topic to use as the catchall.").setAutocomplete(true)
        )
        .addStringOption((option) =>
          option.setName("name").setDescription("Name for a new catchall topic if topic is omitted.").setMaxLength(80)
        )
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Existing report channel for a new catchall topic. If omitted, Wayfinder creates one.")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("catchall-clear").setDescription("Disable future uncategorized intel capture.")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("refresh")
        .setDescription("Rebuild a topic bulletin from delivered reports.")
        .addStringOption((option) =>
          option.setName("topic").setDescription("Intel topic to rebuild.").setRequired(true).setAutocomplete(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("backfill")
        .setDescription("Scan old Trailmark messages into intel topics.")
        .addStringOption((option) => option.setName("topic").setDescription("Topic to backfill. Omit for all topics.").setAutocomplete(true))
        .addStringOption((option) =>
          option
            .setName("mode")
            .setDescription("How to handle historical delivery.")
            .addChoices(
              { name: "Historical delivery", value: "historical-delivery" },
              { name: "Pending only", value: "pending-only" }
            )
        )
        .addStringOption((option) => option.setName("after").setDescription("Only scan messages on or after YYYY-MM-DD."))
        .addIntegerOption((option) =>
          option
            .setName("limit_per_trailmark")
            .setDescription("Maximum messages to scan per Trailmark.")
            .setMinValue(1)
            .setMaxValue(5000)
        )
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === "trailmark") {
      const trailmarks = await findTrailmarksByName(focused.value);
      await interaction.respond(trailmarks.map((trailmark) => ({ name: `${trailmark.name} (${trailmark.hold})`, value: trailmark.id })));
      return;
    }

    if (focused.name === "topic") {
      const topics = await findIntelTopicsByName(focused.value);
      await interaction.respond(topics.map((topic) => ({ name: topic.name, value: topic.id })));
    }
  },

  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
      throw new UserFacingError("This command can only be used in the configured guild.");
    }

    const actor = await interaction.guild.members.fetch(interaction.user.id);
    if (!canCreateTrailmarks(actor)) {
      throw new UserFacingError("Ranger Marshal or higher is required to manage intel bulletins.");
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "set-hq") {
      const trailmarkId = interaction.options.getString("trailmark", true);
      const trailmark = await getTrailmark(trailmarkId);
      if (!trailmark || !trailmark.active) {
        throw new UserFacingError("Trailmark not found or inactive.");
      }

      await setIntelHqTrailmark(trailmark.id);
      await interaction.reply({ content: `Set HQ delivery Trailmark to ${trailmark.name}.`, ephemeral: true });
      return;
    }

    if (subcommand === "topic-add") {
      await interaction.deferReply({ ephemeral: true });
      const name = interaction.options.getString("name", true).trim();
      const keywords = parseKeywords(interaction.options.getString("keywords", true));
      const channel = await resolveTopicChannel(interaction, name);
      const topic = await createIntelTopic({
        name,
        keywords,
        channelId: channel.id,
        createdByDiscordUserId: interaction.user.id
      });

      await refreshIntelTopicBulletin(interaction.guild, topic.id);
      await syncAllianceTopicMirrors(interaction.client).catch((error) => {
        console.warn(`Failed to create allied headquarters channels for intel topic ${topic.id}:`, error);
      });
      await interaction.editReply({
        content: `Created intel topic ${topic.name} in ${channel} with keywords: ${keywords.join(", ")}.`,
      });
      return;
    }

    if (subcommand === "topic-edit") {
      await interaction.deferReply({ ephemeral: true });
      const topicId = interaction.options.getString("topic", true);
      const keywords = parseKeywords(interaction.options.getString("keywords", true));
      const append = interaction.options.getBoolean("append") ?? true;
      const topic = await updateIntelTopicKeywords({ topicId, keywords, append });

      await interaction.editReply({
        content: `${append ? "Added keywords to" : "Replaced keywords for"} ${topic.name}: ${topic.keywords.join(", ")}.`
      });
      return;
    }

    if (subcommand === "topic-list") {
      const settings = await getIntelSettings();
      const hqTrailmark = settings.hq_trailmark_id ? await getTrailmark(settings.hq_trailmark_id) : null;
      const catchallTopic = settings.catchall_topic_id ? await getIntelTopic(settings.catchall_topic_id) : null;
      const topics = await listIntelTopics(true);
      const embed = new EmbedBuilder()
        .setTitle("Trailmark Intel")
        .setDescription([
          `HQ delivery Trailmark: ${hqTrailmark ? hqTrailmark.name : "Not set"}`,
          `Catchall topic: ${catchallTopic ? `${catchallTopic.name} - <#${catchallTopic.discord_channel_id}>` : "Not set"}`
        ].join("\n"))
        .setColor(0x587c4a);

      embed.addFields({
        name: "Topics",
        value: topics.length
          ? topics.map((topic) => `**${topic.name}** - <#${topic.discord_channel_id}> - ${topic.keywords.join(", ")}`).join("\n")
          : "No intel topics."
      });

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (subcommand === "catchall-set") {
      await interaction.deferReply({ ephemeral: true });

      const topicId = interaction.options.getString("topic");
      const name = interaction.options.getString("name")?.trim();
      const selectedChannel = interaction.options.getChannel("channel");

      if (topicId && (name || selectedChannel)) {
        throw new UserFacingError("Choose either an existing topic or new catchall topic details, not both.");
      }

      const topic = topicId ? await getIntelTopic(topicId) : null;
      if (topicId && (!topic || !topic.active)) {
        throw new UserFacingError("Catchall topic was not found or inactive.");
      }
      if (topic && topic.keywords.length > 0) {
        throw new UserFacingError("Use a dedicated catchall topic with no keywords, or omit topic to let Wayfinder create one.");
      }

      const catchallTopic = topic ?? await createCatchallTopic(interaction, name || "Uncategorized Field Reports");
      await setIntelCatchallTopic(catchallTopic.id);

      await interaction.editReply({
        content: [
          `Set catchall intel topic to ${catchallTopic.name} in <#${catchallTopic.discord_channel_id}>.`,
          "Unmatched Trailmark messages will be posted there only after they are delivered to HQ."
        ].join("\n")
      });
      return;
    }

    if (subcommand === "catchall-clear") {
      await setIntelCatchallTopic(null);
      await interaction.reply({
        content: "Disabled future catchall intel capture. Existing catchall reports were left unchanged.",
        ephemeral: true
      });
      return;
    }

    if (subcommand === "refresh") {
      await interaction.deferReply({ ephemeral: true });
      const topicId = interaction.options.getString("topic", true);
      await refreshIntelTopicBulletin(interaction.guild, topicId);
      await interaction.editReply({ content: "Intel bulletin refreshed." });
      return;
    }

    if (subcommand === "backfill") {
      await interaction.deferReply({ ephemeral: true });
      const topicId = interaction.options.getString("topic") ?? undefined;
      const mode = (interaction.options.getString("mode") ?? "historical-delivery") as "historical-delivery" | "pending-only";
      const after = parseBackfillDate(interaction.options.getString("after"));
      const limitPerTrailmark = interaction.options.getInteger("limit_per_trailmark") ?? 500;
      const result = await backfillTrailmarkIntel({
        guild: interaction.guild,
        ...(topicId ? { topicId } : {}),
        mode,
        ...(after ? { after } : {}),
        limitPerTrailmark
      });

      await interaction.editReply({
        content: [
          "Intel backfill complete.",
          `Trailmark channels scanned: ${result.trailmarksScanned}`,
          `Legacy forum threads scanned: ${result.legacyForumThreadsScanned}`,
          `Messages scanned: ${result.messagesScanned}`,
          `Matched reports: ${result.matchedReports}`,
          `Catchall reports: ${result.catchallReports}`,
          `Historically delivered: ${result.deliveredReports}`,
          `Bulletins refreshed: ${result.topicsRefreshed}`
        ].join("\n")
      });
    }
  }
};

async function resolveTopicChannel(interaction: Parameters<BotCommand["execute"]>[0], name: string): Promise<TextChannel | NewsChannel> {
  const selectedChannel = interaction.options.getChannel("channel");
  if (selectedChannel) {
    if (!interaction.inCachedGuild()) {
      throw new UserFacingError("This command can only be used in the configured guild.");
    }

    const channel = await interaction.guild.channels.fetch(selectedChannel.id);
    if (!isIntelTopicChannel(channel)) {
      throw new UserFacingError("Intel topic channel must be a text or announcement channel.");
    }

    return channel;
  }

  if (!interaction.inCachedGuild()) {
    throw new UserFacingError("This command can only be used in the configured guild.");
  }

  return interaction.guild.channels.create({
    name: `${slugify(name)}-reports`.slice(0, 90),
    type: ChannelType.GuildText,
    ...(env.CORPS_INTEL_CATEGORY_ID ? { parent: env.CORPS_INTEL_CATEGORY_ID } : {}),
    reason: `Create Trailmark intel topic channel for ${name}`
  });
}

async function createCatchallTopic(interaction: Parameters<BotCommand["execute"]>[0], name: string) {
  if (!interaction.inCachedGuild()) {
    throw new UserFacingError("This command can only be used in the configured guild.");
  }

  const topicName = name.trim();
  if (!topicName) {
    throw new UserFacingError("Catchall topic name cannot be blank.");
  }

  const channel = await resolveTopicChannel(interaction, topicName);
  const topic = await createIntelTopic({
    name: topicName,
    keywords: [],
    channelId: channel.id,
    createdByDiscordUserId: interaction.user.id
  });

  await refreshIntelTopicBulletin(interaction.guild, topic.id);
  await syncAllianceTopicMirrors(interaction.client).catch((error) => {
    console.warn(`Failed to create allied headquarters catchall channels for ${topic.id}:`, error);
  });
  return topic;
}

function isIntelTopicChannel(channel: GuildBasedChannel | null): channel is TextChannel | NewsChannel {
  return channel?.type === ChannelType.GuildText || channel?.type === ChannelType.GuildAnnouncement;
}

function parseKeywords(value: string): string[] {
  const keywords = [...new Set(value.split(",").map((keyword) => keyword.trim()).filter(Boolean))];
  if (keywords.length === 0) {
    throw new UserFacingError("Provide at least one keyword.");
  }

  return keywords;
}

function parseBackfillDate(value: string | null): Date | undefined {
  if (!value) {
    return undefined;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new UserFacingError("Backfill after date must use YYYY-MM-DD.");
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new UserFacingError("Backfill after date is invalid.");
  }

  return date;
}
