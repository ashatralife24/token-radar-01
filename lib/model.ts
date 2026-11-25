// lib/model.ts — Token Radar scoring model ("radar-2").
//
// The model turns a DeFiLlama snapshot into a ranked board of pre-token
// protocols. A protocol's implied value starts from its locked value (TVL),
// pulled toward a reference scale, then adjusted by four small factors:
// recent growth, how long it has been live, how many chains it runs on, and
// how its growth compares with the median of its own category. Every
// adjustment is clamped so no single signal can dominate the result.
//
// Nothing here fetches from the network and nothing here touches money:
// the model reads the snapshot the caller supplies and returns plain data.

export const MODEL_VERSION = "radar-2";

// The tuning constants for radar-2. Each one is a deliberate choice, not a
// magic number: scale 55 keeps implied values in the same ballpark as the
// snapshot's TVL figures, the 0.65 power compresses the enormous TVL range,
// and the four multipliers are each bounded so the whole adjustment stays
// within roughly a factor of three.
export interface ModelConstants {
  scale: number;
  tvl_power: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_weight: number;
  breadth_cap: number;
  relative_weight: number;
  relative_cap: number;
}

export const MODEL: ModelConstants = {
  scale: 55,
  tvl_power: 0.65,
  growth_weight: 1.2,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.45,
  maturity_range: 0.55,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_weight: 0.02,
  breadth_cap: 8,
  relative_weight: 0.6,
  relative_cap: 40,
};

// ---- Snapshot shapes -------------------------------------------------------

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  watchlist: string[];
  protocols: SnapshotProtocol[];
}

// ---- Board shapes ----------------------------------------------------------

export interface ModelDetail {
  scale: number;
  tvl_power: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  relative_growth_multiplier: number;
  category_median_growth: number;
  age_days: number | null;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: string;
  age_days: number | null;
  implied_value_usd: number;
  model: ModelDetail;
  farm_steps: string[];
}

// The flattened row shipped to the dashboard: the same figures, but the
// model detail is inlined and the farm plan is left out (the dashboard
// re-derives it from these fields).
export interface FlatRow {
  rank: number;
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  relative_growth_multiplier: number;
  category_median_growth: number;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
}

export interface SetAsideRow {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  set_aside_size: number;
  rows: FlatRow[];
  live: LiveRow[];
  set_aside: SetAsideRow[];
}

// ---- Small numeric helpers -------------------------------------------------

