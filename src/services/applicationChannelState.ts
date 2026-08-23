export const MARSHAL_APPLICATION_CHANNEL_STATE_KEY = "marshal-applications-channel";
export const CAPTAIN_APPLICATION_CHANNEL_STATE_KEY = "captain-applications-channel";

export function leadershipApplicationChannelStateKey(kind: "Marshal" | "Captain"): string {
  return kind === "Marshal"
    ? MARSHAL_APPLICATION_CHANNEL_STATE_KEY
    : CAPTAIN_APPLICATION_CHANNEL_STATE_KEY;
}
