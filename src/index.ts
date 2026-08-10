import { createHash } from "node:crypto";
import { z } from "zod";

export const PIPELINE_DOCUMENT_VERSION = 1 as const;
export const PIPELINE_TARGETS = ["local", "cloud"] as const;
export const PIPELINE_STEP_USES = ["train", "evaluate", "compare"] as const;
export const PIPELINE_MAX_STEPS = 16 as const;
export const PIPELINE_MAX_TRAIN_STEPS = 1 as const;
export const PIPELINE_EVALUATORS = ["behavior"] as const;

export type PipelineTarget = (typeof PIPELINE_TARGETS)[number];
export type PipelineStepUse = (typeof PIPELINE_STEP_USES)[number];
export type PipelineArtifactKind = "model" | "report" | "comparison";

export interface PipelineArtifactReference {
  from: string;
}

export interface TrainPipelineStepInput {
  id: string;
  uses: "train";
  target?: PipelineTarget;
}

export interface EvaluatePipelineStepInput {
  id: string;
  uses: "evaluate";
  target?: PipelineTarget;
  with: {
    model: "base" | PipelineArtifactReference;
    evaluator?: "behavior";
  };
}

export interface ComparePipelineStepInput {
  id: string;
  uses: "compare";
  target?: PipelineTarget;
  with: {
    before: PipelineArtifactReference;
    after: PipelineArtifactReference;
  };
}

export type PipelineStepInput =
  | TrainPipelineStepInput
  | EvaluatePipelineStepInput
  | ComparePipelineStepInput;

export interface PipelineDocumentInput {
  version: 1;
  name?: string;
  target?: PipelineTarget;
  steps: PipelineStepInput[];
}

export type PipelineStep =
  | Omit<TrainPipelineStepInput, "target"> & { target: PipelineTarget }
  | Omit<EvaluatePipelineStepInput, "target" | "with"> & {
    target: PipelineTarget;
    with: { model: "base" | PipelineArtifactReference; evaluator: "behavior" };
  }
  | Omit<ComparePipelineStepInput, "target"> & { target: PipelineTarget };

export interface Pipeline {
  version: 1;
  name?: string;
  steps: PipelineStep[];
}

const stepIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_-]*$/, "step IDs must use lowercase letters, numbers, '-' or '_'");

export const pipelineArtifactReferenceSchema = z.object({
  from: z.string().regex(
    /^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_]*$/,
    "artifact references must use '<step-id>.<output>'",
  ),
}).strict();

const commonStep = {
  id: stepIdSchema,
  target: z.enum(PIPELINE_TARGETS).optional(),
};

export const trainPipelineStepSchema = z.object({
  ...commonStep,
  uses: z.literal("train"),
}).strict();

export const evaluatePipelineStepSchema = z.object({
  ...commonStep,
  uses: z.literal("evaluate"),
  with: z.object({
    model: z.union([z.literal("base"), pipelineArtifactReferenceSchema]),
    evaluator: z.literal("behavior").default("behavior"),
  }).strict(),
}).strict();

export const comparePipelineStepSchema = z.object({
  ...commonStep,
  uses: z.literal("compare"),
  with: z.object({
    before: pipelineArtifactReferenceSchema,
    after: pipelineArtifactReferenceSchema,
  }).strict(),
}).strict();

export const pipelineStepSchema = z.discriminatedUnion("uses", [
  trainPipelineStepSchema,
  evaluatePipelineStepSchema,
  comparePipelineStepSchema,
]);

export const pipelineDocumentSchema = z.object({
  version: z.literal(PIPELINE_DOCUMENT_VERSION),
  name: z.string().min(1).max(120).optional(),
  target: z.enum(PIPELINE_TARGETS).optional(),
  steps: z.array(pipelineStepSchema).min(1).max(PIPELINE_MAX_STEPS),
}).strict();

export const PIPELINE_STEP_CAPABILITIES = {
  train: { inputs: [], outputs: ["model"] },
  evaluate: { inputs: ["model"], outputs: ["report"] },
  compare: { inputs: ["report", "report"], outputs: ["comparison"] },
} as const satisfies Record<
  PipelineStepUse,
  { readonly inputs: readonly PipelineArtifactKind[]; readonly outputs: readonly PipelineArtifactKind[] }
>;

