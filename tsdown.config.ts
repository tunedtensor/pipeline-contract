import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node22",
  outExtensions({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
});
