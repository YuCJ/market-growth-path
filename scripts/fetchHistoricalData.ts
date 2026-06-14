import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCanonicalSeries } from "../src/data/pipeline/buildCanonicalSeries.ts";
import {
  canonicalRowsToCsv,
  sourceRowsToCsv,
} from "../src/data/pipeline/csv.ts";
import { validateSourceMarketRows } from "../src/data/pipeline/validateMarketRows.ts";
import { createAlphaVantageProvider } from "../src/data/providers/alphaVantage.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const symbol = process.env.MARKET_DATA_SYMBOL ?? "VT";
const providerId = "alpha-vantage";
const frequency = "weekly-adjusted";
const acquisitionDate = new Date().toISOString().slice(0, 10);

async function main(): Promise<void> {
  await loadDotEnv();

  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) {
    throw new Error("ALPHA_VANTAGE_API_KEY is not set.");
  }

  const provider = createAlphaVantageProvider(apiKey);
  const sourceRows = await provider.fetchWeeklyAdjustedSeries({ symbol });
  validateSourceMarketRows(sourceRows);

  if (sourceRows.length < 500) {
    throw new Error(
      `Expected a full weekly history, but received only ${sourceRows.length} rows.`,
    );
  }

  const canonicalRows = buildCanonicalSeries(sourceRows);

  const sourceDir = resolve(
    repoRoot,
    "data",
    "sources",
    providerId,
    symbol,
    frequency,
  );
  const canonicalDir = resolve(repoRoot, "data", "canonical");

  await mkdir(sourceDir, { recursive: true });
  await mkdir(canonicalDir, { recursive: true });

  const sourcePath = resolve(sourceDir, `${acquisitionDate}.manual.csv`);
  const canonicalPath = resolve(
    canonicalDir,
    `market-total-return-${symbol.toLowerCase()}-weekly.v1.csv`,
  );

  await writeFile(sourcePath, sourceRowsToCsv(sourceRows), "utf8");
  await writeFile(canonicalPath, canonicalRowsToCsv(canonicalRows), "utf8");
  await writeAgentDocs({
    sourceDir,
    canonicalDir,
    sourcePath,
    canonicalPath,
    rowCount: sourceRows.length,
    startDate: sourceRows[0]?.date ?? "",
    endDate: sourceRows.at(-1)?.date ?? "",
  });

  console.log(`Wrote ${sourceRows.length} source rows to ${sourcePath}`);
  console.log(`Wrote ${canonicalRows.length} canonical rows to ${canonicalPath}`);
}

async function loadDotEnv(): Promise<void> {
  const envPath = resolve(repoRoot, ".env");
  let contents = "";
  try {
    contents = await readFile(envPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = unquoteEnvValue(value);
    }
  }
}

async function writeAgentDocs({
  sourceDir,
  canonicalDir,
  sourcePath,
  canonicalPath,
  rowCount,
  startDate,
  endDate,
}: {
  sourceDir: string;
  canonicalDir: string;
  sourcePath: string;
  canonicalPath: string;
  rowCount: number;
  startDate: string;
  endDate: string;
}): Promise<void> {
  await writeFile(
    resolve(repoRoot, "data", "AGENTS.md"),
    `# Data Notes for Agents

Use files under \`data/canonical/\` as app and model inputs. Files under \`data/sources/\` are provider-normalized snapshots kept for provenance and rebuilds.

Do not mix different symbols or providers inside one canonical CSV. Create a new canonical dataset or rebuild the existing one from a clearly identified source snapshot.
`,
    "utf8",
  );

  await writeFile(
    resolve(sourceDir, "AGENTS.md"),
    `# ${symbol} Alpha Vantage Weekly Adjusted Snapshot

This directory contains a manually fetched Alpha Vantage \`TIME_SERIES_WEEKLY_ADJUSTED\` snapshot for \`${symbol}\`. The current snapshot covers ${startDate} through ${endDate} with ${rowCount} weekly rows.

Use \`adjusted_close\` as the total-return-like source value. This is an ETF adjusted-close proxy, not an official total return index. Keep future provider-normalized snapshots in this directory as separate dated files rather than editing older snapshots.
`,
    "utf8",
  );

  await writeFile(
    resolve(canonicalDir, "AGENTS.md"),
    `# Canonical Market Series Notes

Files in this directory are canonical app inputs derived from provider-normalized snapshots under \`data/sources/\`.

The v1 canonical series pattern rebases each source \`adjusted_close\` value to 100 at the first observation: \`total_return_index = source_value / first_source_value * 100\`.

Each canonical file must keep one symbol/provider/frequency combination and clearly reflect that source in the filename and CSV metadata. ETF adjusted-close datasets are market proxies, not official total return indexes.
`,
    "utf8",
  );
}

function relativeToRepo(path: string): string {
  return path.slice(repoRoot.length + 1);
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
