import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultBranding } from "../src/config/options";
import { defaultPlumbingConfig } from "../src/plumbing/config";
import { createSamplePlumbingJob } from "../src/plumbing/domain/jobs";
import { calculatePlumbingQuote } from "../src/plumbing/domain/quote";
import { buildPlumbingTakeoff } from "../src/plumbing/domain/takeoff";
import { buildMaterialCsv, generatePlumbingQuotePdf, generatePlumbingTakeoffPdf, plumbingFileName } from "../src/plumbing/pdf";

const outputDir = join(process.cwd(), "public", "sample-outputs", "plumbing");
await mkdir(outputDir, { recursive: true });

const job = createSamplePlumbingJob();
const takeoff = buildPlumbingTakeoff(job, defaultPlumbingConfig);
const quote = calculatePlumbingQuote(job, takeoff, defaultPlumbingConfig.pricing);

const outputs: [string, Blob | string][] = [
  [plumbingFileName(job, "takeoff"), generatePlumbingTakeoffPdf(job, takeoff, quote, defaultBranding)],
  [plumbingFileName(job, "quote"), generatePlumbingQuotePdf(job, quote, takeoff, defaultBranding)],
  [plumbingFileName(job, "materials"), buildMaterialCsv(takeoff)]
];

for (const [fileName, content] of outputs) {
  const data = typeof content === "string" ? content : Buffer.from(await content.arrayBuffer());
  await writeFile(join(outputDir, fileName), data);
}

console.log(`Generated ${outputs.length} plumbing sample outputs in ${outputDir}`);
console.log(`Sample total: $${quote.total.toFixed(2)} (${takeoff.fixtureCount} fixtures, ${quote.laborHours} labor hours)`);
