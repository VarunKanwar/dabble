import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const supportedTargets = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-arm64", "win32-x64"];

const targetConfigs = {
  "darwin-arm64": { os: "darwin", cpu: "arm64" },
  "darwin-x64": { os: "darwin", cpu: "x64" },
  "linux-arm64": { os: "linux", cpu: "arm64" },
  "linux-x64": { os: "linux", cpu: "x64" },
  "win32-arm64": { os: "win32", cpu: "arm64" },
  "win32-x64": { os: "win32", cpu: "x64" }
};

main();

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  assertBuildOutputExists();

  const packageJson = readPackageJson();
  const targets = resolveTargets(args);
  const artifactsDir = path.join(rootDir, "artifacts");
  mkdirSync(artifactsDir, { recursive: true });

  for (const target of targets) {
    packageTarget(target, packageJson.version, artifactsDir);
  }
}

function printHelp() {
  console.log(`Usage:
  node scripts/package-vsix.mjs              Package the current platform
  node scripts/package-vsix.mjs <target>     Package a specific target
  node scripts/package-vsix.mjs --all        Package all supported targets

Supported targets:
  ${supportedTargets.join("\n  ")}`);
}

function readPackageJson() {
  return JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8"));
}

function resolveTargets(args) {
  if (args.includes("--all")) {
    return supportedTargets;
  }

  if (args.length === 0 || (args.length === 1 && args[0] === "")) {
    return [detectCurrentTarget()];
  }

  const target = args[0];
  if (!supportedTargets.includes(target)) {
    throw new Error(`Unsupported target "${target}". Supported targets: ${supportedTargets.join(", ")}`);
  }
  return [target];
}

function detectCurrentTarget() {
  const target = `${process.platform}-${process.arch}`;
  if (!supportedTargets.includes(target)) {
    throw new Error(
      `The current platform "${target}" does not map to a supported VSIX target. Pass an explicit target instead.`
    );
  }
  return target;
}

function assertBuildOutputExists() {
  const requiredOutputs = [path.join(rootDir, "dist", "extension", "index.js"), path.join(rootDir, "dist", "webview", "webview.js")];
  for (const output of requiredOutputs) {
    if (!existsSync(output)) {
      throw new Error(`Missing build output: ${output}. Run "npm run build" or "make check" first.`);
    }
  }
}

function packageTarget(target, version, artifactsDir) {
  const targetConfig = targetConfigs[target];
  const stageDir = mkdtempSync(path.join(os.tmpdir(), `duckview-${target}-`));
  const vsixPath = path.join(artifactsDir, `duckview-${version}-${target}.vsix`);

  try {
    copyStageFiles(stageDir);
    installRuntimeDependencies(stageDir, targetConfig);
    assertTargetBindingInstalled(stageDir, target);
    runVscePackage(stageDir, target, vsixPath);
  } finally {
    rmSync(stageDir, { recursive: true, force: true });
  }
}

function copyStageFiles(stageDir) {
  const stageEntries = [".vscodeignore", "CHANGELOG.md", "LICENSE", "README.md", "dist", "media", "package-lock.json", "package.json"];
  for (const entry of stageEntries) {
    const sourcePath = path.join(rootDir, entry);
    const destinationPath = path.join(stageDir, entry);
    cpSync(sourcePath, destinationPath, { recursive: true });
  }

  sanitizeStagePackageJson(stageDir);
}

function sanitizeStagePackageJson(stageDir) {
  const packageJsonPath = path.join(stageDir, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  if (packageJson.scripts) {
    delete packageJson.scripts["vscode:prepublish"];
  }
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

function installRuntimeDependencies(stageDir, targetConfig) {
  const cacheDir = process.env.NPM_CONFIG_CACHE || path.join(os.tmpdir(), "duckview-npm-cache");
  runCommand(npmCommand(), ["ci", "--omit=dev", "--include=optional", `--os=${targetConfig.os}`, `--cpu=${targetConfig.cpu}`], {
    cwd: stageDir,
    env: {
      ...process.env,
      NPM_CONFIG_CACHE: cacheDir
    }
  });
}

function assertTargetBindingInstalled(stageDir, target) {
  const bindingPath = path.join(stageDir, "node_modules", "@duckdb", `node-bindings-${target}`);
  if (!existsSync(bindingPath)) {
    throw new Error(
      `Missing target binding ${bindingPath}. npm likely skipped the optional DuckDB binary for ${target}; check network access and retry.`
    );
  }
}

function runVscePackage(stageDir, target, vsixPath) {
  const vscePath = resolveVsceBinary();
  runCommand(vscePath, ["package", "--target", target, "--out", vsixPath], {
    cwd: stageDir
  });
}

function resolveVsceBinary() {
  const filename = process.platform === "win32" ? "vsce.cmd" : "vsce";
  const vscePath = path.join(rootDir, "node_modules", ".bin", filename);
  if (!existsSync(vscePath)) {
    throw new Error(`Missing local vsce binary at ${vscePath}. Run "npm install" in the repository root first.`);
  }
  return vscePath;
}

function runCommand(command, args, options) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}