export function clampNumber(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

// Round to four decimals the way the model stores every multiplier: a plain
// Math.round on the scaled value, so -0.00415 becomes -0.0041 rather than
// -0.0042 (toFixed would round the other way on that edge).
export function round4(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

export function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

// Whole days between two ISO timestamps, never negative. A missing or
// unparseable listing date means the age is unknown (null), and the maturity
// factor then falls back to the unknown-age default.
export function ageInDays(listedAt: string | null, asOf: string): number | null {
  if (!listedAt) return null;
  const listedMs = Date.parse(listedAt);
  const asOfMs = Date.parse(asOf);
  if (Number.isNaN(listedMs) || Number.isNaN(asOfMs)) return null;
  return Math.max(0, Math.floor((asOfMs - listedMs) / 86400000));
}

// ---- Protocol classification ----------------------------------------------

// A protocol counts as pre-token when it has no market cap, no CoinGecko
// id and no symbol. A market cap of zero or less is treated as missing:
// the snapshot carries a few of those and they mean "no market".
export function isPreToken(p: SnapshotProtocol): boolean {
  const mcap = p.mcap_usd;
  const hasMcap = mcap !== null && mcap !== undefined && mcap > 0;
  return !hasMcap && (p.gecko_id === null || p.gecko_id === undefined) && (p.symbol === null || p.symbol === undefined);
}

// Names ending in a version marker ("Foo V2", "Bar v1.3", "Baz 2.0") are
// usually a versioned deployment of something else, not a distinct protocol.
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export function hasVersionedName(name: string): boolean {
  return VERSION_SUFFIX.test(name);
}

// Wrapped, staked and bridged products are not new protocols: they are a
// wrapper around an asset that already exists. The rule is deliberately
// generic — it names categories and name patterns, never individual
// protocols — so it applies the same way to any snapshot.
const WRAPPED_CATEGORIES = new Set([
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
]);

const EXCHANGE_PREFIXES = [
  "Binance",
  "Coinbase",
  "Bybit",
  "Kraken",
  "Bitget",
  "OKX",
  "Bitfinex",
  "Gemini",
];

export function isWrappedProduct(p: SnapshotProtocol): boolean {
  if (WRAPPED_CATEGORIES.has(p.category)) return true;
  const lowered = p.name.toLowerCase();
  if (/\bwrapped\b/.test(lowered) || /\bstaked\b/.test(lowered) || /\bstaking\b/.test(lowered)) return true;
  return EXCHANGE_PREFIXES.some((prefix) => lowered.startsWith(prefix.toLowerCase()));
}

// A candidate for the board: pre-token, not a centralised exchange, and not
// a versioned deployment. Wrapped products are candidates too, but they are
// set aside rather than ranked.
export function isBoardCandidate(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== "CEX" && !hasVersionedName(p.name);
}

export function isRankable(p: SnapshotProtocol): boolean {
  return isBoardCandidate(p) && !isWrappedProduct(p);
}

// ---- Scoring ----------------------------------------------------------------

// The category median is taken over every protocol in the category that
// reports a 7-day change — not just the rankable ones — so the median is a
// fair picture of the whole category.
export function categoryMedians(protocols: SnapshotProtocol[]): Map<string, number> {
  const byCategory = new Map<string, number[]>();
  for (const p of protocols) {
    if (p.change_7d === null || p.change_7d === undefined) continue;
    const list = byCategory.get(p.category);
    if (list) list.push(p.change_7d);
    else byCategory.set(p.category, [p.change_7d]);
  }
  const medians = new Map<string, number>();
  for (const [category, changes] of byCategory) {
    medians.set(category, round4(medianOf(changes)));
  }
  return medians;
}

export interface ScoredProtocol {
  protocol: SnapshotProtocol;
  ageDays: number | null;
  detail: ModelDetail;
  implied: number;
}

// Score one protocol. The multipliers stored in `detail` are rounded to four
// decimals for display, but the implied value is computed from the raw
// (unrounded) multipliers, so the stored figures and the value never drift
// apart by more than a rounding unit.
export function scoreProtocol(
  p: SnapshotProtocol,
  asOf: string,
  categoryMedian: number,
): ScoredProtocol {
  const age = ageInDays(p.listed_at, asOf);
  const change = p.change_7d === null || p.change_7d === undefined ? 0 : p.change_7d;

  const growthPct = clampNumber(change, MODEL.growth_floor, MODEL.growth_cap);
  const growthRaw = 1 + (growthPct / 100) * MODEL.growth_weight;
  const ageForMaturity = age === null ? MODEL.unknown_age_days : age;
  const maturityRaw =
    MODEL.maturity_floor +
    (Math.min(ageForMaturity, MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range;
  const breadthRaw = 1 + Math.min(p.chains.length, MODEL.breadth_cap) * MODEL.breadth_weight;
  const relativeRaw =
    1 +
    (clampNumber(change - categoryMedian, -MODEL.relative_cap, MODEL.relative_cap) / 100) *
      MODEL.relative_weight;

  const implied = Math.round(
    MODEL.scale *
      Math.pow(p.tvl_usd, MODEL.tvl_power) *
      growthRaw *
      maturityRaw *
      breadthRaw *
      relativeRaw,
  );

  const detail: ModelDetail = {
    scale: MODEL.scale,
    tvl_power: MODEL.tvl_power,
    growth_pct: growthPct,
    growth_multiplier: round4(growthRaw),
    maturity_multiplier: round4(maturityRaw),
    breadth_multiplier: round4(breadthRaw),
    relative_growth_multiplier: round4(relativeRaw),
    category_median_growth: categoryMedian,
    age_days: age,
  };

  return { protocol: p, ageDays: age, detail, implied };
}

// ---- Farm plan ---------------------------------------------------------------

// How much capital a row's plan assumes, from the protocol's TVL. The bands
// are the same for every row: the plan is a recipe, not advice about a
// specific position.
export function capitalForTvl(tvlUsd: number): number {
  if (tvlUsd >= 5_000_000_000) return 250;
  if (tvlUsd >= 1_000_000_000) return 150;
  if (tvlUsd >= 100_000_000) return 100;
  return 50;
}

export function gasForCapital(capital: number): number {
  return capital >= 150 ? 8 : 4;
}

// How long to hold, from the protocol's age. Young protocols need the
// longest hold so the activity is visible across several snapshots; older
// ones are already established.
export function holdDaysForAge(ageDays: number | null): number {
  if (ageDays === null) return 30;
  if (ageDays < 180) return 60;
  if (ageDays < 365) return 45;
  return 30;
}

// The category groups that decide which wording a step uses. A category
// belongs to at most one group; anything unrecognised falls through to the
// generic wording.
export type ActionGroup =
  | "curator"
  | "dex"
  | "lending"
  | "rwa"
  | "deriv"
  | "basis"
  | "staking"
  | "chain"
  | "stable"
  | "prediction"
  | "payments"
  | "bridge"
  | "insurance"
  | "governance"
  | "generic";

export function actionGroupFor(category: string): ActionGroup {
  const c = category.toLowerCase();
  if (c.includes("curator") || c.includes("allocator")) return "curator";
  if (c.includes("dex") || c.includes("yield") || c.includes("farming") || c.includes("index")) return "dex";
  if (c.includes("cdp") || c.includes("lending") || c.includes("collateral")) return "lending";
  if (c === "rwa") return "rwa";
  if (c.includes("derivative")) return "deriv";
  if (c.includes("basis")) return "basis";
  if (c.includes("restaking") || c.includes("staking")) return "staking";
  if (category === "Chain") return "chain";
  if (c.includes("stablecoin")) return "stable";
  if (c.includes("prediction")) return "prediction";
  if (c.includes("payment")) return "payments";
  if (c.includes("bridge")) return "bridge";
  if (c.includes("insurance")) return "insurance";
  if (c.includes("governance")) return "governance";
  return "generic";
}

// The main action of the plan (step 1), one phrasing per group. Each phrasing
// is a template: the capital, the protocol name and the first chain are
// filled in per row.
const MAIN_ACTIONS: Record<ActionGroup, (name: string, chain: string, capital: number) => string> = {
  curator: (name, chain, capital) =>
    `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`,
  dex: (name, chain, capital) =>
    `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`,
  lending: (name, chain, capital) =>
    `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`,
  rwa: (_name, chain, capital) =>
    `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`,
  deriv: (name, _chain, capital) =>
    `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`,
  basis: (name, _chain, capital) =>
    `Deposit $${capital} as margin for the basis trade on ${name} and hold the hedged position.`,
  staking: (name, _chain, capital) =>
    `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`,
  chain: (name, _chain, capital) =>
    `Stake $${capital} of the chain's native asset through ${name} and keep the stake.`,
  stable: (name, chain, capital) =>
    `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`,
  prediction: (name, _chain, capital) =>
    `Fund $${capital} and place one market position on ${name}.`,
  payments: (name, chain, capital) =>
    `Route $${capital} of payments through ${name} on ${chain} and keep the volume flowing.`,
  bridge: (name, chain, capital) =>
    `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`,
  insurance: (name, chain, capital) =>
    `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`,
  governance: (name, chain, capital) =>
    `Deposit $${capital} into ${name} on ${chain} and vote on one proposal.`,
  generic: (name, chain, capital) =>
    `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`,
};

// The qualifying weekly action (step 3) and the weekly check (step 6) vary by
// group; groups without their own wording use the generic one.
const WEEKLY_ACTIONS: Partial<Record<ActionGroup, string>> = {
  curator: "a deposit, a rebalance or a vote",
  dex: "a swap, a deposit or a vote on a pool gauge",
  lending: "a deposit, a borrow or a repayment",
  rwa: "a mint, a hold or a redemption",
  deriv: "a trade, a deposit or a close",
  stable: "a mint, a deposit or a redemption",
  staking: "a stake, a restake or a vote",
  prediction: "a market position or a settlement claim",
  bridge: "a bridge transfer or a swap on the destination chain",
  insurance: "a cover purchase or a claim check",
};

const WEEKLY_CHECKS: Partial<Record<ActionGroup, string>> = {
  curator:
    "Read the curator's latest allocation report and check the vault's holdings match what it claims.",
  dex: "Check the pool's fees and impermanent loss weekly before adding more liquidity.",
  lending:
    "Check the borrow rate and the health factor weekly so a price move cannot liquidate the position.",
  rwa: "Check the attestation for the underlying real-world asset and confirm the issuer's reserves.",
  deriv: "Check the funding rate and the liquidation price before opening a larger position.",
  stable: "Check the peg and the reserves backing the stable asset weekly.",
  staking: "Check the validator or operator set and the unbonding period before staking more.",
  prediction: "Check the market's resolution rules so you know how a position settles.",
  bridge:
    "Check the bridge's audited contracts and the time a transfer takes before moving larger sums.",
  insurance: "Read the policy's exclusions so you know exactly what the cover pays for.",
};

const WEEKLY_ACTION_GENERIC = "a deposit, a borrow, a swap or a vote";
const WEEKLY_CHECK_GENERIC =
  "Read the protocol's docs and check what activity its points program actually counts.";

// The two steps that never vary: claim only from the protocol's own link,
// and keep a log while unwinding gradually.
const STEP_CLAIM =
  "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes. " +
  "Cost: no fee to check, and never pay to claim. Time: 10 minutes.";

const STEP_LOG =
  "Write the wallet, the dates and every transaction in a farm log, and unwind the position gradually, keeping enough gas to exit. " +
  "Cost: nothing but the log. Time: 5 minutes to log; 30 minutes to unwind.";

// Eight steps for one row. Steps 0, 5 and 7 are the same for every row;
// steps 1, 2, 3 and 6 adapt to the category; step 4 adapts to the age.
export function farmStepsFor(row: {
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  age_days: number | null;
}): string[] {
  const capital = capitalForTvl(row.tvl_usd);
  const gas = gasForCapital(capital);
  const group = actionGroupFor(row.category);
  const firstChain = row.chains[0];
  const hold = holdDaysForAge(row.age_days);

  const steps: string[] = [];

  steps.push(
    `Use a fresh wallet that holds only the funds you plan to farm on ${firstChain}, and keep its seed phrase offline. ` +
      `Cost: under $3 of gas for the first transaction. Time: 5 minutes.`,
  );

  steps.push(
    MAIN_ACTIONS[group](row.name, firstChain, capital) +
      ` Cost: $${capital} of capital and about $${gas} of gas. Time: 15 minutes to set up.`,
  );

  if (row.chains.length >= 2) {
    steps.push(
      `Bridge a small test amount to ${row.chains[1]} and repeat the main action there so the activity is recorded on a second chain. ` +
        `Cost: about $5 of gas for the bridge. Time: 20 minutes.`,
    );
  } else {
    const half = capital / 2;
    if (group === "dex") {
      steps.push(
        `Add a second, smaller position of $${half} to another pool on ${firstChain} so the activity is not a single deposit. ` +
          `Cost: $${half} of capital and about $3 of gas. Time: 15 minutes.`,
      );
    } else if (group === "lending") {
      steps.push(
        `Borrow a small amount against the $${capital} deposit and repay it, so the position shows both sides of the market. ` +
          `Cost: $${half} of capital and about $3 of gas. Time: 15 minutes.`,
      );
    } else if (group === "deriv") {
      steps.push(
        `Open a second, smaller hedge in the opposite direction to show two-sided activity. ` +
          `Cost: $${half} of capital and about $3 of gas. Time: 15 minutes.`,
      );
    } else if (group === "staking") {
      steps.push(
        `Split the stake across two validators or operators so the position is not tied to one of them. ` +
          `Cost: $${half} of capital and about $3 of gas. Time: 15 minutes.`,
      );
    } else {
      steps.push(
        `Repeat the main action with a second, smaller position of $${half} so the activity is not a single deposit. ` +
          `Cost: $${half} of capital and about $3 of gas. Time: 15 minutes.`,
      );
    }
  }

  const weekly = WEEKLY_ACTIONS[group] ?? WEEKLY_ACTION_GENERIC;
  steps.push(
    `Make one qualifying action each week, such as ${weekly}. ` +
      `Cost: about $2 of gas a week. Time: 10 minutes a week.`,
  );

  steps.push(
    `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot. ` +
      `Cost: the $${capital} stays in the position. Time: ${hold} days.`,
  );

  steps.push(STEP_CLAIM);

  const check = WEEKLY_CHECKS[group] ?? WEEKLY_CHECK_GENERIC;
  steps.push(`${check} Cost: nothing to check. Time: 10 minutes.`);

  steps.push(STEP_LOG);

  return steps;
}

// ---- Building the board ----------------------------------------------------

// Rank every rankable protocol by implied value, highest first; ties break
// on the slug so the order is deterministic.
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const medians = categoryMedians(snapshot.protocols);
  const scored = snapshot.protocols
    .filter((p) => isRankable(p))
    .map((p) => scoreProtocol(p, snapshot.as_of, medians.get(p.category) ?? 0));

  scored.sort(
    (a, b) => b.implied - a.implied || (a.protocol.slug < b.protocol.slug ? -1 : 1),
  );

  return scored.map((s, index) => {
    const p = s.protocol;
    const row: BoardRow = {
      rank: index + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd !== null && p.mcap_usd !== undefined && p.mcap_usd > 0 ? p.mcap_usd : null,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: "pre-token",
      age_days: s.ageDays,
      implied_value_usd: s.implied,
      model: s.detail,
      farm_steps: [],
    };
    row.farm_steps = farmStepsFor(row);
    return row;
  });
}

// The 24 live-token protocols with the largest market cap (ties break on
// TVL). These are shown for context; they are not ranked.
export function buildLive(snapshot: Snapshot): LiveRow[] {
  const live = snapshot.protocols
    .filter(
      (p) =>
        !isPreToken(p) &&
        p.category !== "CEX" &&
        p.mcap_usd !== null &&
        p.mcap_usd !== undefined &&
        p.mcap_usd > 0,
    )
    .sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number) || b.tvl_usd - a.tvl_usd)
    .slice(0, 24);
  return live.map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd as number,
    change_7d: p.change_7d,
  }));
}

