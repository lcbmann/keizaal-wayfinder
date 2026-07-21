import { ChannelType, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder, type GuildMember, type TextChannel } from "discord.js";
import { env } from "../config/env.js";
import { HOLDS } from "../config/holds.js";
import {
  createTrailmark,
  deactivateTrailmark,
  editTrailmark,
  findTrailmarksByName,
  getTrailmark,
  leaveTrailmark,
  listActiveTrailmarks,
  listActiveTrailmarkSessions,
  postTrailmarkPanel,
  updateTrailmarkAtlasLocation
} from "../services/trailmarkService.js";
import { UserFacingError } from "../utils/errors.js";
import { canCreateTrailmarks } from "../utils/permissions.js";
import { emojiEmbed, emojiText } from "../utils/guildEmojis.js";
import type { BotCommand } from "./types.js";

export const trailmarkCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("trailmark")
    .setDescription("Trailmark cache access and administration.")
    .addSubcommand((subcommand) => subcommand.setName("panel").setDescription("Post a Trailmark access panel."))
    .addSubcommand((subcommand) => subcommand.setName("leave").setDescription("Leave your current Trailmark."))
    .addSubcommand((subcommand) => subcommand.setName("list").setDescription("List active Trailmarks."))
    .addSubcommand((subcommand) => subcommand.setName("sessions").setDescription("Show active Trailmark access sessions."))
    .addSubcommand((subcommand) =>
      subcommand
        .setName("create")
        .setDescription("Create a private Trailmark channel.")
        .addStringOption((option) => option.setName("name").setDescription("Trailmark name.").setRequired(true))
        .addStringOption((option) =>
          option
            .setName("hold")
            .setDescription("Hold or range.")
            .setRequired(true)
            .addChoices(...HOLDS.map((hold) => ({ name: hold, value: hold })))
        )
        .addStringOption((option) =>
          option.setName("location_description").setDescription("In-character location description.").setRequired(true)
        )
        .addAttachmentOption((option) => option.setName("screenshot").setDescription("Optional location screenshot."))
        .addStringOption((option) => option.setName("atlas_location_id").setDescription("Optional future Atlas location UUID."))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("edit")
        .setDescription("Edit an existing Trailmark.")
        .addStringOption((option) =>
          option.setName("trailmark").setDescription("Trailmark to edit.").setRequired(true).setAutocomplete(true)
        )
        .addStringOption((option) => option.setName("name").setDescription("New Trailmark name."))
        .addStringOption((option) =>
          option
            .setName("hold")
            .setDescription("New hold or range.")
            .addChoices(...HOLDS.map((hold) => ({ name: hold, value: hold })))
        )
        .addStringOption((option) =>
          option.setName("location_description").setDescription("New in-character location description.").setMaxLength(4000)
        )
        .addAttachmentOption((option) => option.setName("screenshot").setDescription("Replace the location screenshot."))
        .addBooleanOption((option) => option.setName("clear_screenshot").setDescription("Remove the current screenshot."))
        .addStringOption((option) => option.setName("atlas_location_id").setDescription("Set or replace the Atlas location UUID."))
        .addBooleanOption((option) => option.setName("clear_atlas").setDescription("Remove the Atlas location UUID."))
        .addBooleanOption((option) => option.setName("pinned").setDescription("Pin or unpin this Trailmark at the top of the panel."))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("deactivate")
        .setDescription("Deactivate a Trailmark without deleting channel history.")
        .addStringOption((option) =>
          option.setName("trailmark").setDescription("Trailmark to deactivate.").setRequired(true).setAutocomplete(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set-atlas")
        .setDescription("Set or replace a Trailmark Atlas location UUID.")
        .addStringOption((option) =>
          option.setName("trailmark").setDescription("Trailmark to update.").setRequired(true).setAutocomplete(true)
        )
        .addStringOption((option) =>
          option.setName("atlas_location_id").setDescription("Atlas location UUID.").setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("clear-atlas")
        .setDescription("Remove a Trailmark Atlas location UUID.")
        .addStringOption((option) =>
          option.setName("trailmark").setDescription("Trailmark to update.").setRequired(true).setAutocomplete(true)
        )
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    const trailmarks = await findTrailmarksByName(focused);
    await interaction.respond(trailmarks.map((trailmark) => ({ name: `${trailmark.name} (${trailmark.hold})`, value: trailmark.id })));
  },

  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
      throw new UserFacingError("This command can only be used in the configured guild.");
    }

    const actor = await interaction.guild.members.fetch(interaction.user.id);
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "panel") {
      if (!canCreateTrailmarks(actor)) {
        throw new UserFacingError("Ranger Marshal or higher is required to post the panel.");
      }

      const channel = await interaction.guild.channels.fetch(env.TRAILMARK_ACCESS_CHANNEL_ID);
      if (!channel || channel.type !== ChannelType.GuildText) {
        throw new UserFacingError("TRAILMARK_ACCESS_CHANNEL_ID must point to a text channel.");
      }

      assertBotCanPostPanel(channel, await interaction.guild.members.fetchMe());
      await postTrailmarkPanel(channel);
      await interaction.reply({
        content: emojiText(interaction.guild, "trailmark", "Trailmark panel posted."),
        ephemeral: true
      });
      return;
    }

    if (subcommand === "leave") {
      const revoked = await leaveTrailmark(interaction.guild, interaction.user.id);
      await interaction.reply({
        content: emojiText(
          interaction.guild,
          "trailmark",
          revoked > 0 ? "You close the cache and leave it as you found it." : "You do not have an open Trailmark cache."
        ),
        ephemeral: true
      });
      return;
    }

    if (subcommand === "list") {
      const trailmarks = await listActiveTrailmarks(25);
      const embed = emojiEmbed(interaction.guild, "trailmark", "Active Trailmarks")
        .setDescription(
          trailmarks.length
            ? trailmarks.map((trailmark) => `**${trailmark.name}** - ${trailmark.hold}`).join("\n")
            : "No active Trailmarks."
        )
        .setColor(0x587c4a);
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (subcommand === "create") {
      if (!canCreateTrailmarks(actor)) {
        throw new UserFacingError("Ranger Marshal or higher is required to create Trailmarks.");
      }

      const trailmark = await createTrailmark({
        guild: interaction.guild,
        name: interaction.options.getString("name", true),
        hold: interaction.options.getString("hold", true),
        locationDescription: interaction.options.getString("location_description", true),
        screenshotUrl: interaction.options.getAttachment("screenshot")?.url ?? null,
        atlasLocationId: interaction.options.getString("atlas_location_id") ?? null,
        createdByDiscordUserId: interaction.user.id
      });

      await interaction.reply({
        content: `Created Trailmark ${trailmark.name} in <#${trailmark.discord_channel_id}>.`,
        ephemeral: true
      });
      return;
    }

    if (subcommand === "edit") {
      if (!canCreateTrailmarks(actor)) {
        throw new UserFacingError("Ranger Marshal or higher is required to edit Trailmarks.");
      }

      const name = optionalTrimmedString(interaction.options.getString("name"));
      const locationDescription = optionalTrimmedString(interaction.options.getString("location_description"));
      const screenshot = interaction.options.getAttachment("screenshot");
      const clearScreenshot = interaction.options.getBoolean("clear_screenshot") ?? false;
      const atlasLocationId = optionalTrimmedString(interaction.options.getString("atlas_location_id"));
      const clearAtlas = interaction.options.getBoolean("clear_atlas") ?? false;
      const pinned = interaction.options.getBoolean("pinned");

      if (screenshot && clearScreenshot) {
        throw new UserFacingError("Choose either a replacement screenshot or clear_screenshot, not both.");
      }

      if (atlasLocationId && clearAtlas) {
        throw new UserFacingError("Choose either an Atlas location ID or clear_atlas, not both.");
      }

      if (atlasLocationId && !isUuid(atlasLocationId)) {
        throw new UserFacingError("Atlas location ID must be a valid UUID.");
      }

      const hasEdits = Boolean(
        name ||
          interaction.options.getString("hold") ||
          locationDescription ||
          screenshot ||
          clearScreenshot ||
          atlasLocationId ||
          clearAtlas ||
          pinned !== null
      );
      if (!hasEdits) {
        throw new UserFacingError("Provide at least one Trailmark field to edit.");
      }

      const trailmark = await editTrailmark({
        guild: interaction.guild,
        id: interaction.options.getString("trailmark", true),
        ...(name ? { name } : {}),
        ...(interaction.options.getString("hold") ? { hold: interaction.options.getString("hold", true) } : {}),
        ...(locationDescription ? { locationDescription } : {}),
        ...(screenshot ? { screenshotUrl: screenshot.url } : {}),
        ...(clearScreenshot ? { screenshotUrl: null } : {}),
        ...(atlasLocationId ? { atlasLocationId } : {}),
        ...(clearAtlas ? { atlasLocationId: null } : {}),
        ...(pinned !== null ? { pinned } : {})
      });

      await interaction.reply({
        content: `Updated ${trailmark.name} in <#${trailmark.discord_channel_id}>.`,
        ephemeral: true
      });
      return;
    }

    if (subcommand === "deactivate") {
      if (!canCreateTrailmarks(actor)) {
        throw new UserFacingError("Ranger Marshal or higher is required to deactivate Trailmarks.");
      }

      const trailmark = await deactivateTrailmark(interaction.options.getString("trailmark", true), interaction.guild);
      await interaction.reply({ content: `Deactivated ${trailmark.name}. Channel history was preserved.`, ephemeral: true });
      return;
    }

    if (subcommand === "set-atlas") {
      if (!canCreateTrailmarks(actor)) {
        throw new UserFacingError("Ranger Marshal or higher is required to edit Trailmarks.");
      }

      const atlasLocationId = interaction.options.getString("atlas_location_id", true);
      if (!isUuid(atlasLocationId)) {
        throw new UserFacingError("Atlas location ID must be a valid UUID.");
      }

      const trailmark = await updateTrailmarkAtlasLocation(
        interaction.options.getString("trailmark", true),
        atlasLocationId
      );
      await interaction.reply({
        content: `Set Atlas location ID for ${trailmark.name}.`,
        ephemeral: true
      });
      return;
    }

    if (subcommand === "clear-atlas") {
      if (!canCreateTrailmarks(actor)) {
        throw new UserFacingError("Ranger Marshal or higher is required to edit Trailmarks.");
      }

      const trailmark = await updateTrailmarkAtlasLocation(interaction.options.getString("trailmark", true), null);
      await interaction.reply({
        content: `Cleared Atlas location ID for ${trailmark.name}.`,
        ephemeral: true
      });
    }

    if (subcommand === "sessions") {
      if (!canCreateTrailmarks(actor)) {
        throw new UserFacingError("Ranger Marshal or higher is required to view Trailmark sessions.");
      }

      const sessions = await listActiveTrailmarkSessions();
      const lines = await Promise.all(
        sessions.slice(0, 25).map(async (session) => {
          const trailmark = await getTrailmark(session.trailmark_id);
          const expiresAt = Math.max(0, Math.ceil((new Date(session.expires_at).getTime() - Date.now()) / 60_000));
          return `<@${session.discord_user_id}> - ${trailmark?.name ?? "Unknown Trailmark"} - expires in ${expiresAt}m`;
        })
      );
      const embed = emojiEmbed(interaction.guild, "trailmark", "Active Trailmark Sessions")
        .setDescription(lines.length ? lines.join("\n") : "No active sessions.")
        .setColor(0x587c4a);
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
  }
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function optionalTrimmedString(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function assertBotCanPostPanel(channel: TextChannel, botMember: GuildMember): void {
  const permissions = channel.permissionsFor(botMember);
  const required = [
    { flag: PermissionFlagsBits.ViewChannel, name: "View Channel" },
    { flag: PermissionFlagsBits.SendMessages, name: "Send Messages" },
    { flag: PermissionFlagsBits.EmbedLinks, name: "Embed Links" }
  ];
  const missing = required.filter((permission) => !permissions.has(permission.flag)).map((permission) => permission.name);

  if (missing.length > 0) {
    throw new UserFacingError(
      `I cannot post the Trailmark panel in ${channel}. Missing permission${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`
    );
  }
}
