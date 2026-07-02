import { ChannelType, EmbedBuilder, SlashCommandBuilder, type TextChannel } from "discord.js";
import {
  backfillTrailmarkIntel,
  createIntelTopic,
  findIntelTopicsByName,
  getIntelSettings,
  listIntelTopics,
  refreshIntelTopicBulletin,
  setIntelHqTrailmark
} from "../services/intelService.js";
import { findTrailmarksByName, getTrailmark } from "../services/trailmarkService.js";
import { UserFacingError } from "../utils/errors.js";
import { canCreateTrailmarks } from "../utils/permissions.js";
import { slugify } from "../utils/slugs.js";
import type { BotCommand } from "./types.js";

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
            .setDescription("Existing report channel. If omitted, Wayfinder creates one here.")
            .addChannelTypes(ChannelType.GuildText)
        )
    )
    .addSubcommand((subcommand) => subcommand.setName("topic-list").setDescription("List intel topics and HQ setup."))
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
      await interaction.editReply({
        content: `Created intel topic ${topic.name} in ${channel} with keywords: ${keywords.join(", ")}.`,
      });
      return;
    }

    if (subcommand === "topic-list") {
      const settings = await getIntelSettings();
      const hqTrailmark = settings.hq_trailmark_id ? await getTrailmark(settings.hq_trailmark_id) : null;
      const topics = await listIntelTopics(true);
      const embed = new EmbedBuilder()
        .setTitle("Trailmark Intel")
        .setDescription(`HQ delivery Trailmark: ${hqTrailmark ? hqTrailmark.name : "Not set"}`)
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
          `Trailmarks scanned: ${result.trailmarksScanned}`,
          `Messages scanned: ${result.messagesScanned}`,
          `Matched reports: ${result.matchedReports}`,
          `Historically delivered: ${result.deliveredReports}`,
          `Bulletins refreshed: ${result.topicsRefreshed}`
        ].join("\n")
      });
    }
  }
};

async function resolveTopicChannel(interaction: Parameters<BotCommand["execute"]>[0], name: string): Promise<TextChannel> {
  const selectedChannel = interaction.options.getChannel("channel");
  if (selectedChannel) {
    if (!interaction.inCachedGuild()) {
      throw new UserFacingError("This command can only be used in the configured guild.");
    }

    const channel = await interaction.guild.channels.fetch(selectedChannel.id);
    if (!channel || channel.type !== ChannelType.GuildText) {
      throw new UserFacingError("Intel topic channel must be a text channel.");
    }

    return channel;
  }

  if (!interaction.inCachedGuild()) {
    throw new UserFacingError("This command can only be used in the configured guild.");
  }

  const currentChannel = interaction.channel;
  const parent = currentChannel?.type === ChannelType.GuildText ? currentChannel.parentId : null;
  return interaction.guild.channels.create({
    name: `${slugify(name)}-reports`.slice(0, 90),
    type: ChannelType.GuildText,
    ...(parent ? { parent } : {}),
    reason: `Create Trailmark intel topic channel for ${name}`
  });
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
