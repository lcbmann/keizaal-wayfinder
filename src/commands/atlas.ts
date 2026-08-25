import { SlashCommandBuilder } from "discord.js";
import { createAtlasDiscordLinkCode } from "../services/atlasTrailmarkAccessService.js";
import { buildAtlasDiscordProfile, syncAtlasDiscordProfile } from "../services/atlasDiscordProfileService.js";
import { listMedals } from "../services/medalService.js";
import { UserFacingError } from "../utils/errors.js";
import { canUseTrailmarks } from "../utils/permissions.js";
import type { BotCommand } from "./types.js";

export const atlasCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("atlas")
    .setDescription("Connect the Field Atlas to your Ranger Trailmarks.")
    .addSubcommand((subcommand) => subcommand
      .setName("link")
      .setDescription("Create a temporary code to link your Atlas device to Discord.")),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
      throw new UserFacingError("This command can only be used in the configured guild.");
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!canUseTrailmarks(member)) {
      throw new UserFacingError("Apprentice or higher is required to link the Atlas.");
    }

    await interaction.deferReply({ ephemeral: true });
    const corpsMedals = await listMedals();
    await syncAtlasDiscordProfile(member, corpsMedals);
    const code = await createAtlasDiscordLinkCode({
      discordUserId: member.id,
      discordDisplayName: member.displayName,
      discordProfile: buildAtlasDiscordProfile(member, corpsMedals)
    });
    await interaction.editReply({
      content: `Your Atlas link code is **\`${code}\`**. It expires in 10 minutes. Enter it under **Link Discord** in the Atlas.`
    });
  }
};
