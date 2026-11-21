import { fileURLToPath } from "node:url";

import { authorsPath } from "./content-paths.ts";

export const contents = fileURLToPath(new URL(`../${authorsPath}/`, import.meta.url));
export const cards = fileURLToPath(new URL("../.data/cards/", import.meta.url));
export const ogLogoPath = fileURLToPath(new URL("../src/assets/ccsko.png", import.meta.url));