// The wrapped, staked and bridged products that were set aside, largest TVL
// first. No rank and no implied value: they were never scored.
export function buildSetAside(snapshot: Snapshot): SetAsideRow[] {
  const setAside = snapshot.protocols
    .filter((p) => isBoardCandidate(p) && isWrappedProduct(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd);
  return setAside.map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd !== null && p.mcap_usd !== undefined && p.mcap_usd > 0 ? p.mcap_usd : null,
  }));
}

// The flat row the dashboard consumes: the same figures, model detail
// inlined, farm plan left out.
export function flatRowFor(row: BoardRow): FlatRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    relative_growth_multiplier: row.model.relative_growth_multiplier,
    category_median_growth: row.model.category_median_growth,
  };
}

// The whole dashboard payload, in the exact key order the dashboard reads.
export function radarDataFor(
  snapshot: Snapshot,
  rows: BoardRow[],
  live: LiveRow[],
  setAside: SetAsideRow[],
): RadarData {
  const watchlistSize = snapshot.watchlist.length;
  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: MODEL,
    model_version: MODEL_VERSION,
    watchlist_size: watchlistSize,
    board_size: rows.length,
    early_size: rows.length - watchlistSize,
    live_size: live.length,
    set_aside_size: setAside.length,
    rows: rows.map((r) => flatRowFor(r)),
    live,
    set_aside: setAside,
  };
}

