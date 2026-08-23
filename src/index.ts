import { createHash } from "node:crypto";
import { z } from "zod";

export const PIPELINE_DOCUMENT_VERSION = 1 as const;
export const PIPELINE_TARGETS = ["local", "cloud"] as const;
export const PIPELINE_ENGINES = ["foundation"] as const;
export const PIPELINE_STEP_USES = [
  "train",
  "evaluate",
  "compare",
  "tokenize",
  "pretrain",
  "finetune",
  "rl",
] as const;
export const PIPELINE_MAX_STEPS = 16 as const;
export const PIPELINE_MAX_TRAIN_STEPS = 1 as const;
export const PIPELINE_EVALUATORS = ["behavior", "bpb", "chat", "inference"] as const;
export const PIPELINE_ADAPTER_EVALUATORS = ["behavior"] as const;
export const PIPELINE_FOUNDATION_EVALUATORS = ["bpb", "chat", "inference"] as const;
export const PIPELINE_FOUNDATION_USES = ["tokenize", "pretrain", "finetune", "rl"] as const;

export type PipelineTarget = (typeof PIPELINE_TARGETS)[number];
export type PipelineEngine = (typeof PIPELINE_ENGINES)[number];
export type PipelineStepUse = (typeof PIPELINE_STEP_USES)[number];
export type PipelineEvaluator = (typeof PIPELINE_EVALUATORS)[number];
export type PipelineArtifactKind = "tokenizer" | "model" | "report" | "comparison";

export interface PipelineArtifactReference {
  from: string;
}

