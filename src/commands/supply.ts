import {
  ChannelType,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
  type SlashCommandStringOption
} from "discord.js";
import {
  createSupplyAssignment,
  listSupplyAssignmentItems,
  listSupplyAssignments,
  logSupplyContribution,
  refreshSupplyAssignmentBoard,
  setSupplyAssignmentStatus,
  supplyAssignmentEmbed,
  supplyContributorsEmbed,
  undoLatestSupplyContribution
} from "../services/supplyAssignmentService.js";
import { canOpenPromotionVotes, canUseTrailmarks } from "../utils/permissions.js";
import { UserFacingError } from "../utils/errors.js";
import type { BotCommand } from "./types.js";

const builder = new SlashCommandBuilder()
  .setName("supply")
  .setDescription("Create and track Ranger Corps supply assignments.")
  .addSubcommand((subcommand) => {
    subcommand
      .setName("create")
      .setDescription("Create an auto-updating supply assignment board.")
      .addStringOption((option) => option.setName("name").setDescription("Assignment name.").setRequired(true).setMaxLength(100))
      .addStringOption((option) => option.setName("client").setDescription("Client receiving the supplies.").setRequired(true).setMaxLength(100))
      .addNumberOption((option) => option.setName("sale_price").setDescription("Septims paid by the client per item.").setRequired(true).setMinValue(0))
      .addNumberOption((option) => option.setName("ranger_rate").setDescription("Septims paid to Rangers per item.").setRequired(true).setMinValue(0))
      .addStringOption((option) => option.setName("item_1").setDescription("First item.").setRequired(true).setMaxLength(100))
      .addIntegerOption((option) => option.setName("quota_1").setDescription("First item quota.").setRequired(true).setMinValue(1))
      .addStringOption((option) => option.setName("item_2").setDescription("Second item.").setMaxLength(100))
      .addIntegerOption((option) => option.setName("quota_2").setDescription("Second item quota.").setMinValue(1))
      .addStringOption((option) => option.setName("item_3").setDescription("Third item.").setMaxLength(100))
      .addIntegerOption((option) => option.setName("quota_3").setDescription("Third item quota.").setMinValue(1))
      .addStringOption((option) => option.setName("item_4").setDescription("Fourth item.").setMaxLength(100))
      .addIntegerOption((option) => option.setName("quota_4").setDescription("Fourth item quota.").setMinValue(1))
      .addUserOption((option) => option.setName("organizer").setDescription("Ranger organizing the assignment."))
      .addStringOption((option) => option.setName("notes").setDescription("Optional instructions or storage location.").setMaxLength(1000));
    return subcommand;
  })
  .addSubcommand((subcommand) => subcommand
    .setName("log")
    .setDescription("Log items contributed to an active assignment.")
    .addStringOption(assignmentOption)
    .addStringOption((option) => option.setName("item").setDescription("Item contributed.").setRequired(true).setAutocomplete(true))
    .addIntegerOption((option) => option.setName("quantity").setDescription("Quantity contributed.").setRequired(true).setMinValue(1))
    .addUserOption((option) => option.setName("member").setDescription("Marshal+: log for another Ranger."))
    .addStringOption((option) => option.setName("note").setDescription("Optional contribution note.").setMaxLength(500)))
  .addSubcommand((subcommand) => subcommand
    .setName("undo-last")
    .setDescription("Undo your latest contribution to an assignment.")
    .addStringOption(assignmentOption)
    .addUserOption((option) => option.setName("member").setDescription("Marshal+: undo another Ranger's latest entry.")))
  .addSubcommand((subcommand) => subcommand.setName("status").setDescription("View a supply assignment.").addStringOption(assignmentOption))
  .addSubcommand((subcommand) => subcommand.setName("contributors").setDescription("View contribution and payout totals.").addStringOption(assignmentOption))
  .addSubcommand((subcommand) => subcommand.setName("refresh").setDescription("Refresh an assignment board.").addStringOption(assignmentOption))
  .addSubcommand((subcommand) => subcommand.setName("close").setDescription("Close an assignment as completed.").addStringOption(assignmentOption))
  .addSubcommand((subcommand) => subcommand.setName("reopen").setDescription("Reopen a completed or cancelled assignment.").addStringOption(assignmentOption))
  .addSubcommand((subcommand) => subcommand.setName("cancel").setDescription("Cancel an assignment.").addStringOption(assignmentOption));

