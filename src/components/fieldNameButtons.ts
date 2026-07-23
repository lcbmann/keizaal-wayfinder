import type { ButtonInteraction } from "discord.js";
import { handleFieldNameButton as handleFieldNameInteraction } from "../services/fieldNameService.js";

export async function handleFieldNameButton(interaction: ButtonInteraction): Promise<void> {
  await handleFieldNameInteraction(interaction);
}
