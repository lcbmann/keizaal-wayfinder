import assert from "node:assert/strict";
import test from "node:test";
import { ButtonStyle } from "discord.js";
import {
  STRONGBOX_BUTTON_PREFIX,
  STRONGBOX_MODAL_PREFIX,
  parseStrongboxFormDestination,
  strongboxDropActionRow,
  strongboxSubmissionModal
} from "./strongboxFormService.js";

test("Strongbox form routes accept only the two supported destinations", () => {
  assert.equal(parseStrongboxFormDestination(`${STRONGBOX_BUTTON_PREFIX}agents`, STRONGBOX_BUTTON_PREFIX), "agents");
  assert.equal(parseStrongboxFormDestination(`${STRONGBOX_MODAL_PREFIX}marshals`, STRONGBOX_MODAL_PREFIX), "marshals");
  assert.equal(parseStrongboxFormDestination(`${STRONGBOX_BUTTON_PREFIX}agents:extra`, STRONGBOX_BUTTON_PREFIX), null);
  assert.equal(parseStrongboxFormDestination("strongbox:unknown", STRONGBOX_BUTTON_PREFIX), null);
});

test("Strongbox panel puts the preferred Agent route first", () => {
  const row = strongboxDropActionRow().toJSON();
  const buttons = row.components as Array<{ custom_id?: string; label?: string; style?: number }>;
  assert.deepEqual(buttons.map(({ custom_id }) => custom_id), [
    `${STRONGBOX_BUTTON_PREFIX}agents`,
    `${STRONGBOX_BUTTON_PREFIX}marshals`
  ]);
  assert.equal(buttons[0]?.label, "Send Field Intel to Agents");
  assert.equal(buttons[0]?.style, ButtonStyle.Primary);
});

test("Strongbox forms collect a subject, message, and optional evidence links", () => {
  const modal = strongboxSubmissionModal("agents").toJSON();
  const rows = modal.components as Array<{
    components: Array<{ custom_id?: string; required?: boolean; max_length?: number }>;
  }>;
  const inputs = rows.flatMap((row) => row.components[0] ? [row.components[0]] : []);
  assert.equal(modal.custom_id, `${STRONGBOX_MODAL_PREFIX}agents`);
  assert.equal(modal.title, "Report Sensitive Field Intel");
  assert.deepEqual(inputs.map(({ custom_id }) => custom_id), ["subject", "message", "references"]);
  assert.deepEqual(inputs.map(({ required }) => required), [true, true, false]);
  assert.deepEqual(inputs.map(({ max_length }) => max_length), [150, 4000, 1000]);
});
