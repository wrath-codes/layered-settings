import { defineConfig } from "@vscode/test-cli";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  files: "out/extension/src/test/**/*.test.js",
  version: "insiders",
  workspaceFolder: resolve(__dirname, "test/fixtures/workspace"),
  mocha: {
    ui: "tdd",
    timeout: 30000,
  },
});
