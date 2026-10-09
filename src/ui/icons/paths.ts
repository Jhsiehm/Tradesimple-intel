import type { Glyph, IconName } from "./names";
import { NAV } from "./nav";
import { CONGRESS } from "./congress";
import { MARKETS } from "./markets";
import { MAP } from "./map";
import { ACTIONS } from "./actions";

export const PATHS: Record<IconName, Glyph> = { ...NAV, ...CONGRESS, ...MARKETS, ...MAP, ...ACTIONS };
