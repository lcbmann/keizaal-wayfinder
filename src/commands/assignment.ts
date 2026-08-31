import { ChannelType, SlashCommandBuilder } from "discord.js";
import { HOLDS } from "../config/holds.js";
import {
  createAssignmentModal,
  setupManagedAssignmentsForum
} from "../services/managedAssignmentService.js";
import { UserFacingError } from "../utils/errors.js";
import { memberRankAtLeast } from "../utils/permissions.js";
import type { BotCommand } from "./types.js";

export const assignmentCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("assignment")
    .setDescription("Create and manage Ranger Corps assignments.")
    .addSubcommand((subcommand) => subcommand
      .setName("setup")
      .setDescription("Marshal+: connect Wayfinder to the Assignments Forum.")
      .addChannelOption((option) => option
        .setName("forum")
        .setDescription("The existing Assignments Forum channel.")
        .addChannelTypes(ChannelType.GuildForum)
        .setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("create")
      .setDescription("Ranger+: post a new assignment to the Corps board.")
      .addStringOption((option) => option
        .setName("minimum_rank")
        .setDescription("Choose who may join. The default is Apprentice+.")
        .addChoices(
          { name: "Apprentice+", value: "Apprentice" },
          { name: "Ranger+", value: "Ranger" }
        ))
      .addStringOption((option) => option
        .setName("hold")
        .setDescription("Primary Hold, if the assignment is regional.")
        .addChoices(
          ...HOLDS.map((hold) => ({ name: hold, value: hold })),
          { name: "Cross-Skyrim", value: "Cross-Skyrim" }
        ))),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
      throw new UserFacingError("Assignments are only available in the Ranger Corps server.");
    }
    const actor = await interaction.guild.members.fetch(interaction.user.id);
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "setup") {
      if (!memberRankAtLeast(actor, "Ranger Marshal")) {
        throw new UserFacingError("Ranger Marshal or higher is required to configure the Assignments Forum.");
      }
      const forum = interaction.options.getChannel("forum", true);
      if (forum.type !== ChannelType.GuildForum) {
        throw new UserFacingError("Choose the existing Assignments Forum channel.");
      }
      await interaction.deferReply({ ephemeral: true });
      await setupManagedAssignmentsForum(forum);
      await interaction.editReply({ content: `Wayfinder will post new assignments in ${forum}. Existing posts were not changed.` });
      return;
    }

    if (!memberRankAtLeast(actor, "Ranger")) {
      throw new UserFacingError("Ranger or higher is required to create an assignment.");
    }
    const minimumRank = (interaction.options.getString("minimum_rank") ?? "Apprentice") as "Apprentice" | "Ranger";
    const hold = interaction.options.getString("hold");
    await interaction.showModal(createAssignmentModal({ minimumRank, hold }));
  }
};
