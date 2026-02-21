import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { LOOP_A_SCHEMA_REGISTRY } from "../src/loops/contracts/loop_a.js";

const OUTPUT_DIR = path.resolve("src/loops/contracts/json");

async function writeSchemaFile(input: {
  schema: z.ZodType;
  schemaId: string;
  outputFile: string;
}): Promise<void> {
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
}

async function formatSchemaFiles(filePaths: string[]): Promise<void> {
  if (filePaths.length === 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn("bunx", ["biome", "format", "--write", ...filePaths], {
      stdio: "inherit",
    });

    child.on("error", (error) => {
      reject(error);
    });

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
  const entries = Object.values(LOOP_A_SCHEMA_REGISTRY);
  const generatedPaths: string[] = [];
  for (const entry of entries) {
    await writeSchemaFile(entry);
    generatedPaths.push(path.join(OUTPUT_DIR, entry.outputFile));
  }
  await formatSchemaFiles(generatedPaths);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
