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
import { generateDrawingPackagePdf, pdfFileName } from "../src/pdf/pdfGenerator";

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
const manifest = [];

for (const elevation of samples) {
  const packageBlob = generateDrawingPackagePdf(elevation, seedJob, defaultBranding);
  const packageName = pdfFileName(seedJob, elevation, "package");

  await writeFile(join(outputDir, packageName), Buffer.from(await packageBlob.arrayBuffer()));

  manifest.push({
    elevationId: elevation.id,
    elevationName: elevation.name,
    files: [packageName],
    generatedAt: new Date().toISOString()
  });
}

await writeFile(join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2));

console.log(`Generated ${manifest.length} sample PDF packages in ${outputDir}`);