// The dashboard script: a single global holding the payload.
export function dataScriptFor(data: RadarData): string {
  return `window.RADAR=${JSON.stringify(data)};\n`;
}

// ---- Validation --------------------------------------------------------------

// Check the finished board before it is written. Returns a message
// describing the first problem found, or null when the board is sound.
export function boardIssue(rows: BoardRow[], snapshot: Snapshot): string | null {
  if (rows.length === 0) return "board has no rows";
  const slugs = new Set<string>();
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.rank !== i + 1) return `row ${row.slug} has rank ${row.rank}, expected ${i + 1}`;
    if (slugs.has(row.slug)) return `duplicate slug ${row.slug}`;
    slugs.add(row.slug);
    const source = bySlug.get(row.slug);
    if (!source) return `row ${row.slug} is not in the snapshot`;
    if (row.name !== source.name) return `row ${row.slug} has the wrong name`;
    if (row.token_status !== "pre-token") return `row ${row.slug} is not pre-token`;
    if (!Number.isFinite(row.implied_value_usd) || row.implied_value_usd <= 0) {
      return `row ${row.slug} has no positive implied value`;
    }
    if (row.implied_value_usd > 1e14) return `row ${row.slug} implied value is implausibly large`;
    if (row.farm_steps.length !== 8) return `row ${row.slug} has ${row.farm_steps.length} farm steps, expected 8`;
    for (const step of row.farm_steps) {
      if (typeof step !== "string" || step.trim().length === 0) {
        return `row ${row.slug} has an empty farm step`;
      }
    }
    if (i > 0) {
      const prev = rows[i - 1];
      if (row.implied_value_usd > prev.implied_value_usd) {
        return `rows are not sorted by implied value at rank ${row.rank}`;
      }
      if (row.implied_value_usd === prev.implied_value_usd && row.slug < prev.slug) {
        return `tied rows are not in slug order at rank ${row.rank}`;
      }
    }
    // Recompute the implied value from the snapshot figures and compare.
    const medians = categoryMedians(snapshot.protocols);
    const rescored = scoreProtocol(source, snapshot.as_of, medians.get(source.category) ?? 0);
    if (rescored.implied !== row.implied_value_usd) {
      return `row ${row.slug} implied value ${row.implied_value_usd} does not match recomputed ${rescored.implied}`;
    }
  }
  const implied = new Set(rows.map((r) => r.implied_value_usd));
  if (implied.size !== rows.length) return "two rows share the same implied value";
  return null;
}
