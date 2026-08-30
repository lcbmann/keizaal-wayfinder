import type { ButtonInteraction } from "discord.js";
import { handleAssignmentButton as handleManagedAssignmentButton } from "../services/managedAssignmentService.js";

export async function handleAssignmentButton(interaction: ButtonInteraction): Promise<void> {
  await handleManagedAssignmentButton(interaction);
}
