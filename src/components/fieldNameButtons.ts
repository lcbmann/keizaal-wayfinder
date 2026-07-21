import type { ButtonInteraction } from "discord.js";
import { handleFieldNameVoteButton } from "../services/fieldNameService.js";

export async function handleFieldNameButton(interaction: ButtonInteraction): Promise<void> {
  await handleFieldNameVoteButton(interaction);
}
