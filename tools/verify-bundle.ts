import {readFile} from "node:fs/promises";
import {verifyBundle} from "../packages/operations/bundle";
if(!process.argv[2]||!process.argv[3])throw Error("Usage: verify-bundle BUNDLE_DIRECTORY TRUSTED_PUBLIC_KEY_FILE");await verifyBundle(process.argv[2],await readFile(process.argv[3],"utf8"));process.stdout.write("Bundle signature, checksums and exact file set PASS.\n");
