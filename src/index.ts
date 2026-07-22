import {
  Client,
  Collection,
  GatewayIntentBits,
  Partials,
  type Interaction,
  type RepliableInteraction
} from "discord.js";
import { env } from "./config/env.js";
import { pingCommand } from "./commands/ping.js";
import { rangerCommand } from "./commands/ranger.js";
import { promotionCommand } from "./commands/promotion.js";
import { trailmarkCommand } from "./commands/trailmark.js";
import { rosterCommand } from "./commands/roster.js";
import { recruitCommand } from "./commands/recruit.js";
import { fundsCommand } from "./commands/funds.js";
import { intelCommand } from "./commands/intel.js";
import { strongboxCommand } from "./commands/strongbox.js";
import { allianceCommand } from "./commands/alliance.js";
import { supplyCommand } from "./commands/supply.js";
import { dutyCommand } from "./commands/duty.js";
import { apprenticeshipCommand } from "./commands/apprenticeship.js";
import { fieldNameCommand } from "./commands/fieldName.js";
import type { BotCommand, CommandCollection } from "./commands/types.js";
import { handlePromotionButton } from "./components/promotionButtons.js";
import { handleTrailmarkSelect } from "./components/trailmarkSelect.js";
import { handleDutyButton } from "./components/dutyButtons.js";
import { handleApprenticeshipButton } from "./components/apprenticeshipButtons.js";
import { handleFieldNameButton } from "./components/fieldNameButtons.js";
import { handleMemberJoin, handleMemberRemove, handleMemberUpdate } from "./jobs/syncMemberRoster.js";
import { startTrailmarkSessionExpirationJob } from "./jobs/expireTrailmarkSessions.js";
import { startFieldNameResolutionJob } from "./jobs/resolveFieldNameProposals.js";
import { recordBotInteraction, recordMessageActivity } from "./services/activityService.js";
import { maybeSendAtlasSharePreview } from "./services/atlasService.js";
import { refreshStoredAssignmentsBoard } from "./services/assignmentBoardService.js";
import {
  captureTrailmarkIntelReports,
  removeCorpsOnlyIntelReports,
  removeIntelReportsForDiscordMessage,
  synchronizeEditedTrailmarkIntelReports,
  syncIntelReportChannelNames
} from "./services/intelService.js";
import { handleStrongboxDropMessage } from "./services/strongboxService.js";
import { syncApprenticeshipPreferenceNotices } from "./services/apprenticeshipService.js";
import {
  backfillFieldNameVetoNotices,
  cleanupResolvedFieldNameProposalMessages,
  refreshFieldNamesBulletin,
  refreshOpenFieldNameProposalMessages
} from "./services/fieldNameService.js";
import { getActiveTrailmarkByChannelId } from "./services/trailmarkService.js";
import {
  handleAllianceReportMessage,
  isCorpsOnlyReport,
  isAllianceGuildId,
  removeAllianceReportForDiscordMessage,
  syncCorpsReportAlliancePrivacyForMessage,
  syncCorpsAllyReportsChannelName
} from "./services/allianceIntelService.js";
import { UserFacingError, errorMessage } from "./utils/errors.js";

const commands = new Collection<string, BotCommand>() as CommandCollection;
for (const command of [
  pingCommand,
  rangerCommand,
  promotionCommand,
  trailmarkCommand,
  rosterCommand,
  recruitCommand,
  fundsCommand,
  intelCommand,
  strongboxCommand,
  allianceCommand,
  supplyCommand,
  dutyCommand,
  apprenticeshipCommand,
  fieldNameCommand
]) {
  commands.set(command.data.name, command);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message]
});

