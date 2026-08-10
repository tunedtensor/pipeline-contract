import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  canonicalPipeline,
  parsePipeline,
  PIPELINE_STEP_CAPABILITIES,
  pipelineHash,
  validateCloudPipeline,
} from "../src/index.js";

const evaluationOnly = {
  version: 1,
  target: "cloud",
  steps: [
    {
      id: "baseline",
      uses: "evaluate",
      with: { model: "base" },
    },
  ],
};

describe("Pipeline v1 contract", () => {
  it("normalizes targets and the built-in evaluator", () => {
    expect(parsePipeline(evaluationOnly)).toEqual({
      version: 1,
      steps: [
        {
          id: "baseline",
          uses: "evaluate",
          target: "cloud",
          with: { model: "base", evaluator: "behavior" },
        },
      ],
    });
  });

  it("publishes bounded input and output capabilities", () => {
    expect(PIPELINE_STEP_CAPABILITIES).toEqual({
      train: { inputs: [], outputs: ["model"] },
      evaluate: { inputs: ["model"], outputs: ["report"] },
      compare: { inputs: ["report", "report"], outputs: ["comparison"] },
    });
  });

  it("produces deterministic canonical JSON and hashes", () => {
    const reordered = {
      steps: evaluationOnly.steps,
      target: "cloud",
      version: 1,
    };

    expect(canonicalJson(evaluationOnly)).toBe(canonicalJson(reordered));
    expect(pipelineHash(evaluationOnly)).toBe(pipelineHash(reordered));
    expect(pipelineHash(evaluationOnly)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("provides the named compatibility pipeline for each executor", () => {
    const local = canonicalPipeline("local");
    const cloud = canonicalPipeline("cloud");

    expect(local.steps.map((step) => step.uses)).toEqual([
      "evaluate",
      "train",
      "evaluate",
      "compare",
    ]);
    expect(local.steps.every((step) => step.target === "local")).toBe(true);
    expect(cloud.steps.every((step) => step.target === "cloud")).toBe(true);
    expect(cloud.steps[2]).toMatchObject({
      with: { model: { from: "train.model" }, evaluator: "behavior" },
    });
  });

  it("permits a portable mixed-placement plan but rejects it at the cloud boundary", () => {
    const mixed = {
      version: 1,
      steps: [
        { id: "train", uses: "train", target: "local" },
        {
          id: "candidate",
          uses: "evaluate",
          target: "cloud",
          with: { model: { from: "train.model" } },
        },
      ],
    };

    expect(parsePipeline(mixed).steps.map((step) => step.target)).toEqual(["local", "cloud"]);
    expect(() => validateCloudPipeline(mixed)).toThrow(/targets local execution/);
  });

  it.each([
    ["unsupported version", { ...evaluationOnly, version: 2 }, /version/i],
    ["empty pipeline", { version: 1, target: "cloud", steps: [] }, /steps/i],
    [
      "more than sixteen steps",
      {
        version: 1,
        target: "cloud",
        steps: Array.from({ length: 17 }, (_, index) => ({ id: `eval_${index}`, uses: "evaluate", with: { model: "base" } })),
      },
      /steps/i,
    ],
    [
      "duplicate IDs",
      {
        version: 1,
        target: "cloud",
        steps: [
          { id: "train", uses: "train" },
          { id: "train", uses: "train" },
        ],
      },
      /unique|duplicate/i,
    ],
    ["uppercase ID", { version: 1, target: "cloud", steps: [{ id: "Train", uses: "train" }] }, /lowercase|invalid/i],
    [
      "long ID",
      { version: 1, target: "cloud", steps: [{ id: `a${"b".repeat(64)}`, uses: "train" }] },
      /64|too big/i,
    ],
    ["missing target", { version: 1, steps: [{ id: "train", uses: "train" }] }, /needs a target/i],
    [
      "multiple training steps",
      {
        version: 1,
        target: "cloud",
        steps: [
          { id: "train_a", uses: "train" },
          { id: "train_b", uses: "train" },
        ],
      },
      /at most one train/i,
    ],
    [
      "forward reference",
      {
        version: 1,
        target: "cloud",
        steps: [
          { id: "candidate", uses: "evaluate", with: { model: { from: "train.model" } } },
          { id: "train", uses: "train" },
        ],
      },
      /prior step/i,
    ],
    [
      "wrong consumer input kind",
      {
        version: 1,
        target: "cloud",
        steps: [
          { id: "train", uses: "train" },
          {
            id: "compare",
            uses: "compare",
            with: { before: { from: "train.model" }, after: { from: "train.model" } },
          },
        ],
      },
      /report/i,
    ],
    [
      "same report comparison",
      {
        version: 1,
        target: "cloud",
        steps: [
          { id: "baseline", uses: "evaluate", with: { model: "base" } },
          {
            id: "compare",
            uses: "compare",
            with: { before: { from: "baseline.report" }, after: { from: "baseline.report" } },
          },
        ],
      },
      /distinct/i,
    ],
    [
      "unsupported evaluator",
      {
        version: 1,
        target: "cloud",
        steps: [{ id: "baseline", uses: "evaluate", with: { model: "base", evaluator: "custom" } }],
      },
      /behavior|invalid/i,
    ],
  ])("rejects %s", (_name, input, message) => {
    expect(() => parsePipeline(input)).toThrow(message as RegExp);
  });
});
