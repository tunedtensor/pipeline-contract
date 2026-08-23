import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { parsePipeline, pipelineHash } from "../src/index.js";

function loadJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(resolve(process.cwd(), relativePath), "utf8"));
}

describe("published schema and golden fixtures", () => {
  it("validates every portable input fixture against the JSON Schema", () => {
    const schema = loadJson("schema/pipeline-v1.schema.json") as Record<string, unknown>;
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

    for (const name of ["canonical-cloud", "evaluation-only-local", "mixed-placement", "canonical-foundation"]) {
      const input = loadJson(`fixtures/${name}.input.json`);
      expect(validate(input), `${name}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });

  it("matches normalized fixtures and fixed cross-repository hashes", () => {
    const hashes = loadJson("fixtures/hashes.json") as Record<string, string>;

    for (const name of ["canonical-cloud", "evaluation-only-local", "mixed-placement", "canonical-foundation"]) {
      const input = loadJson(`fixtures/${name}.input.json`);
      const normalized = loadJson(`fixtures/${name}.normalized.json`);
      expect(parsePipeline(input)).toEqual(normalized);
      expect(pipelineHash(input)).toBe(hashes[name]);
    }
  });

  it("keeps semantic-invalid fixtures outside JSON Schema execution policy", () => {
    const input = loadJson("fixtures/invalid-forward-reference.input.json");
    expect(() => parsePipeline(input)).toThrow(/prior step/i);
  });
});