function parseReference(reference: PipelineArtifactReference): {
  producerId: string;
  output: string;
} {
  const separator = reference.from.lastIndexOf(".");
  return {
    producerId: reference.from.slice(0, separator),
    output: reference.from.slice(separator + 1),
  };
}

function assertPriorOutput(
  consumerId: string,
  reference: PipelineArtifactReference,
  expectedOutput: PipelineArtifactKind,
  seen: ReadonlyMap<string, PipelineStep>,
): void {
  const { producerId, output } = parseReference(reference);
  const producer = seen.get(producerId);
  if (!producer) {
    throw new Error(
      `Pipeline step '${consumerId}' references '${reference.from}', but artifacts must come from a prior step.`,
    );
  }
  const producerOutputs: readonly PipelineArtifactKind[] =
    PIPELINE_STEP_CAPABILITIES[producer.uses].outputs;
  if (!producerOutputs.includes(output as PipelineArtifactKind)) {
    throw new Error(`Pipeline step '${producer.id}' (${producer.uses}) does not produce '${output}'.`);
  }
  if (output !== expectedOutput) {
    throw new Error(`Pipeline step '${consumerId}' requires a '${expectedOutput}' artifact, not '${output}'.`);
  }
}

/** Parse and normalize a portable Pipeline v1 document without executing it. */
export function parsePipeline(input: unknown): Pipeline {
  const parsed = pipelineDocumentSchema.parse(input);
  const seen = new Map<string, PipelineStep>();
  const steps: PipelineStep[] = [];
  let trainCount = 0;

  for (const inputStep of parsed.steps) {
    const target = inputStep.target ?? parsed.target;
    if (!target) {
      throw new Error(`Pipeline step '${inputStep.id}' needs a target or a pipeline default target.`);
    }

    const step = { ...inputStep, target } as PipelineStep;
    if (seen.has(step.id)) {
      throw new Error(`Pipeline step IDs must be unique; '${step.id}' is duplicated.`);
    }

    if (step.uses === "train") {
      trainCount += 1;
      if (trainCount > PIPELINE_MAX_TRAIN_STEPS) {
        throw new Error(
          "Pipeline v1 supports at most one train step because model artifacts are run-scoped.",
        );
      }
    } else if (step.uses === "evaluate" && step.with.model !== "base") {
      assertPriorOutput(step.id, step.with.model, "model", seen);
    } else if (step.uses === "compare") {
      if (step.with.before.from === step.with.after.from) {
        throw new Error(`Pipeline compare step '${step.id}' requires two distinct report references.`);
      }
      assertPriorOutput(step.id, step.with.before, "report", seen);
      assertPriorOutput(step.id, step.with.after, "report", seen);
    }

    seen.set(step.id, step);
    steps.push(step);
  }

  return {
    version: PIPELINE_DOCUMENT_VERSION,
    ...(parsed.name ? { name: parsed.name } : {}),
    steps,
  };
}

/** Require every normalized step to execute in the hosted cloud boundary. */
export function validateCloudPipeline(input: unknown): Pipeline {
  const pipeline = parsePipeline(input);
  const localStep = pipeline.steps.find((step) => step.target === "local");
  if (localStep) {
    throw new Error(
      `Pipeline step '${localStep.id}' targets local execution. Mixed pipelines must be coordinated by the CLI; the hosted runner accepts cloud steps only.`,
    );
  }
  return pipeline;
}

/** The named compatibility recipe retained by both local and cloud executors. */
export function canonicalPipeline(target: PipelineTarget): Pipeline {
  return {
    version: PIPELINE_DOCUMENT_VERSION,
    name: `default-${target}`,
    steps: [
      {
        id: "baseline",
        uses: "evaluate",
        target,
        with: { model: "base", evaluator: "behavior" },
      },
      { id: "train", uses: "train", target },
      {
        id: "candidate",
        uses: "evaluate",
        target,
        with: { model: { from: "train.model" }, evaluator: "behavior" },
      },
      {
        id: "compare",
        uses: "compare",
        target,
        with: {
          before: { from: "baseline.report" },
          after: { from: "candidate.report" },
        },
      },
    ],
  };
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortValue(entry)]),
  );
}

/** Stable normalized JSON used for cross-repository hashes and fixtures. */
export function canonicalJson(input: unknown): string {
  return JSON.stringify(sortValue(parsePipeline(input)));
}

/** SHA-256 identity of the normalized portable pipeline document. */
export function pipelineHash(input: unknown): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}
