import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporaryDirectory = await mkdtemp(join(tmpdir(), "pipeline-contract-package-"));
let tarballPath;

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      cwd: temporaryDirectory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
  } catch (error) {
    if (error && typeof error === "object") {
      if ("stdout" in error && error.stdout) {
        process.stderr.write(String(error.stdout));
      }
      if ("stderr" in error && error.stderr) {
        process.stderr.write(String(error.stderr));
      }
    }
    throw error;
  }
}

try {
  const packOutput = run(
    "npm",
    ["pack", "--silent", "--ignore-scripts"],
    { cwd: root },
  );
  const tarball = packOutput.trim().split(/\r?\n/).at(-1);
  if (!tarball) {
    throw new Error("npm pack did not report a tarball filename.");
  }
  tarballPath = join(root, tarball);

  run("npm", ["init", "-y"]);
  run("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    tarballPath,
  ]);

  const hashes = JSON.parse(
    await readFile(join(root, "fixtures", "hashes.json"), "utf8"),
  );
  const expectedHash = hashes["canonical-cloud"];

  run("node", [
    "--input-type=module",
    "--eval",
    `import { canonicalPipeline, pipelineHash, PIPELINE_STEP_CAPABILITIES } from "@tuned-tensor/pipeline-contract";
if (pipelineHash(canonicalPipeline("cloud")) !== ${JSON.stringify(expectedHash)}) throw new Error("ESM hash mismatch");
if (PIPELINE_STEP_CAPABILITIES.train.outputs[0] !== "model") throw new Error("ESM capability mismatch");`,
  ]);

  run("node", [
    "--eval",
    `const contract = require("@tuned-tensor/pipeline-contract");
if (contract.pipelineHash(contract.canonicalPipeline("cloud")) !== ${JSON.stringify(expectedHash)}) throw new Error("CommonJS hash mismatch");`,
  ]);

  await writeFile(
    join(temporaryDirectory, "consumer.mts"),
    `import { canonicalPipeline, pipelineHash, type Pipeline } from "@tuned-tensor/pipeline-contract";
const pipeline: Pipeline = canonicalPipeline("cloud");
const hash: string = pipelineHash(pipeline);
void hash;
`,
  );
  await writeFile(
    join(temporaryDirectory, "consumer.cts"),
    `import contract = require("@tuned-tensor/pipeline-contract");
const pipeline: import("@tuned-tensor/pipeline-contract").Pipeline = contract.canonicalPipeline("cloud");
const hash: string = contract.pipelineHash(pipeline);
void hash;
`,
  );
  await writeFile(
    join(temporaryDirectory, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
        },
        include: ["consumer.mts", "consumer.cts"],
      },
      null,
      2,
    )}\n`,
  );

  const typeScriptCli = join(root, "node_modules", "typescript", "bin", "tsc");
  run(process.execPath, [typeScriptCli, "--project", "tsconfig.json", "--noEmit"]);

  console.log("Packed ESM, CommonJS, declarations, capabilities, and golden hash verified.");
} finally {
  if (tarballPath) {
    await rm(tarballPath, { force: true });
  }
  await rm(temporaryDirectory, { force: true, recursive: true });
}
