import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const transferRoot = join(projectRoot, "transfer");
const kitName = "elevation-builder-chatgpt-site-kit";
const kitRoot = join(transferRoot, kitName);
const sourceRoot = join(kitRoot, "source");
const archivePath = join(transferRoot, `${kitName}.zip`);

const sourcePaths = [
  "src/app",
  "src/config",
  "src/data",
  "src/domain",
  "src/pdf",
  "src/persistence",
  "src/transfer",
  "public/brand",
  "tests/calculation.test.ts",
  "tests/elevationBuilderTransfer.test.ts",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "index.html"
];

const documentation = [
  ["docs/CHATGPT_SITES_ELEVATION_BUILDER.md", "CHATGPT_SITES_INTEGRATION.md"],
  ["docs/CHATGPT_SITES_ELEVATION_BUILDER_PROMPT.md", "CHATGPT_SITES_BUILD_PROMPT.md"]
] as const;

async function copyToSource(relativePath: string) {
  const sourcePath = join(projectRoot, relativePath);
  const destinationPath = join(sourceRoot, relativePath);
  await mkdir(dirname(destinationPath), { recursive: true });
  await cp(sourcePath, destinationPath, { recursive: true });
}

async function copyDocumentation(sourcePath: string, destinationFileName: string) {
  const contents = await readFile(join(projectRoot, sourcePath), "utf8");
  await writeFile(join(kitRoot, destinationFileName), contents);
}

async function buildKit() {
  await rm(kitRoot, { recursive: true, force: true });
  await rm(archivePath, { force: true });
  await mkdir(sourceRoot, { recursive: true });

  await Promise.all(sourcePaths.map(copyToSource));
  await Promise.all(documentation.map(([sourcePath, destinationFileName]) => copyDocumentation(sourcePath, destinationFileName)));

  const packageJson = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8")) as { name: string; version: string };
  const manifest = {
    kitVersion: "1.0.0",
    sourceApplication: packageJson.name,
    sourceApplicationVersion: packageJson.version,
    generatedAt: new Date().toISOString(),
    entryPoint: "source/src/transfer/elevationBuilder.ts",
    visualReference: "source/src/app/App.tsx",
    includedCapabilities: [
      "React/SVG elevation and plan graphics",
      "measurement, row, column, corner, knee-wall, and lite-split geometry",
      "single and pair door options, glass, hardware, and thresholds",
      "validation flags, glass take-off, metal take-off, and quote calculations",
      "editable storefront, entrance, pricing, note, validation, and branding rule packs",
      "optional PDF and device-local persistence source"
    ]
  };

  await writeFile(join(kitRoot, "KIT_MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(
    join(kitRoot, "README.md"),
    "# Elevation Builder Kit\n\nStart with `CHATGPT_SITES_INTEGRATION.md`, then attach this ZIP and paste `CHATGPT_SITES_BUILD_PROMPT.md` into the receiving ChatGPT Sites task. The original calculator and React/SVG reference are under `source`.\n"
  );

  if (process.platform === "darwin") {
    execFileSync("ditto", ["-c", "-k", "--norsrc", "--keepParent", kitRoot, archivePath]);
  } else {
    execFileSync("zip", ["-r", "-q", archivePath, kitName], { cwd: transferRoot });
  }

  console.log(`Created ${kitRoot}`);
  console.log(`Created ${archivePath}`);
}

void buildKit();
