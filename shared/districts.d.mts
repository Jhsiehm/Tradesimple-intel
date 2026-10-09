export const STATES: Record<string, { fips: string; name: string; seats: number; delegate?: boolean }>;
export function districtGeoid(code: string | null | undefined): string;
export function districtFromGeoid(geoid: string | null | undefined): string | null;
export function parseDistrict(text: string | null | undefined): string | null;
export function districtName(code: string | null | undefined): string;
export function memberPlace(m: { chamber?: string | null; state?: string | null; district?: string | number | null }): string;
