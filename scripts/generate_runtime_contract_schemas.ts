import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  RUNTIME_PROTOCOL_SCHEMA_FAMILY,
  RUNTIME_PROTOCOL_SCHEMA_REGISTRY,
  RUNTIME_PROTOCOL_SCHEMA_VERSION,
} from "../src/runtime/contracts/index.js";

const OUTPUT_DIR = path.resolve("docs/runtime-contracts/schemas");
const MANIFEST_PATH = path.resolve(
  "docs/runtime-contracts/schema-manifest.v1.json",
);

async function writeSchemaFile(input: {
  schema: z.ZodType;
  schemaId: string;
  outputFile: string;
}): Promise<string> {
  const schemaDocument = z.toJSONSchema(input.schema);
  const finalDocument = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: input.schemaId,
    ...schemaDocument,
  };
  const outputPath = path.join(OUTPUT_DIR, input.outputFile);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(finalDocument, null, 2)}\n`);
  console.log(`wrote ${outputPath}`);
  return outputPath;
}

async function writeManifest(): Promise<string> {
  const manifest = {
    schemaFamily: RUNTIME_PROTOCOL_SCHEMA_FAMILY,
    schemaVersion: RUNTIME_PROTOCOL_SCHEMA_VERSION,
    schemas: Object.entries(RUNTIME_PROTOCOL_SCHEMA_REGISTRY).map(
      ([name, entry]) => ({
        name,
        schemaId: entry.schemaId,
        schemaFile: `docs/runtime-contracts/schemas/${entry.outputFile}`,
      }),
    ),
    rustCodegenHook: {
      intendedConsumer: "future crates/protocol/build.rs or serde codegen step",
      sourceOfTruth: "docs/runtime-contracts/schemas/*.json",
    },
  };
  await fs.mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
  await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`wrote ${MANIFEST_PATH}`);
  return MANIFEST_PATH;
}

async function formatFiles(filePaths: string[]): Promise<void> {
  if (filePaths.length === 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn("bunx", ["biome", "format", "--write", ...filePaths], {
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`biome format failed with exit code ${code ?? -1}`));
    });
  });
}

async function main(): Promise<void> {
  const generatedPaths: string[] = [];
  for (const entry of Object.values(RUNTIME_PROTOCOL_SCHEMA_REGISTRY)) {
    generatedPaths.push(await writeSchemaFile(entry));
  }
  generatedPaths.push(await writeManifest());
  await formatFiles(generatedPaths);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
