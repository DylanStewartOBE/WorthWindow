import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  defaultBranding,
  defaultEntranceRulePack,
  defaultNoteLibrary,
  defaultStorefrontRulePack,
  defaultValidationLibrary
} from "../src/config/options";
import { calculateElevation } from "../src/domain/calculate";
import { noDoorSeedInput, pairDoorSeedInput, seedJob } from "../src/data/seed";
import { generateJobDrawingPackagePdf, pdfFileName } from "../src/pdf/pdfGenerator";

const context = {
  storefrontRulePack: defaultStorefrontRulePack,
  entranceRulePack: defaultEntranceRulePack,
  noteLibrary: defaultNoteLibrary,
  validationLibrary: defaultValidationLibrary
};

const outputDir = join(process.cwd(), "public", "sample-outputs");
await mkdir(outputDir, { recursive: true });

const existingArtifacts = await readdir(outputDir);
await Promise.all(
  existingArtifacts
    .filter((fileName) => fileName.endsWith(".pdf") || fileName === "manifest.json")
    .map((fileName) => rm(join(outputDir, fileName), { force: true }))
);

const samples = [pairDoorSeedInput, noDoorSeedInput].map((input) => calculateElevation(input, context));
const packageBlob = generateJobDrawingPackagePdf(samples, seedJob, defaultBranding);
const packageName = pdfFileName(seedJob, null, "package");

await writeFile(join(outputDir, packageName), Buffer.from(await packageBlob.arrayBuffer()));

const manifest = [{
  elevationIds: samples.map((elevation) => elevation.id),
  elevationNames: samples.map((elevation) => elevation.name),
  files: [packageName],
  generatedAt: new Date().toISOString()
}];

await writeFile(join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2));

console.log(`Generated ${manifest.length} sample PDF package in ${outputDir}`);
