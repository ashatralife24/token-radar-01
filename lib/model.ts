// The token radar's model, version 2: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and every other
// rankable pre-token protocol. A protocol is pre-token when its index entry records no token (no market
// cap, no CoinGecko id, no symbol), and rankable when it is also not an exchange, not a versioned pool,
// and not a wrapped, staked or bridged product of a token that already trades: those products are set
// aside in their own view with their TVL shown as a fact, never ranked, because the token they wrap
// already trades. The snapshot's live-token protocols are likewise kept apart and shown as the market's
// own values, never mixed into the ranked board.
//
// On this snapshot that is 198 ranked rows (the 40 watchlist protocols plus 158 early ones), 91 wrapped
// products set aside, and 24 live-token protocols set aside; the snapshot is sealed, so these counts do
// not move under the program.
//
// Implied value follows only from the snapshot's own figures:
//
//   size       = tvl_usd ^ 0.65                      (log-scale size: a 10x TVL gap is ~4.5x, not 10x)
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x 1.2
//   maturity   = 0.45 + min(age_days, 1095) / 1095 x 0.55   (age_days unknown: 365)
//   breadth    = 1 + min(chains, 8) x 0.02
//   relative   = 1 + clamp(growth - category_median_growth, -40, 40) / 100 x 0.6
//   implied    = max(1, round(55 x size x growthMult x maturity x breadth x relative))
//
// category_median_growth is the median seven-day growth of the protocol's category in this snapshot,
// rounded to 4 decimals. No protocol name is ever special-cased: the same function scores every row.
// Wrapped, staked and bridged products are recognised by the watchlist's own exclusion rule (category,
// a word in the name, an exchange prefix); the rule lives in isWrappedProduct, and no protocol name is
// ever listed.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
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

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    scale: number;
    tvl_power: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    relative_growth_multiplier: number;
    category_median_growth: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
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

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** A wrapped, staked or bridged product, set aside from the ranking: its TVL is a fact, not a model input. */
export interface SetAsideRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
}

/** Everything the dashboard needs: the board, the set-aside and live sets, and the model it runs. */
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
  rows: RadarRow[];
  live: LiveRow[];
  set_aside: SetAsideRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The median of a list of numbers; 0 for an empty list. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Each category's median seven-day growth across the snapshot's protocols, rounded to 4 decimals. */
function categoryMedians(snapshot: Snapshot): Map<string, number> {
  const byCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.change_7d === null) continue;
    const key = p.category ?? 'Other';
    const list = byCategory.get(key);
    if (list === undefined) byCategory.set(key, [p.change_7d]);
    else list.push(p.change_7d);
  }
  const out = new Map<string, number>();
  for (const [key, values] of byCategory) out.set(key, round4(median(values)));
  return out;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** The watchlist's own exclusion rule for wrapped, staked and bridged products. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whether a protocol is a wrapped, staked or bridged product of a token that already trades. */
export function isWrappedProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGE_PREFIX.test(p.name)) return true;
  return false;
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool, and
 *  not a wrapped, staked or bridged product of a token that already trades. The watchlist's own
 *  exclusion rule decides the last part, so no protocol name is ever listed. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name) && !isWrappedProduct(p);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  categoryMedian: number,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; relMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + Math.min(protocol.chains.length, model.breadth_cap) * model.breadth_weight;
  const relGrowth = Math.min(model.relative_cap, Math.max(-model.relative_cap, growthPct - categoryMedian));
  const relMult = 1 + (relGrowth / 100) * model.relative_weight;
  const size = Math.pow(protocol.tvl_usd, model.tvl_power);
  const implied = Math.max(1, Math.round(model.scale * size * growthMult * maturityMult * breadthMult * relMult));
  return { implied, growthPct, growthMult, maturityMult, breadthMult, relMult, age };
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const medians = categoryMedians(snapshot);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable protocol, below the floor and above it. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen. Wrapped products never reach this loop:
  // isRankable leaves them out.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const categoryMedian = medians.get(p.category ?? 'Other') ?? 0;
    const v = impliedValue(p, snapshot.as_of, model, categoryMedian);
    return { p, categoryMedian, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      scale: model.scale,
      tvl_power: model.tvl_power,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      relative_growth_multiplier: round4(s.relMult),
      category_median_growth: s.categoryMedian,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The second chain a protocol names, or null when it runs on one chain only. */
function secondChainOf(p: SnapshotProtocol): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('basis')) return `Deposit $${capital} as margin for the basis trade on ${name} and hold the hedged position.`;
  if (c.includes('payment')) return `Route $${capital} of payments through ${name} on ${chain} and keep the volume flowing.`;
  if (c.includes('governance') || c.includes('incentive')) return `Deposit $${capital} into ${name} on ${chain} and vote on one proposal.`;
  if (c === 'chain') return `Stake $${capital} of the chain's native asset through ${name} and keep the stake.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A second position on one chain only: deepen the same action instead of bridging nowhere. */
function deepeningFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const small = Math.max(25, Math.floor(capital / 2));
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow a small amount against the $${capital} deposit and repay it, so the position shows both sides of the market.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Add a second, smaller position of $${small} to another pool on ${chain} so the activity is not a single deposit.`;
  if (c.includes('staking') || c.includes('restak')) return `Split the stake across two validators or operators so the position is not tied to one of them.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Open a second, smaller hedge in the opposite direction to show two-sided activity.`;
  if (c.includes('bridge')) return `Bridge a small amount back to the chain you came from so the round trip is recorded.`;
  return `Repeat the main action with a second, smaller position of $${small} so the activity is not a single deposit.`;
}

