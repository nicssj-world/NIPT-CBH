import {readFileSync} from "node:fs";
import {assertProcessBoundary} from "./environment-boundary.mjs";
if(process.env.DATABASE_URL_FILE)process.env.DATABASE_URL=readFileSync(process.env.DATABASE_URL_FILE,"utf8").trim();
if(process.env.SYNTHETIC_SEED_PASSWORD_FILE)process.env.SYNTHETIC_SEED_PASSWORD=readFileSync(process.env.SYNTHETIC_SEED_PASSWORD_FILE,"utf8").trim();
// Staging/Production boundary: a service whose configuration reaches outside its own environment never starts.
assertProcessBoundary(process.env);
