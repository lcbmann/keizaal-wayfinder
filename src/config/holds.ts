export const HOLDS = [
  "Eastmarch",
  "Falkreath",
  "Haafingar",
  "Hjaalmarch",
  "The Pale",
  "The Reach",
  "The Rift",
  "Whiterun",
  "Winterhold"
] as const;

export type Hold = (typeof HOLDS)[number];

export function isHold(value: string): value is Hold {
  return HOLDS.includes(value as Hold);
}