export interface PipelineRuntime {
  engine: "foundation";
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
    evaluator?: PipelineEvaluator;
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

export interface TokenizePipelineStepInput {
  id: string;
  uses: "tokenize";
  target?: PipelineTarget;
  with?: {
    vocabSize?: number;
    maxChars?: number;
  };
}

export interface PretrainPipelineStepInput {
  id: string;
  uses: "pretrain";
  target?: PipelineTarget;
  with: {
    tokenizer: PipelineArtifactReference;
    depth?: number;
    steps?: number;
    batchSize?: number;
    sequenceLength?: number;
    nprocPerNode?: number;
  };
}

export interface FinetunePipelineStepInput {
  id: string;
  uses: "finetune";
  target?: PipelineTarget;
  with: {
    model: PipelineArtifactReference;
    steps?: number;
    batchSize?: number;
  };
}

export interface RlPipelineStepInput {
  id: string;
  uses: "rl";
  target?: PipelineTarget;
  with: {
    model: PipelineArtifactReference;
    steps?: number;
  };
}

export type PipelineStepInput =
  | TrainPipelineStepInput
  | EvaluatePipelineStepInput
  | ComparePipelineStepInput
  | TokenizePipelineStepInput
  | PretrainPipelineStepInput
  | FinetunePipelineStepInput
  | RlPipelineStepInput;

export interface PipelineDocumentInput {
  version: 1;
  name?: string;
  target?: PipelineTarget;
  runtime?: PipelineRuntime;
  steps: PipelineStepInput[];
}

export type PipelineStep =
  | Omit<TrainPipelineStepInput, "target"> & { target: PipelineTarget }
  | Omit<EvaluatePipelineStepInput, "target" | "with"> & {
    target: PipelineTarget;
    with: { model: "base" | PipelineArtifactReference; evaluator: PipelineEvaluator };
  }
  | Omit<ComparePipelineStepInput, "target"> & { target: PipelineTarget }
  | Omit<TokenizePipelineStepInput, "target"> & { target: PipelineTarget }
  | Omit<PretrainPipelineStepInput, "target"> & { target: PipelineTarget }
  | Omit<FinetunePipelineStepInput, "target"> & { target: PipelineTarget }
  | Omit<RlPipelineStepInput, "target"> & { target: PipelineTarget };

export interface Pipeline {
  version: 1;
  name?: string;
  runtime?: PipelineRuntime;
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
    evaluator: z.enum(PIPELINE_EVALUATORS).default("behavior"),
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

export const tokenizePipelineStepSchema = z.object({
  ...commonStep,
  uses: z.literal("tokenize"),
  with: z.object({
    vocabSize: z.number().int().min(64).max(65_536).optional(),
    maxChars: z.number().int().min(1_000).max(2_000_000_000).optional(),
  }).strict().optional(),
}).strict();

export const pretrainPipelineStepSchema = z.object({
  ...commonStep,
  uses: z.literal("pretrain"),
  with: z.object({
    tokenizer: pipelineArtifactReferenceSchema,
    depth: z.number().int().min(1).max(64).optional(),
    steps: z.number().int().min(1).max(10_000_000).optional(),
    batchSize: z.number().int().min(1).max(1024).optional(),
    sequenceLength: z.number().int().min(16).max(8192).optional(),
    nprocPerNode: z.number().int().min(1).max(16).optional(),
  }).strict(),
}).strict();

export const finetunePipelineStepSchema = z.object({
  ...commonStep,
  uses: z.literal("finetune"),
  with: z.object({
    model: pipelineArtifactReferenceSchema,
    steps: z.number().int().min(1).max(10_000_000).optional(),
    batchSize: z.number().int().min(1).max(1024).optional(),
  }).strict(),
}).strict();

export const rlPipelineStepSchema = z.object({
  ...commonStep,
  uses: z.literal("rl"),
  with: z.object({
    model: pipelineArtifactReferenceSchema,
    steps: z.number().int().min(1).max(10_000_000).optional(),
  }).strict(),
}).strict();

export const pipelineStepSchema = z.discriminatedUnion("uses", [
  trainPipelineStepSchema,
  evaluatePipelineStepSchema,
  comparePipelineStepSchema,
  tokenizePipelineStepSchema,
  pretrainPipelineStepSchema,
  finetunePipelineStepSchema,
  rlPipelineStepSchema,
]);

export const pipelineRuntimeSchema = z.object({
  engine: z.literal("foundation"),
}).strict();

export const pipelineDocumentSchema = z.object({
  version: z.literal(PIPELINE_DOCUMENT_VERSION),
  name: z.string().min(1).max(120).optional(),
  target: z.enum(PIPELINE_TARGETS).optional(),
  runtime: pipelineRuntimeSchema.optional(),
  steps: z.array(pipelineStepSchema).min(1).max(PIPELINE_MAX_STEPS),
}).strict();

export const PIPELINE_STEP_CAPABILITIES = {
  train: { inputs: [], outputs: ["model"] },
  evaluate: { inputs: ["model"], outputs: ["report"] },
  compare: { inputs: ["report", "report"], outputs: ["comparison"] },
  tokenize: { inputs: [], outputs: ["tokenizer"] },
  pretrain: { inputs: ["tokenizer"], outputs: ["model"] },
  finetune: { inputs: ["model"], outputs: ["model"] },
  rl: { inputs: ["model"], outputs: ["model"] },
} as const satisfies Record<
  PipelineStepUse,
  { readonly inputs: readonly PipelineArtifactKind[]; readonly outputs: readonly PipelineArtifactKind[] }
>;

const FOUNDATION_USES = new Set<string>(PIPELINE_FOUNDATION_USES);
const FOUNDATION_EVALUATORS = new Set<string>(PIPELINE_FOUNDATION_EVALUATORS);

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
): PipelineStep {
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
  return producer;
}

export function isFoundationUse(uses: PipelineStepUse): boolean {
  return FOUNDATION_USES.has(uses);
}

export function isFoundationPipeline(pipeline: Pick<Pipeline, "runtime" | "steps">): boolean {
  return pipeline.runtime?.engine === "foundation"
    || pipeline.steps.some((step) => isFoundationUse(step.uses));
}

/** Parse and normalize a portable Pipeline v1 document without executing it. */
export function parsePipeline(input: unknown): Pipeline {
  const parsed = pipelineDocumentSchema.parse(input);
  const seen = new Map<string, PipelineStep>();
  const steps: PipelineStep[] = [];
  let trainCount = 0;
  const foundationDeclared = parsed.runtime?.engine === "foundation";
  const foundationPresent = foundationDeclared
    || parsed.steps.some((step) => isFoundationUse(step.uses));

  if (foundationPresent && !foundationDeclared) {
    throw new Error("Foundation steps require runtime.engine to be 'foundation'.");
  }

  for (const inputStep of parsed.steps) {
    const target = inputStep.target ?? parsed.target;
    if (!target) {
      throw new Error(`Pipeline step '${inputStep.id}' needs a target or a pipeline default target.`);
    }

    const step = { ...inputStep, target } as PipelineStep;
    if (seen.has(step.id)) {
      throw new Error(`Pipeline step IDs must be unique; '${step.id}' is duplicated.`);
    }

    if (foundationPresent) {
      if (step.target !== "local") {
        throw new Error(`Foundation step '${step.id}' must target local execution.`);
      }
      if (step.uses === "train") {
        throw new Error("Foundation pipelines cannot include a train step; use pretrain, finetune, or rl.");
      }
      if (step.uses === "evaluate" && step.with.evaluator === "behavior") {
        throw new Error(`Foundation evaluate step '${step.id}' cannot use the behavior evaluator.`);
      }
    } else if (isFoundationUse(step.uses) || (step.uses === "evaluate" && step.with.evaluator !== "behavior")) {
      throw new Error(
        `Pipeline step '${step.id}' requires runtime.engine 'foundation' for ${step.uses === "evaluate" ? step.with.evaluator : step.uses}.`,
      );
    }

    if (step.uses === "train") {
      trainCount += 1;
      if (trainCount > PIPELINE_MAX_TRAIN_STEPS) {
        throw new Error(
          "Pipeline v1 supports at most one train step because model artifacts are run-scoped.",
        );
      }
    } else if (step.uses === "evaluate") {
      if (FOUNDATION_EVALUATORS.has(step.with.evaluator)) {
        if (step.with.model === "base") {
          throw new Error(`Pipeline evaluate step '${step.id}' with evaluator '${step.with.evaluator}' requires a prior model reference.`);
        }
        const producer = assertPriorOutput(step.id, step.with.model, "model", seen);
        if (producer.uses !== "pretrain" && producer.uses !== "finetune" && producer.uses !== "rl") {
          throw new Error(`Pipeline evaluate step '${step.id}' must reference a pretrain, finetune, or rl model.`);
        }
      } else if (step.with.model !== "base") {
        const producer = assertPriorOutput(step.id, step.with.model, "model", seen);
        if (producer.uses !== "train") {
          throw new Error(`Pipeline evaluate step '${step.id}' with the behavior evaluator must reference a train model.`);
        }
      }
    } else if (step.uses === "compare") {
      if (step.with.before.from === step.with.after.from) {
        throw new Error(`Pipeline compare step '${step.id}' requires two distinct report references.`);
      }
      assertPriorOutput(step.id, step.with.before, "report", seen);
      assertPriorOutput(step.id, step.with.after, "report", seen);
    } else if (step.uses === "pretrain") {
      const producer = assertPriorOutput(step.id, step.with.tokenizer, "tokenizer", seen);
      if (producer.uses !== "tokenize") {
        throw new Error(`Pipeline pretrain step '${step.id}' must reference a tokenize tokenizer.`);
      }
    } else if (step.uses === "finetune") {
      const producer = assertPriorOutput(step.id, step.with.model, "model", seen);
      if (producer.uses !== "pretrain" && producer.uses !== "finetune") {
        throw new Error(`Pipeline finetune step '${step.id}' must reference a pretrain or finetune model.`);
      }
    } else if (step.uses === "rl") {
      const producer = assertPriorOutput(step.id, step.with.model, "model", seen);
      if (producer.uses !== "finetune" && producer.uses !== "rl") {
        throw new Error(`Pipeline rl step '${step.id}' must reference a finetune or rl model.`);
      }
    }

    seen.set(step.id, step);
    steps.push(step);
  }

  return {
    version: PIPELINE_DOCUMENT_VERSION,
    ...(parsed.name ? { name: parsed.name } : {}),
    ...(parsed.runtime ? { runtime: parsed.runtime } : {}),
    steps,
  };
}

/** Require every normalized step to execute in the hosted cloud boundary. */
export function validateCloudPipeline(input: unknown): Pipeline {
  const pipeline = parsePipeline(input);
  if (isFoundationPipeline(pipeline)) {
    throw new Error("Foundation pipelines are local-only; the hosted runner does not execute them.");
  }
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

/** Smoke recipe for the local from-scratch foundation engine. */
export function canonicalFoundationPipeline(): Pipeline {
  return {
    version: PIPELINE_DOCUMENT_VERSION,
    name: "default-foundation",
    runtime: { engine: "foundation" },
    steps: [
      { id: "tokenize", uses: "tokenize", target: "local" },
      {
        id: "pretrain",
        uses: "pretrain",
        target: "local",
        with: { tokenizer: { from: "tokenize.tokenizer" }, depth: 2, steps: 2, batchSize: 2, sequenceLength: 64 },
      },
      {
        id: "bpb",
        uses: "evaluate",
        target: "local",
        with: { model: { from: "pretrain.model" }, evaluator: "bpb" },
      },
      {
        id: "sft",
        uses: "finetune",
        target: "local",
        with: { model: { from: "pretrain.model" }, steps: 2, batchSize: 1 },
      },
      {
        id: "chat",
        uses: "evaluate",
        target: "local",
        with: { model: { from: "sft.model" }, evaluator: "chat" },
      },
      {
        id: "infer",
        uses: "evaluate",
        target: "local",
        with: { model: { from: "sft.model" }, evaluator: "inference" },
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