/** The weekly qualifying action, worded for the category. */
function weeklyActionFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Make one qualifying action each week, such as a deposit, a borrow or a repayment.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Make one qualifying action each week, such as a swap, a deposit or a vote on a pool gauge.`;
  if (c.includes('bridge')) return `Make one qualifying action each week, such as a bridge transfer or a swap on the destination chain.`;
  if (c.includes('staking') || c.includes('restak')) return `Make one qualifying action each week, such as a stake, a restake or a vote.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Make one qualifying action each week, such as a trade, a deposit or a close.`;
  if (c.includes('prediction')) return `Make one qualifying action each week, such as a market position or a settlement claim.`;
  if (c.includes('curator') || c.includes('allocator')) return `Make one qualifying action each week, such as a deposit, a rebalance or a vote.`;
  if (c.includes('stable')) return `Make one qualifying action each week, such as a mint, a deposit or a redemption.`;
  if (c.includes('rwa')) return `Make one qualifying action each week, such as a mint, a hold or a redemption.`;
  if (c.includes('insurance')) return `Make one qualifying action each week, such as a cover purchase or a claim check.`;
  return `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`;
}

/** The diligence check for the category: what to verify before farming more. */
function diligenceFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('curator') || c.includes('allocator')) return `Read the curator's latest allocation report and check the vault's holdings match what it claims.`;
  if (c.includes('rwa')) return `Check the attestation for the underlying real-world asset and confirm the issuer's reserves.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Check the borrow rate and the health factor weekly so a price move cannot liquidate the position.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Check the pool's fees and impermanent loss weekly before adding more liquidity.`;
  if (c.includes('bridge')) return `Check the bridge's audited contracts and the time a transfer takes before moving larger sums.`;
  if (c.includes('staking') || c.includes('restak')) return `Check the validator or operator set and the unbonding period before staking more.`;
  if (c.includes('stable')) return `Check the peg and the reserves backing the stable asset weekly.`;
  if (c.includes('insurance')) return `Read the policy's exclusions so you know exactly what the cover pays for.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Check the funding rate and the liquidation price before opening a larger position.`;
  if (c.includes('prediction')) return `Check the market's resolution rules so you know how a position settles.`;
  return `Read the protocol's docs and check what activity its points program actually counts.`;
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const second = secondChainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const third: FarmStep =
    second !== null
      ? {
          text: `Bridge a small test amount to ${second} and repeat the main action there so the activity is recorded on a second chain.`,
          cost: 'about $5 of gas for the bridge',
          time: '20 minutes',
        }
      : {
          text: deepeningFor(p, capital, chain),
          cost: `$${Math.max(25, Math.floor(capital / 2))} of capital and about $3 of gas`,
          time: '15 minutes',
        };
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm on ${chain}, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    third,
    {
      text: weeklyActionFor(p),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: diligenceFor(p),
      cost: 'nothing to check',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log, and unwind the position gradually, keeping enough gas to exit.`,
      cost: 'nothing but the log',
      time: '5 minutes to log; 30 minutes to unwind',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
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

/** The wrapped, staked and bridged products, set aside from the ranking: pre-token on the record, but
 *  the token they wrap already trades. Shown with TVL as a fact, never scored. By TVL, slug on a tie. */
export function setAsideRows(snapshot: Snapshot): SetAsideRow[] {
  return snapshot.protocols
    .filter((p) => isPreToken(p) && isWrappedProduct(p) && p.category !== 'CEX' && !VERSIONED.test(p.name))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const setAside = setAsideRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    set_aside_size: setAside.length,
    rows: board.map(radarRow),
    live,
    set_aside: setAside,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    // A market cap of zero or less is a sentinel, not a value: treat it as missing.
    const mcap = typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) && p.mcap_usd > 0 ? p.mcap_usd : null;
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: mcap,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
