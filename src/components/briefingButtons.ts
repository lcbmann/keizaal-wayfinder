import type { ButtonInteraction } from "discord.js";
import { handleBriefingCollectButton } from "../services/briefingService.js";

export async function handleBriefingButton(interaction: ButtonInteraction): Promise<void> {
  await handleBriefingCollectButton(interaction);
}
