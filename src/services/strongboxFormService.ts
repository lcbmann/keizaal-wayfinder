import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";

export const STRONGBOX_BUTTON_PREFIX = "strongbox:form:";
export const STRONGBOX_MODAL_PREFIX = "strongbox:form-submit:";

export type StrongboxFormDestination = "agents" | "marshals";

export function strongboxDropActionRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${STRONGBOX_BUTTON_PREFIX}agents`)
      .setLabel("Send Field Intel to Agents")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${STRONGBOX_BUTTON_PREFIX}marshals`)
      .setLabel("Send Internal Issue to Marshals")
      .setStyle(ButtonStyle.Secondary)
  );
}

export function strongboxSubmissionModal(destination: StrongboxFormDestination): ModalBuilder {
  const agents = destination === "agents";
  return new ModalBuilder()
    .setCustomId(`${STRONGBOX_MODAL_PREFIX}${destination}`)
    .setTitle(agents ? "Report Sensitive Field Intel" : "Contact the Corps Marshals")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("subject")
          .setLabel(agents ? "Subject of the field report" : "Subject of the internal issue")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(150)
          .setPlaceholder(agents ? "Person, group, threat, or event" : "Briefly identify the Corps issue")
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("message")
          .setLabel(agents ? "Sensitive IC information" : "Message for the Marshals")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(4000)
          .setPlaceholder(agents
            ? "Describe what happened, who was involved, and where or when."
            : "Describe the issue, who is involved, and any help you need.")
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("references")
          .setLabel(agents ? "Evidence or secure links (optional)" : "Links or references (optional)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(1000)
          .setPlaceholder("Add any relevant Discord message, image, document, or Atlas links.")
      )
    );
}

export function parseStrongboxFormDestination(customId: string, prefix: string): StrongboxFormDestination | null {
  const destination = customId.startsWith(prefix) ? customId.slice(prefix.length) : "";
  return destination === "agents" || destination === "marshals" ? destination : null;
}
