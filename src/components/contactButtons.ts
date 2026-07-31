import type { ButtonInteraction } from "discord.js";
import { handleContactButton as handleContactInteraction } from "../services/contactService.js";

export async function handleContactButton(interaction: ButtonInteraction): Promise<void> {
  await handleContactInteraction(interaction);
}
