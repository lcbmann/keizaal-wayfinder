import { SlashCommandBuilder, type GuildMember } from "discord.js";
import {
  awardMedal,
  createMedal,
  listMedals,
  listRangerMedalAwards,
  medalEmoji,
  revokeMedal,
  setupMedals
} from "../services/medalService.js";
import { getRangerByDiscordId } from "../services/rangerService.js";
import { canOpenPromotionVotes, canUseTrailmarks } from "../utils/permissions.js";
import { UserFacingError } from "../utils/errors.js";
import type { BotCommand } from "./types.js";

export const medalCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("medal")
    .setDescription("Create and award Ranger Corps honors.")
    .addSubcommand((subcommand) => subcommand
      .setName("setup")
      .setDescription("Marshal+: create medal roles and backfill Mentor medals."))
    .addSubcommand((subcommand) => subcommand
      .setName("create")
      .setDescription("Marshal+: create a new Corps medal.")
      .addStringOption((option) => option.setName("name").setDescription("Medal name.").setRequired(true).setMaxLength(80))
      .addStringOption((option) => option.setName("description").setDescription("What earns this medal.").setRequired(true).setMaxLength(500))
      .addStringOption((option) => option.setName("emoji").setDescription("Unicode emoji, custom emoji, or server emoji name.").setMaxLength(100)))
    .addSubcommand((subcommand) => subcommand
      .setName("award")
      .setDescription("Marshal+: award a Corps medal.")
      .addUserOption((option) => option.setName("member").setDescription("Ranger receiving the medal.").setRequired(true))
      .addStringOption((option) => option.setName("medal").setDescription("Medal to award.").setRequired(true).setAutocomplete(true))
      .addStringOption((option) => option.setName("reason").setDescription("Why the medal is being awarded.").setMaxLength(500)))
    .addSubcommand((subcommand) => subcommand
      .setName("revoke")
      .setDescription("Marshal+: revoke a Corps medal.")
      .addUserOption((option) => option.setName("member").setDescription("Ranger losing the medal.").setRequired(true))
      .addStringOption((option) => option.setName("medal").setDescription("Medal to revoke.").setRequired(true).setAutocomplete(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("list")
      .setDescription("List a Ranger's awarded Corps medals.")
      .addUserOption((option) => option.setName("member").setDescription("Ranger to inspect."))),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const medals = await listMedals();
    await interaction.respond(medals
      .filter((medal) => medal.name.toLowerCase().includes(focused))
      .slice(0, 25)
      .map((medal) => ({ name: medal.name, value: medal.id })));
  },

  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
      throw new UserFacingError("Corps medals are only available in the Ranger Corps server.");
    }
    const actor = await interaction.guild.members.fetch(interaction.user.id);
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "list") {
      requireCorpsMember(actor);
      const user = interaction.options.getUser("member") ?? interaction.user;
      const ranger = await getRangerByDiscordId(user.id);
      if (!ranger) {
        throw new UserFacingError("No Ranger roster entry exists for that member.");
      }
      const awards = await listRangerMedalAwards(ranger.id);
      const lines = awards.map(({ medal, award }) => {
        const emoji = medalEmoji(interaction.guild, medal);
        return `${emoji ? `${emoji} ` : ""}**${medal.name}**${award.reason ? ` - ${award.reason}` : ""}`;
      });
      await interaction.reply({ content: lines.length ? lines.join("\n") : "No Corps medals have been awarded.", ephemeral: true });
      return;
    }

    requireMarshal(actor);
    if (subcommand === "setup") {
      await interaction.deferReply({ ephemeral: true });
      const result = await setupMedals(interaction.guild, actor.id);
      await interaction.editReply({
        content: `Medal roles are ready. Checked **${result.medals}** medal${result.medals === 1 ? "" : "s"} and awarded the Mentor medal to **${result.mentors}** recorded mentor${result.mentors === 1 ? "" : "s"}.`
      });
      return;
    }

    if (subcommand === "create") {
      await interaction.deferReply({ ephemeral: true });
      const medal = await createMedal({
        guild: interaction.guild,
        name: interaction.options.getString("name", true),
        description: interaction.options.getString("description", true),
        emoji: interaction.options.getString("emoji"),
        createdByDiscordUserId: actor.id
      });
      await interaction.editReply({ content: `Created the **${medal.name}** medal and its Discord role.` });
      return;
    }

    const member = interaction.options.getMember("member");
    if (!member) {
      throw new UserFacingError("That member is not available in this server.");
    }
    const medalId = interaction.options.getString("medal", true);

    if (subcommand === "award") {
      await interaction.deferReply({ ephemeral: true });
      const awarded = await awardMedal({
        guild: interaction.guild,
        rangerDiscordUserId: member.id,
        medalId,
        awardedByDiscordUserId: actor.id,
        reason: interaction.options.getString("reason")
      });
      await interaction.editReply({ content: `Awarded **${awarded.medal.name}** to ${member}.` });
      return;
    }

    if (subcommand === "revoke") {
      await interaction.deferReply({ ephemeral: true });
      const revoked = await revokeMedal({ guild: interaction.guild, rangerDiscordUserId: member.id, medalId });
      await interaction.editReply({ content: revoked ? `The medal was revoked from ${member}.` : `${member} does not hold that medal.` });
    }
  }
};

function requireCorpsMember(member: GuildMember): void {
  if (!canUseTrailmarks(member)) {
    throw new UserFacingError("Apprentice or higher is required to view Corps medals.");
  }
}

function requireMarshal(member: GuildMember): void {
  if (!canOpenPromotionVotes(member)) {
    throw new UserFacingError("Ranger Marshal or higher is required to manage Corps medals.");
  }
}
