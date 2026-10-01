export type MatchableMember = {
  bioguide: string;
  name: string;
  first?: string;
  last?: string;
  nickname?: string;
  state: string;
  district: string;
  chamber: string;
};

export function normName(value: unknown): string;
export function matchMembers<T extends MatchableMember>(roster: T[], query: string, limit?: number): T[];
