import type { Player, Rules } from "../../../team-generator";

export const SAMPLE_NAMES: Record<string, string> = {
  sean: "Sean",
  dave: "Dave",
  mo: "Mo",
  priya: "Priya",
  tom: "Tom",
  luca: "Luca",
  jess: "Jess",
  ollie: "Ollie",
  ben: "Ben",
  kai: "Kai",
};

export const SAMPLE_PLAYERS: Player[] = [
  { id: "sean", rating: 72, position: "attacker" },
  { id: "dave", rating: 48, position: "defender", happyInGoal: true },
  { id: "mo", rating: 81, position: "attacker" },
  { id: "priya", rating: 60, position: "defender" },
  { id: "tom", rating: 35, happyInGoal: true },
  { id: "luca", rating: 66, position: "defender" },
  { id: "jess", rating: 55 },
  { id: "ollie", rating: 42, position: "attacker" },
  { id: "ben", rating: 58 },
  { id: "kai", rating: 77, position: "GK" },
];

export const SAMPLE_RULES: Rules = {
  together: [["ben", "ollie"]],
  apart: [["mo", "sean"]],
};
