import assert from "node:assert/strict";
import test from "node:test";
import { formatStructuredReportIntelContent } from "./structuredTrailmarkReportService.js";

test("general structured reports include fields used by Intel classification", () => {
  const content = formatStructuredReportIntelContent(
    "General",
    {
      subject: "Vampire activity near Morthal",
      location: "Morthal marsh",
      summary: "Two vampires were seen after dusk.",
      details: "They moved toward the old mill.",
      followUp: "Request a patrol.",
      commendation: null
    },
    ["Stewardess Vizeniya", "Group: Red Pike Bandits"],
    ["<@111> - Eliana Fenn", "<@222> - Ritoth Softrun"]
  );

  assert.match(content, /General Report: Vampire activity near Morthal/);
  assert.match(content, /Contacts \/ groups: Stewardess Vizeniya, Group: Red Pike Bandits/);
  assert.match(content, /Participating Rangers: <@111> - Eliana Fenn, <@222> - Ritoth Softrun/);
});

test("incident structured reports omit empty optional fields", () => {
  const content = formatStructuredReportIntelContent(
    "Incident",
    {
      subject: "Bandit ambush",
      location: null,
      summary: "A caravan was attacked.",
      details: null,
      followUp: null,
      commendation: null
    },
    [],
    []
  );

  assert.equal(content, "Incident Report: Bandit ambush\n\nA caravan was attacked.");
});
