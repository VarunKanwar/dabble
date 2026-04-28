import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const supportedTargets = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-arm64", "win32-x64"];

main();

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const packageJson = readPackageJson();
  const targets = resolveTargets(args);
  let failures = 0;

  for (const target of targets) {
    failures += publishTarget(packageJson, target);
  }

  if (failures > 0) {
    process.exitCode = 1;
  }
}

function printHelp() {
  console.log(`Usage:
  node scripts/publish-vsix.mjs              Publish the current platform VSIX
  node scripts/publish-vsix.mjs <target>     Publish a specific target VSIX
  node scripts/publish-vsix.mjs --all        Publish all supported target VSIX files

Supported targets:
  ${supportedTargets.join("\n  ")}

Authentication:
  - export VSCE_PAT=...
  - or run ./node_modules/.bin/vsce login <publisher> once`);
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

function publishTarget(packageJson, target) {
  const vsixPath = path.join(rootDir, "artifacts", `${packageJson.name}-${packageJson.version}-${target}.vsix`);
  if (!existsSync(vsixPath)) {
    throw new Error(`Missing VSIX artifact: ${vsixPath}. Run "make package TARGET=${target}" or "make package-all" first.`);
  }

  const vscePath = resolveVsceBinary();
  const result = runCommand(vscePath, ["publish", "--packagePath", vsixPath], {
    cwd: rootDir,
    encoding: "utf8"
  });
  const combinedOutput = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status === 0) {
    process.stdout.write(combinedOutput);
    return 0;
  }

  if (combinedOutput.includes("already exists")) {
    process.stdout.write(combinedOutput);
    console.log(`SKIP  ${packageJson.publisher}.${packageJson.name} (${target}) v${packageJson.version} is already published.`);
    return 0;
  }

  process.stdout.write(combinedOutput);
  process.stderr.write(combinedOutput);
  console.error(`FAIL  ${packageJson.publisher}.${packageJson.name} (${target}) v${packageJson.version}`);
  return 1;
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
  const result = spawnSync(command, args, options);
  if (result.error) {
    throw result.error;
  }
  return result;
}
