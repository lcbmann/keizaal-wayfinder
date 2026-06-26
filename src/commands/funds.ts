import { SlashCommandBuilder } from "discord.js";
import {
  fundBalanceEmbed,
  fundHistoryEmbed,
  monthlyFundSummaryEmbed,
  recordFundTransaction,
  refreshFundSummaryForGuild,
  setFundBalance,
  undoLastFundTransaction
} from "../services/corpsFundService.js";
import { UserFacingError } from "../utils/errors.js";
import { canOpenPromotionVotes } from "../utils/permissions.js";
import type { BotCommand } from "./types.js";

export const fundsCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("funds")
    .setDescription("Corps fund transaction logging.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("deposit")
        .setDescription("Record a Corps fund donation.")
        .addUserOption((option) => option.setName("member").setDescription("Member who donated.").setRequired(true))
        .addIntegerOption((option) =>
          option.setName("amount").setDescription("Amount in Septims.").setRequired(true).setMinValue(1)
        )
        .addStringOption((option) => option.setName("note").setDescription("Optional note."))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("spend")
        .setDescription("Record Corps fund spending.")
        .addIntegerOption((option) =>
          option.setName("amount").setDescription("Amount in Septims.").setRequired(true).setMinValue(1)
        )
        .addStringOption((option) => option.setName("note").setDescription("What the funds were spent on.").setRequired(true))
        .addUserOption((option) => option.setName("paid_to").setDescription("Optional member who received the funds."))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set-balance")
        .setDescription("Set the current Corps fund total with a balancing adjustment.")
        .addIntegerOption((option) =>
          option.setName("amount").setDescription("Current total in Septims.").setRequired(true).setMinValue(0)
        )
        .addStringOption((option) => option.setName("note").setDescription("Adjustment note."))
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("refresh-summary").setDescription("Move the Corps fund summary to the bottom.")
    )
    .addSubcommand((subcommand) => subcommand.setName("balance").setDescription("Show the current Corps fund balance."))
    .addSubcommand((subcommand) =>
      subcommand
        .setName("history")
        .setDescription("Show recent Corps fund transactions.")
        .addUserOption((option) => option.setName("member").setDescription("Filter to one member."))
    )
    .addSubcommand((subcommand) => subcommand.setName("undo-last").setDescription("Undo the latest Corps fund transaction."))
    .addSubcommand((subcommand) =>
      subcommand
        .setName("monthly")
        .setDescription("Show a monthly Corps fund summary.")
        .addIntegerOption((option) => option.setName("year").setDescription("Year.").setRequired(true).setMinValue(2020))
        .addIntegerOption((option) =>
          option.setName("month").setDescription("Month number.").setRequired(true).setMinValue(1).setMaxValue(12)
        )
    ),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
      throw new UserFacingError("This command can only be used in the configured guild.");
    }

    const actor = await interaction.guild.members.fetch(interaction.user.id);
    if (!canOpenPromotionVotes(actor)) {
      throw new UserFacingError("Ranger Marshal or higher is required to manage Corps funds.");
    }

    const subcommand = interaction.options.getSubcommand();
    await interaction.deferReply({ ephemeral: true });

    if (subcommand === "deposit") {
      const member = interaction.options.getUser("member", true);
      const amount = interaction.options.getInteger("amount", true);
      const note = interaction.options.getString("note") ?? "Donation to the Corps fund.";
      await recordFundTransaction({
        guild: interaction.guild,
        transactionType: "Donation",
        amount,
        description: note,
        memberDiscordUserId: member.id,
        recordedByDiscordUserId: interaction.user.id
      });
      await interaction.editReply({ content: `Recorded ${amount} Septim donation from ${member}.` });
      return;
    }

    if (subcommand === "spend") {
      const amount = interaction.options.getInteger("amount", true);
      const note = interaction.options.getString("note", true);
      const paidTo = interaction.options.getUser("paid_to");
      await recordFundTransaction({
        guild: interaction.guild,
        transactionType: "Expense",
        amount,
        description: note,
        memberDiscordUserId: paidTo?.id ?? null,
        recordedByDiscordUserId: interaction.user.id
      });
      await interaction.editReply({ content: `Recorded ${amount} Septim expense.` });
      return;
    }

    if (subcommand === "set-balance") {
      const amount = interaction.options.getInteger("amount", true);
      const note = interaction.options.getString("note") ?? "Balance imported from previous Corps fund records.";
      const transaction = await setFundBalance({
        guild: interaction.guild,
        targetBalance: amount,
        description: note,
        recordedByDiscordUserId: interaction.user.id
      });
      await interaction.editReply({
        content: transaction
          ? `Adjusted Corps fund balance to ${amount} Septims.`
          : `Corps fund balance is already ${amount} Septims. Summary refreshed.`
      });
      return;
    }

    if (subcommand === "refresh-summary") {
      await refreshFundSummaryForGuild(interaction.guild);
      await interaction.editReply({ content: "Corps fund summary refreshed." });
      return;
    }

    if (subcommand === "balance") {
      await interaction.editReply({ embeds: [await fundBalanceEmbed()] });
      return;
    }

    if (subcommand === "history") {
      const member = interaction.options.getUser("member");
      await interaction.editReply({ embeds: [await fundHistoryEmbed(member?.id ?? null)] });
      return;
    }

    if (subcommand === "undo-last") {
      const undone = await undoLastFundTransaction(interaction.guild, interaction.user.id);
      await interaction.editReply({
        content: undone ? `Undid latest transaction: ${undone.description}` : "No Corps fund transactions exist."
      });
      return;
    }

    if (subcommand === "monthly") {
      await interaction.editReply({
        embeds: [
          await monthlyFundSummaryEmbed(
            interaction.options.getInteger("year", true),
            interaction.options.getInteger("month", true)
          )
        ]
      });
    }
  }
};
