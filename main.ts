// main.ts — Token Radar entry point.
//
// Usage:
//   node main.ts --input <snapshot.json | directory> [--output <dir>]
//   MAKEFUN_OUTPUT_DIR can stand in for --output; the default is /output.
//
// The program reads a DeFiLlama snapshot, scores it with the radar-2 model
// in lib/model.ts, and writes the output directory: board.json (the ranked
// board), data.js (the dashboard payload), the dashboard files, the
// screenshots, and dossier.json (the evidence bundle, built last because it
// is assembled from the other files). It is deterministic: the same snapshot
// always produces the same files, byte for byte.
//
// Exit codes: 2 when the snapshot cannot be found or read, 1 when the board
// is invalid or there are fewer than three screenshots.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-board.ts";
import {
  boardIssue,
  buildBoard,
  buildLive,
  buildSetAside,
  dataScriptFor,
  radarDataFor,
  type Snapshot,
} from "./lib/model.ts";

// The repository root is the directory this file lives in; the dashboard
// and screenshots are copied from here.
const REPO_ROOT = dirname(fileURLToPath(import.meta.url));

// The dossier size limits: 64 KiB of text, at most 4 images of 512 KiB
// each, at most 400 dashboard files totalling 4 MiB.
const DOSSIER_LIMITS = {
  text_max_bytes: 65536,
  screenshots: { max: 4, max_bytes: 524288 },
  dashboard: { max_files: 400, max_bytes: 4194304 },
};

function fail(message: string, code: number): never {
  console.error(`token radar: ${message}`);
  process.exit(code);
}

// Read --input/--output in either "--flag value" or "--flag=value" form.
// Anything else on the command line is ignored.
function parseArgs(argv: string[]): { input: string | null; output: string | null } {
  let input: string | null = null;
  let output: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input" && i + 1 < argv.length) {
      input = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--input=")) {
      input = arg.slice("--input=".length);
    } else if (arg === "--output" && i + 1 < argv.length) {
      output = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--output=")) {
      output = arg.slice("--output=".length);
    }
  }
  return { input, output };
}

// Load the snapshot. The input may be the snapshot file itself or the
// directory that holds snapshot.json.
function loadSnapshot(inputPath: string): Snapshot {
  if (!existsSync(inputPath)) fail(`snapshot not found: ${inputPath}`, 2);
  let filePath = inputPath;
  if (statSync(filePath).isDirectory()) filePath = join(filePath, "snapshot.json");
  if (!existsSync(filePath)) fail(`snapshot not found: ${filePath}`, 2);

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    fail(`snapshot is not valid JSON: ${filePath}`, 2);
  }
  const raw = parsed as Record<string, unknown>;
  if (!Array.isArray(raw.protocols)) fail(`snapshot has no protocols array: ${filePath}`, 2);
  if (typeof raw.as_of !== "string") fail(`snapshot has no as_of date: ${filePath}`, 2);
  if (typeof raw.source !== "string") fail(`snapshot has no source: ${filePath}`, 2);
  if (!Array.isArray(raw.watchlist)) fail(`snapshot has no watchlist: ${filePath}`, 2);

  return {
    as_of: raw.as_of,
    source: raw.source,
    floor_usd: typeof raw.floor_usd === "number" ? raw.floor_usd : 0,
    watchlist: (raw.watchlist as unknown[]).map((entry) =>
      typeof entry === "string" ? entry : (entry as { slug: string }).slug,
    ),
    protocols: raw.protocols as Snapshot["protocols"],
  };
}

// Copy every regular file from one directory to another, skipping hidden
// names. Returns how many files were copied.
function copyPlainFiles(fromDir: string, toDir: string): number {
  mkdirSync(toDir, { recursive: true });
  let copied = 0;
  for (const entry of readdirSync(fromDir)) {
    if (entry.startsWith(".")) continue;
    const from = join(fromDir, entry);
    if (!statSync(from).isFile()) continue;
    copyFileSync(from, join(toDir, entry));
    copied += 1;
  }
  return copied;
}

// A screenshot name must be a plain file name (no directories, no "..") with
// an image extension.
function isScreenshotName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && !name.includes("..") && /\.(png|jpe?g|webp)$/i.test(name);
}

async function main(): Promise<void> {
  const { input, output } = parseArgs(process.argv.slice(2));
  const inputPath = input ?? "/input";
  const outDir = output ?? process.env.MAKEFUN_OUTPUT_DIR ?? "/output";

  const snapshot = loadSnapshot(inputPath);
  mkdirSync(outDir, { recursive: true });

  const rows = buildBoard(snapshot);
  const live = buildLive(snapshot);
  const setAside = buildSetAside(snapshot);

  const issue = boardIssue(rows, snapshot);
  if (issue) fail(`invalid board: ${issue}`, 1);

  writeFileSync(join(outDir, "board.json"), `${JSON.stringify({ rows })}\n`);
  const radar = radarDataFor(snapshot, rows, live, setAside);
  writeFileSync(join(outDir, "data.js"), dataScriptFor(radar));

  const dashboardCount = copyPlainFiles(join(REPO_ROOT, "dashboard"), join(outDir, "dashboard"));

  const screenshotsDir = join(REPO_ROOT, "screenshots");
  const screenshotNames = readdirSync(screenshotsDir).filter((name) => !name.startsWith("."));
  for (const name of screenshotNames) {
    if (!isScreenshotName(name)) fail(`screenshot name is not a plain image name: ${name}`, 1);
  }
  const screenshotCount = copyPlainFiles(screenshotsDir, join(outDir, "screenshots"));
  if (screenshotCount < 3) fail(`only ${screenshotCount} screenshots, need at least 3`, 1);

  const dossier = await buildDossier(outDir, DOSSIER_LIMITS);
  writeFileSync(join(outDir, "dossier.json"), dossier);

  const early = rows.length - snapshot.watchlist.length;
  console.log(
    `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ` +
      `${rows.length} rows scored (${early} early, ${setAside.length} wrapped set aside, ${live.length} live set aside)`,
  );
  console.log(
    `token radar: wrote ${join(outDir, "board.json")}, ${join(outDir, "data.js")}, ` +
      `${join(outDir, "dashboard")} (${dashboardCount} files), ` +
      `${join(outDir, "screenshots")} (${screenshotCount} images) and ${join(outDir, "dossier.json")}`,
  );
}

main().catch((error: unknown) => {
  console.error(`token radar: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
