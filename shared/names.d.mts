export function norm(value: unknown): string;
export function ldaMatches(names: unknown[], targets: string[]): string[];
export function districtCode(state: string | null | undefined, cd: { BASENAME?: unknown } | null | undefined): string | null;
export function contractParentMatch(token: unknown, parent: unknown): boolean;
export function pacsByOrg(lines: Iterable<string>): Map<string, Set<string>>;
