# `@tuned-tensor/pipeline-contract`

Portable, versioned Pipeline v1 contract intended to be shared by Tuned Tensor's local and hosted execution boundaries.

The package is the migration target for `tuned-tensor-cli`, `tuned-tensor`, and `tuned-tensor-runs`; those consumers have not yet been switched to this dependency.

This repository is deliberately **contract-only**. It defines parsing, normalization, dependency validation, canonical hashing, a JSON Schema, and golden fixtures. It does not contain local execution, AWS Step Functions states, Lambda ARNs, billing behavior, artifact transfer, or arbitrary plugin loading.

## Pipeline v1

```json
{
  "version": 1,
  "name": "default-cloud",
  "target": "cloud",
  "steps": [
    {
      "id": "baseline",
      "uses": "evaluate",
      "with": { "model": "base", "evaluator": "behavior" }
    },
    { "id": "train", "uses": "train" },
    {
      "id": "candidate",
      "uses": "evaluate",
      "with": { "model": { "from": "train.model" }, "evaluator": "behavior" }
    },
    {
      "id": "compare",
      "uses": "compare",
      "with": {
        "before": { "from": "baseline.report" },
        "after": { "from": "candidate.report" }
      }
    }
  ]
}
```

### Bounded vocabulary

- `train` produces `model`.
- `evaluate` consumes `"base"` or a prior `model` reference and produces `report`.
- `compare` consumes two distinct prior `report` references and produces `comparison`.
- The only v1 evaluator is `"behavior"`.
- Documents contain 1–16 ordered steps.
- V1 permits at most one training step because current model artifacts are run-scoped.
- References must point backward to a compatible producer output.
- Steps resolve to `local` or `cloud` placement during normalization.

The portable contract permits mixed placement so the CLI can plan explicit boundaries. `validateCloudPipeline()` rejects every local step; hosted execution must never silently reinterpret placement.

## API

```ts
import {
  canonicalJson,
  canonicalPipeline,
  parsePipeline,
  PIPELINE_STEP_CAPABILITIES,
  pipelineHash,
  validateCloudPipeline,
} from "@tuned-tensor/pipeline-contract";

const plan = parsePipeline(input);
const identity = pipelineHash(plan);
const hostedPlan = validateCloudPipeline(input);
const defaultPlan = canonicalPipeline("cloud");
```

`parsePipeline()` is pure: it performs no network, storage, billing, quota, or execution actions.

Executor compatibility remains separate from document validity. A valid Pipeline v1 document may still be unsupported by a particular deployed executor, which must reject it before side effects.

## Published artifacts

- Runtime and TypeScript exports: package root
- JSON Schema: `@tuned-tensor/pipeline-contract/schema`
- Golden test vectors: `@tuned-tensor/pipeline-contract/fixtures/*`
- Stable expected hashes: `fixtures/hashes.json`

The package is present on GitHub but has **not yet been published to npm**. Consumer migrations should pin the first reviewed release exactly rather than depending on the moving `main` branch.

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run pack:check
```

## Release discipline

- The document's `version` field tracks breaking schema semantics.
- Package SemVer tracks implementation, fixture, and additive API changes.
- Golden normalized documents and SHA-256 hashes must remain stable within Pipeline v1.
- Execution-specific policies stay in the owning CLI, app, or hosted runner.

Licensed under Apache-2.0.