client.once("ready", (readyClient) => {
  console.log(`Keizaal Wayfinder logged in as ${readyClient.user.tag}`);
  startTrailmarkSessionExpirationJob(readyClient);
  startFieldNameResolutionJob(readyClient);
  const corpsGuild = readyClient.guilds.cache.get(env.DISCORD_GUILD_ID);
  if (corpsGuild) {
    void removeCorpsOnlyIntelReports(corpsGuild)
      .then((removed) => {
        if (removed > 0) {
          console.log(`Removed ${removed} Corps-only intel report record${removed === 1 ? "" : "s"}.`);
        }
      })
      .catch((error) => console.warn("Failed to clean up Corps-only intel reports:", error));
    void syncApprenticeshipPreferenceNotices(corpsGuild)
      .then((synchronized) => {
        if (synchronized > 0) {
          console.log(`Synchronized ${synchronized} apprenticeship matching notice${synchronized === 1 ? "" : "s"}.`);
        }
      })
      .catch((error) => console.warn("Failed to synchronize apprenticeship notices:", error));
    void refreshFieldNamesBulletin(corpsGuild)
      .catch((error) => console.warn("Failed to refresh Field Names bulletin:", error));
    void refreshOpenFieldNameProposalMessages(corpsGuild)
      .then((refreshed) => {
        if (refreshed > 0) {
          console.log(`Refreshed ${refreshed} open Field Name nomination${refreshed === 1 ? "" : "s"}.`);
        }
      })
      .catch((error) => console.warn("Failed to refresh open Field Name nominations:", error));
    void cleanupResolvedFieldNameProposalMessages(corpsGuild)
      .then((removed) => {
        if (removed > 0) {
          console.log(`Removed ${removed} resolved Field Name nomination${removed === 1 ? "" : "s"}.`);
        }
      })
      .catch((error) => console.warn("Failed to clean up resolved Field Name nominations:", error));
    void backfillFieldNameVetoNotices(corpsGuild)
      .then((notified) => {
        if (notified > 0) {
          console.log(`Sent ${notified} Field Name veto notice${notified === 1 ? "" : "s"}.`);
        }
      })
      .catch((error) => console.warn("Failed to backfill Field Name veto notices:", error));
    void syncIntelReportChannelNames(corpsGuild)
      .then((renamed) => {
        if (renamed > 0) {
          console.log(`Renamed ${renamed} intel report channel${renamed === 1 ? "" : "s"} with topic emoji.`);
        }
      })
      .catch((error) => console.warn("Failed to synchronize intel report channel names:", error));
    void syncCorpsAllyReportsChannelName(corpsGuild)
      .then((renamed) => {
        if (renamed) {
          console.log("Renamed the Corps Ally Reports channel with the teamwork emoji.");
        }
      })
      .catch((error) => console.warn("Failed to synchronize Corps Ally Reports channel name:", error));
  }
});

client.on("interactionCreate", (interaction) => {
  void handleInteraction(interaction).catch((error) => {
    void handleInteractionError(interaction, error).catch((replyError) => {
      console.error("Failed to report interaction error:", replyError);
    });
  });
});

client.on("guildMemberAdd", (member) => {
  if (member.guild.id !== env.DISCORD_GUILD_ID) {
    return;
  }
  void handleMemberJoin(member).catch((error) => console.error(`Failed to sync joined member ${member.id}:`, error));
});

client.on("guildMemberUpdate", (oldMember, newMember) => {
  if (newMember.guild.id !== env.DISCORD_GUILD_ID) {
    return;
  }
  void handleMemberUpdate(oldMember, newMember).catch((error) =>
    console.error(`Failed to sync updated member ${newMember.id}:`, error)
  );
});

client.on("guildMemberRemove", (member) => {
  if (member.guild.id !== env.DISCORD_GUILD_ID) {
    return;
  }
  void handleMemberRemove(member)
    .then(async (retired) => {
      if (retired) {
        await refreshStoredAssignmentsBoard(member.guild);
      }
    })
    .catch((error) => console.error(`Failed to retire departed member ${member.id}:`, error));
});

client.on("messageCreate", (message) => {
  if (!message.guild || message.author.bot) {
    return;
  }

  if (isAllianceGuildId(message.guild.id)) {
    void handleAllianceReportMessage(message).catch((error) => {
      console.warn(`Failed to synchronize Alliance report ${message.id}:`, error);
    });
    return;
  }

  if (message.guild.id !== env.DISCORD_GUILD_ID) {
    return;
  }

  const guild = message.guild;
  void recordMessageActivity(message.author.id, message.channelId)
    .then(async (result) => {
      if (result.reactivated) {
        await refreshStoredAssignmentsBoard(guild);
      }
      if (await handleStrongboxDropMessage(message)) {
        return;
      }
      if (await getActiveTrailmarkByChannelId(message.channelId)) {
        await maybeSendAtlasSharePreview(message).catch((error) => {
          console.warn(`Failed to preview Atlas share for message ${message.id}:`, error);
        });
      }
      await captureTrailmarkIntelReports(message);
    })
    .catch((error) => {
      console.warn(`Failed to record message activity for ${message.author.id}:`, error);
    });
});

client.on("messageDelete", (message) => {
  if (!message.guild) {
    return;
  }

  if (isAllianceGuildId(message.guild.id)) {
    void removeAllianceReportForDiscordMessage(message.client, message.channelId, message.id).catch((error) => {
      console.warn(`Failed to remove Alliance report ${message.id}:`, error);
    });
    return;
  }

  if (message.guild.id !== env.DISCORD_GUILD_ID) {
    return;
  }

  void removeIntelReportsForDiscordMessage({
    guild: message.guild,
    channelId: message.channelId,
    messageId: message.id
  }).catch((error) => {
    console.warn(`Failed to remove intel reports for deleted message ${message.id}:`, error);
  });
});

