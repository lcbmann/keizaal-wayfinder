import { SlashCommandBuilder, type GuildMember } from "discord.js";
import {
  cancelFieldNameContest,
  listFieldNames,
  openFieldNameContest,
  refreshFieldNamesBulletin,
  removeFieldName,
  setupFieldNamesChannel,
  suggestFieldNameOption
} from "../services/fieldNameService.js";
import { canUseTrailmarks, memberRankAtLeast } from "../utils/permissions.js";
import { UserFacingError } from "../utils/errors.js";
import type { BotCommand } from "./types.js";

export const fieldNameCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("field-name")
    .setDescription("Manage Ranger field names.")
    .addSubcommand((subcommand) => subcommand
      .setName("setup")
      .setDescription("Marshal+: create or repair the Ranger-only Field Names channel."))
    .addSubcommand((subcommand) => subcommand
      .setName("open")
      .setDescription("Marshal+: open one three-day field name contest for a member.")
      .addUserOption((option) => option.setName("member").setDescription("The Apprentice or Ranger receiving the contest.").setRequired(true))
      .addStringOption((option) => option.setName("names").setDescription("Optional starting names, separated by commas.").setMaxLength(1000))
      .addStringOption((option) => option.setName("reason").setDescription("Optional context for the contest.").setMaxLength(1000)))
    .addSubcommand((subcommand) => subcommand
      .setName("suggest")
      .setDescription("Ranger+: add a name option to an open contest.")
      .addUserOption((option) => option.setName("member").setDescription("The member whose contest is open.").setRequired(true))
      .addStringOption((option) => option.setName("name").setDescription("The new field name option.").setRequired(true).setMaxLength(40))
      .addStringOption((option) => option.setName("reason").setDescription("Why this name suits them.").setRequired(true).setMaxLength(1000)))
    .addSubcommand((subcommand) => subcommand
      .setName("list")
      .setDescription("Ranger+: list assigned field names."))
    .addSubcommand((subcommand) => subcommand
      .setName("remove")
      .setDescription("Marshal+: remove an assigned field name.")
      .addUserOption((option) => option.setName("member").setDescription("Ranger losing the field name.").setRequired(true))
      .addStringOption((option) => option.setName("reason").setDescription("Why the field name is being removed.").setMaxLength(500)))
    .addSubcommand((subcommand) => subcommand
      .setName("cancel")
      .setDescription("Marshal+: cancel an open field name contest.")
      .addStringOption((option) => option.setName("contest").setDescription("Contest UUID from the contest post.").setRequired(true))
      .addStringOption((option) => option.setName("reason").setDescription("Why the contest is being cancelled.").setMaxLength(500))),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
      throw new UserFacingError("Field Names are only available in the Ranger Corps server.");
    }
    const actor = await interaction.guild.members.fetch(interaction.user.id);
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "setup") {
      requireMarshal(actor);
      await interaction.deferReply({ ephemeral: true });
      const channel = await setupFieldNamesChannel(interaction.guild);
      await interaction.editReply({ content: `The Ranger-only Field Names channel is ready: ${channel}.` });
      return;
    }

    requireRanger(actor);

    if (subcommand === "open") {
      requireMarshal(actor);
      const nomineeUser = interaction.options.getUser("member", true);
      const nominee = await interaction.guild.members.fetch(nomineeUser.id).catch(() => null);
      if (!nominee) {
        throw new UserFacingError("That member is not available in this server.");
      }
      await interaction.deferReply({ ephemeral: true });
      const contest = await openFieldNameContest({
        guild: interaction.guild,
        nominee,
        opener: actor,
        initialNames: parseStartingNames(interaction.options.getString("names")),
        reason: interaction.options.getString("reason") ?? ""
      });
      await interaction.editReply({
        content: `The three-day field name contest for ${nominee} is open. Starting options: ${parseStartingNames(interaction.options.getString("names")).length || "none"}. Contest ID: \`${contest.id}\``
      });
      return;
    }

    if (subcommand === "suggest") {
      const nomineeUser = interaction.options.getUser("member", true);
      const nominee = await interaction.guild.members.fetch(nomineeUser.id).catch(() => null);
      if (!nominee) {
        throw new UserFacingError("That member is not available in this server.");
      }
      await interaction.deferReply({ ephemeral: true });
      const option = await suggestFieldNameOption({
        guild: interaction.guild,
        nominee,
        proposer: actor,
        proposedName: interaction.options.getString("name", true),
        reason: interaction.options.getString("reason", true)
      });
      await interaction.editReply({ content: `**${option.proposed_name}** has been added to ${nominee}'s open field name contest.` });
      return;
    }

    if (subcommand === "list") {
      const names = await listFieldNames();
      const lines = await Promise.all(names.map(async (name) => {
        const member = await interaction.guild.members.fetch(name.discord_user_id).catch(() => null);
        return `${member ?? `<@${name.discord_user_id}>`} - **${name.field_name}**`;
      }));
      await interaction.reply({
        content: lines.length ? lines.join("\n") : "No field names have been assigned.",
        ephemeral: true
      });
      return;
    }

    requireMarshal(actor);

    if (subcommand === "remove") {
      const member = interaction.options.getUser("member", true);
      const removed = await removeFieldName({
        discordUserId: member.id,
        removedReason: interaction.options.getString("reason") ?? "Removed by a Marshal."
      });
      await refreshFieldNamesBulletin(interaction.guild);
      await interaction.reply({
        content: removed ? `The field name for ${member} has been removed.` : `${member} has no active field name.`,
        ephemeral: true
      });
      return;
    }

    await cancelFieldNameContest({
      guild: interaction.guild,
      contestId: interaction.options.getString("contest", true),
      reason: interaction.options.getString("reason") ?? "Cancelled by a Marshal."
    });
    await interaction.reply({ content: "The field name contest has been cancelled.", ephemeral: true });
  }
};

function requireRanger(member: GuildMember): void {
  if (!canUseTrailmarks(member) || !memberRankAtLeast(member, "Ranger")) {
    throw new UserFacingError("Ranger or higher is required for Field Names.");
  }
}

function requireMarshal(member: GuildMember): void {
  if (!memberRankAtLeast(member, "Ranger Marshal")) {
    throw new UserFacingError("Ranger Marshal or higher is required for this Field Names command.");
  }
}

function parseStartingNames(value: string | null): string[] {
  if (!value?.trim()) {
    return [];
  }
  return value.split(",").map((name) => name.trim()).filter(Boolean);
}
