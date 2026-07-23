import type { ButtonInteraction, ModalSubmitInteraction } from "discord.js";
import {
  handleFieldNameButton as handleFieldNameInteraction,
  handleFieldNameSuggestionModal as handleFieldNameSuggestionModalInteraction
} from "../services/fieldNameService.js";

export async function handleFieldNameButton(interaction: ButtonInteraction): Promise<void> {
  await handleFieldNameInteraction(interaction);
}

export async function handleFieldNameSuggestionModal(interaction: ModalSubmitInteraction): Promise<void> {
  await handleFieldNameSuggestionModalInteraction(interaction);
}
