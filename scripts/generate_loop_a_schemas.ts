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

async function main(): Promise<void> {
  const entries = Object.values(LOOP_A_SCHEMA_REGISTRY);
  for (const entry of entries) {
    await writeSchemaFile(entry);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