export const supplyCommand: BotCommand = {
  data: builder,

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === "assignment") {
      const assignments = await listSupplyAssignments(String(focused.value));
      await interaction.respond(assignments.map((assignment) => ({
        name: `${assignment.code} - ${assignment.name} (${assignment.status})`.slice(0, 100),
        value: assignment.code
      })));
      return;
    }
    if (focused.name === "item") {
      const code = interaction.options.getString("assignment");
      if (!code) {
        await interaction.respond([]);
        return;
      }
      const query = String(focused.value).toLocaleLowerCase();
      const items = await listSupplyAssignmentItems(code).catch(() => []);
      await interaction.respond(items
        .filter((item) => item.item_name.toLocaleLowerCase().includes(query))
        .slice(0, 25)
        .map((item) => ({ name: item.item_name.slice(0, 100), value: item.id })));
    }
  },

  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
      throw new UserFacingError("This command can only be used in the configured guild.");
    }
    const actor = await interaction.guild.members.fetch(interaction.user.id);
    if (!canUseTrailmarks(actor)) {
      throw new UserFacingError("Apprentice or higher is required to use supply assignments.");
    }
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "create") {
      requireMarshal(actor);
      if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
        throw new UserFacingError("Supply boards can only be created in a text channel.");
      }
      const salePrice = interaction.options.getNumber("sale_price", true);
      const rangerRate = interaction.options.getNumber("ranger_rate", true);
      if (rangerRate > salePrice) {
        throw new UserFacingError("The Ranger rate cannot exceed the client's price per item.");
      }
      const items = supplyItemInputs(interaction);
      await interaction.deferReply({ ephemeral: true });
      const assignment = await createSupplyAssignment({
        channel: interaction.channel,
        name: interaction.options.getString("name", true).trim(),
        clientName: interaction.options.getString("client", true).trim(),
        salePricePerItem: salePrice,
        rangerRatePerItem: rangerRate,
        organizerDiscordUserId: (interaction.options.getUser("organizer") ?? interaction.user).id,
        notes: interaction.options.getString("notes")?.trim() || null,
        createdByDiscordUserId: interaction.user.id,
        items
      });
      await interaction.editReply({ content: `Created supply assignment ${assignment.code}.` });
      return;
    }

    const assignmentCode = interaction.options.getString("assignment", true);
    if (subcommand === "log") {
      const target = interaction.options.getUser("member") ?? interaction.user;
      if (target.id !== interaction.user.id) {
        requireMarshal(actor);
        const targetMember = await interaction.guild.members.fetch(target.id);
        if (!canUseTrailmarks(targetMember)) {
          throw new UserFacingError("Contributions can only be logged for Apprentice or higher.");
        }
      }
      await interaction.deferReply({ ephemeral: true });
      const result = await logSupplyContribution({
        guild: interaction.guild,
        assignmentCode,
        itemName: interaction.options.getString("item", true),
        quantity: interaction.options.getInteger("quantity", true),
        memberDiscordUserId: target.id,
        loggedByDiscordUserId: interaction.user.id,
        note: interaction.options.getString("note")?.trim() || null
      });
      await interaction.editReply({
        content: `Logged ${interaction.options.getInteger("quantity", true).toLocaleString("en-US")} ${result.item.item_name} for ${target}. ${result.assignment.status === "Completed" ? "The assignment is now complete." : ""}`.trim()
      });
      return;
    }

    if (subcommand === "undo-last") {
      const target = interaction.options.getUser("member") ?? interaction.user;
      if (target.id !== interaction.user.id) {
        requireMarshal(actor);
      }
      await interaction.deferReply({ ephemeral: true });
      const undone = await undoLatestSupplyContribution({
        guild: interaction.guild,
        assignmentCode,
        memberDiscordUserId: target.id
      });
      await interaction.editReply({
        content: undone
          ? `Removed ${undone.contribution.quantity.toLocaleString("en-US")} ${undone.item.item_name} from ${target}'s contributions.`
          : `No contribution from ${target} was found for that assignment.`
      });
      return;
    }

    if (subcommand === "status") {
      await interaction.reply({ embeds: [await supplyAssignmentEmbed(assignmentCode)], ephemeral: true });
      return;
    }
    if (subcommand === "contributors") {
      await interaction.reply({ embeds: [await supplyContributorsEmbed(assignmentCode)], ephemeral: true });
      return;
    }

    requireMarshal(actor);
    await interaction.deferReply({ ephemeral: true });
    if (subcommand === "refresh") {
      const assignment = await refreshSupplyAssignmentBoard(interaction.guild, assignmentCode);
      await interaction.editReply({ content: `Refreshed ${assignment.code}.` });
      return;
    }
    const status = subcommand === "close" ? "Completed" : subcommand === "reopen" ? "Active" : "Cancelled";
    const assignment = await setSupplyAssignmentStatus({ guild: interaction.guild, assignmentCode, status });
    await interaction.editReply({ content: `Set ${assignment.code} to ${assignment.status}.` });
  }
};

function assignmentOption(option: SlashCommandStringOption): SlashCommandStringOption {
  return option.setName("assignment").setDescription("Supply assignment code.").setRequired(true).setAutocomplete(true);
}

function supplyItemInputs(interaction: ChatInputCommandInteraction): Array<{ name: string; targetQuantity: number }> {
  const items: Array<{ name: string; targetQuantity: number }> = [];
  for (let index = 1; index <= 4; index += 1) {
    const name = interaction.options.getString(`item_${index}`)?.trim() ?? null;
    const quota = interaction.options.getInteger(`quota_${index}`);
    if (Boolean(name) !== Boolean(quota)) {
      throw new UserFacingError(`item_${index} and quota_${index} must be provided together.`);
    }
    if (name && quota) {
      items.push({ name, targetQuantity: quota });
    }
  }
  const uniqueNames = new Set(items.map((item) => item.name.toLocaleLowerCase()));
  if (uniqueNames.size !== items.length) {
    throw new UserFacingError("Each supply item must have a unique name.");
  }
  return items;
}

function requireMarshal(member: GuildMember): void {
  if (!canOpenPromotionVotes(member)) {
    throw new UserFacingError("Ranger Marshal or higher is required.");
  }
}
