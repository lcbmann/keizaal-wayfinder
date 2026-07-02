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
import type { BotCommand, CommandCollection } from "./commands/types.js";
import { handlePromotionButton } from "./components/promotionButtons.js";
import { handleTrailmarkSelect } from "./components/trailmarkSelect.js";
import { handleMemberJoin, handleMemberUpdate } from "./jobs/syncMemberRoster.js";
import { startTrailmarkSessionExpirationJob } from "./jobs/expireTrailmarkSessions.js";
import { recordBotInteraction, recordMessageActivity } from "./services/activityService.js";
import { refreshStoredAssignmentsBoard } from "./services/assignmentBoardService.js";
import { captureTrailmarkIntelReports, removeIntelReportsForDiscordMessage } from "./services/intelService.js";
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
  intelCommand
]) {
  commands.set(command.data.name, command);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message]
});

client.once("ready", (readyClient) => {
  console.log(`Keizaal Wayfinder logged in as ${readyClient.user.tag}`);
  startTrailmarkSessionExpirationJob(readyClient);
});

client.on("interactionCreate", (interaction) => {
  void handleInteraction(interaction).catch((error) => {
    void handleInteractionError(interaction, error).catch((replyError) => {
      console.error("Failed to report interaction error:", replyError);
    });
  });
});

client.on("guildMemberAdd", (member) => {
  void handleMemberJoin(member).catch((error) => console.error(`Failed to sync joined member ${member.id}:`, error));
});

client.on("guildMemberUpdate", (oldMember, newMember) => {
  void handleMemberUpdate(oldMember, newMember).catch((error) =>
    console.error(`Failed to sync updated member ${newMember.id}:`, error)
  );
});

client.on("messageCreate", (message) => {
  if (!message.guild || message.author.bot) {
    return;
  }

  const guild = message.guild;
  void recordMessageActivity(message.author.id, message.channelId)
    .then(async (result) => {
      if (result.reactivated) {
        await refreshStoredAssignmentsBoard(guild);
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

  void removeIntelReportsForDiscordMessage({
    guild: message.guild,
    channelId: message.channelId,
    messageId: message.id
  }).catch((error) => {
    console.warn(`Failed to remove intel reports for deleted message ${message.id}:`, error);
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
    await safelyRecordInteraction(interaction.user.id);
    const command = commands.get(interaction.commandName);
    if (!command) {
      throw new UserFacingError("Unknown command.");
    }

    await command.execute(interaction);
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith("promotion:vote:")) {
    await safelyRecordInteraction(interaction.user.id);
    await handlePromotionButton(interaction);
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("trailmark:select")) {
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
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({ content, ephemeral: true });
    return;
  }

  await interaction.reply({ content, ephemeral: true });
}

await client.login(env.DISCORD_TOKEN);
