import { SlashCommandBuilder, type GuildMember } from "discord.js";
import {
  cancelFieldNameProposal,
  listFieldNames,
  nominateFieldName,
  removeFieldName,
  refreshFieldNamesBulletin,
  setupFieldNamesChannel
} from "../services/fieldNameService.js";
import { canOpenPromotionVotes, canUseTrailmarks, memberRankAtLeast } from "../utils/permissions.js";
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
      .setName("nominate")
      .setDescription("Ranger+: nominate an Apprentice or Ranger for a field name.")
      .addUserOption((option) => option.setName("member").setDescription("The Apprentice or Ranger receiving the nomination.").setRequired(true))
      .addStringOption((option) => option.setName("name").setDescription("The proposed field name; the nominee cannot choose it themselves.").setRequired(true).setMaxLength(40))
      .addStringOption((option) => option.setName("reason").setDescription("Why the Corps should adopt this name.").setRequired(true).setMaxLength(1000)))
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
      .setDescription("Marshal+: cancel an open field name nomination.")
      .addStringOption((option) => option.setName("proposal").setDescription("Proposal UUID from the nomination message.").setRequired(true))
      .addStringOption((option) => option.setName("reason").setDescription("Why the nomination is being cancelled.").setMaxLength(500))),

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

    if (subcommand === "nominate") {
      const nomineeUser = interaction.options.getUser("member", true);
      const nominee = await interaction.guild.members.fetch(nomineeUser.id).catch(() => null);
      if (!nominee) {
        throw new UserFacingError("That member is not available in this server.");
      }
      await interaction.deferReply({ ephemeral: true });
      const proposal = await nominateFieldName({
        guild: interaction.guild,
        nominee,
        nominator: actor,
        proposedName: interaction.options.getString("name", true),
        reason: interaction.options.getString("reason", true)
      });
      await interaction.editReply({
        content: `You put **${proposal.proposed_name}** forward for ${nominee}. The Ranger vote is open for 3 days in the Field Names channel. Other names may be proposed for the same Ranger and will compete when the contest closes.`
      });
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

    if (subcommand === "cancel") {
      await cancelFieldNameProposal({
        guild: interaction.guild,
        proposalId: interaction.options.getString("proposal", true),
        reason: interaction.options.getString("reason") ?? "Cancelled by a Marshal."
      });
      await interaction.reply({ content: "The field name nomination has been cancelled.", ephemeral: true });
    }
  }
};

function requireRanger(member: GuildMember): void {
  if (!canUseTrailmarks(member) || !memberRankAtLeast(member, "Ranger")) {
    throw new UserFacingError("Ranger or higher is required for Field Names.");
  }
}

function requireMarshal(member: GuildMember): void {
  if (!canOpenPromotionVotes(member)) {
    throw new UserFacingError("Ranger Marshal or higher is required for this Field Names command.");
  }
}
