export type NavRegion = {
  id: string;
  name: string;
  group: "World" | "Continents" | "Regions";
  lon: number;
  lat: number;
  zoom: number;
  live: boolean;
  /** West, south, east, north. West > east crosses the date line. */
  bounds?: [number, number, number, number];
};
export const NAV_REGIONS: NavRegion[];