client.on("messageUpdate", (_oldMessage, newMessage) => {
  if (!newMessage.guild || newMessage.author?.bot) {
    return;
  }

  void (async () => {
    const message = newMessage.partial ? await newMessage.fetch() : newMessage;
    if (isAllianceGuildId(message.guildId)) {
      await handleAllianceReportMessage(message);
      return;
    }
    if (message.guildId === env.DISCORD_GUILD_ID) {
      if (isCorpsOnlyReport(message.content)) {
        await removeIntelReportsForDiscordMessage({
          guild: message.guild!,
          channelId: message.channelId,
          messageId: message.id
        });
      } else {
        await synchronizeEditedTrailmarkIntelReports(message);
        await syncCorpsReportAlliancePrivacyForMessage(message);
      }
    }
  })().catch((error) => {
    console.warn(`Failed to synchronize edited intel report ${newMessage.id}:`, error);
  });
});

async function handleInteraction(interaction: Interaction): Promise<void> {
  if (interaction.isAutocomplete()) {
    const command = commands.get(interaction.commandName);
    if (command?.autocomplete) {
      await command.autocomplete(interaction);
    }
    return;
  }

  if (interaction.isChatInputCommand()) {
    if (!interaction.guildId) {
      throw new UserFacingError("Wayfinder commands can only be used in a configured server.");
    }
    if (isAllianceGuildId(interaction.guildId)) {
      if (interaction.commandName !== "alliance" && interaction.commandName !== "ping") {
        throw new UserFacingError("That command is not available in the Ranger Alliance server.");
      }
    } else if (interaction.guildId === env.DISCORD_GUILD_ID) {
      await safelyRecordInteraction(interaction.user.id);
    } else {
      throw new UserFacingError("This server is not configured for Wayfinder.");
    }

    const command = commands.get(interaction.commandName);
    if (!command) {
      throw new UserFacingError("Unknown command.");
    }

    await command.execute(interaction);
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith("promotion:vote:")) {
    if (interaction.guildId !== env.DISCORD_GUILD_ID) {
      throw new UserFacingError("Promotion voting is only available in the Ranger Corps server.");
    }
    await safelyRecordInteraction(interaction.user.id);
    await handlePromotionButton(interaction);
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith("duty:review:")) {
    if (interaction.guildId !== env.DISCORD_GUILD_ID) {
      throw new UserFacingError("Duty applications are only available in the Ranger Corps server.");
    }
    await safelyRecordInteraction(interaction.user.id);
    await handleDutyButton(interaction);
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith("apprenticeship:")) {
    if (interaction.guildId === env.DISCORD_GUILD_ID) {
      await safelyRecordInteraction(interaction.user.id);
    }
    await handleApprenticeshipButton(interaction);
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith("fieldname:vote:")) {
    if (interaction.guildId && interaction.guildId !== env.DISCORD_GUILD_ID) {
      throw new UserFacingError("Field Name voting is only available in the Ranger Corps server.");
    }
    if (interaction.guildId === env.DISCORD_GUILD_ID) {
      await safelyRecordInteraction(interaction.user.id);
    }
    await handleFieldNameButton(interaction);
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("trailmark:select")) {
    if (interaction.guildId !== env.DISCORD_GUILD_ID) {
      throw new UserFacingError("Trailmarks are only available in the Ranger Corps server.");
    }
    await safelyRecordInteraction(interaction.user.id);
    await handleTrailmarkSelect(interaction);
  }
}

async function safelyRecordInteraction(discordUserId: string): Promise<void> {
  try {
    await recordBotInteraction(discordUserId);
  } catch (error) {
    console.warn(`Failed to record bot interaction for ${discordUserId}:`, error);
  }
}

async function handleInteractionError(interaction: Interaction, error: unknown): Promise<void> {
  const content = error instanceof UserFacingError ? error.message : `Something went wrong: ${errorMessage(error)}`;
  console.error("Interaction error:", error);

  if (!interaction.isRepliable()) {
    return;
  }

  await replyWithError(interaction, content);
}

async function replyWithError(interaction: RepliableInteraction, content: string): Promise<void> {
  if (interaction.deferred && !interaction.replied) {
    await interaction.editReply({ content, embeds: [], components: [] });
    return;
  }

  if (interaction.replied) {
    await interaction.followUp({ content, ephemeral: true });
    return;
  }

  await interaction.reply({ content, ephemeral: true });
}

await client.login(env.DISCORD_TOKEN);
