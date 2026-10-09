import { createRouter } from "../router.mjs";
import { MANIFEST } from "./manifest.mjs";
import { handlers as system } from "./system.mjs";
import { handlers as congress } from "./congress.mjs";
import { handlers as markets } from "./markets.mjs";
import { handlers as corporate } from "./corporate.mjs";
import { handlers as world } from "./world.mjs";
import { handlers as relations } from "./relations.mjs";

export { MANIFEST };

export const handlers = { ...system, ...congress, ...markets, ...corporate, ...world, ...relations };

export const router = () => createRouter(MANIFEST, handlers);
