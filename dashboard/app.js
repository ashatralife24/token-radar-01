// dashboard/app.js — Token Radar dashboard.
//
// Reads the payload in window.RADAR (written by data.js) and renders the
// board: a searchable, filterable, sortable table with three tabs, a detail
// dialog that shows the model breakdown and the farm plan for one protocol,
// and a panel that explains how the score is built. The view state (tab,
// search, filters, sort, open row) lives in the URL hash, so a view can be
// shared with a link and is restored on reload.
//
// The dashboard never fetches anything and never writes anything: it is a
// read-only view of the data the build produced.

(function () {
  "use strict";

  var DATA = window.RADAR;
  var root = document.getElementById("board");
  if (!DATA || !Array.isArray(DATA.rows)) {
    if (root) root.textContent = "Token Radar data is missing. Open this page from the built output directory.";
    return;
  }

  var MODEL = DATA.model;

  // ---- small helpers -------------------------------------------------------

  function esc(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  function round4(value) {
    return Math.round(value * 1e4) / 1e4;
  }

  // Compact dollars: $63.52M, $454.52K, $275.40M.
  function fmtUsd(value) {
    if (value === null || value === undefined) return "—";
    var abs = Math.abs(value);
    if (abs >= 1e9) return "$" + (value / 1e9).toFixed(2) + "B";
    if (abs >= 1e6) return "$" + (value / 1e6).toFixed(2) + "M";
    if (abs >= 1e3) return "$" + (value / 1e3).toFixed(2) + "K";
    return "$" + value.toFixed(0);
  }

  function fmtInt(value) {
    if (value === null || value === undefined) return "—";
    return "$" + Math.round(value).toLocaleString("en-US");
  }

  function fmtPct(value) {
    if (value === null || value === undefined) return "—";
    return (value > 0 ? "+" : "") + value.toFixed(2) + "%";
  }

  function fmtAge(value) {
    if (value === null || value === undefined) return "—";
    return value + "d";
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toISOString().slice(0, 10);
  }

  // ---- model recompute -----------------------------------------------------
  //
  // Recompute a row's implied value from the snapshot figures it carries,
  // using the raw multipliers (the stored ones are rounded for display).
  // The detail dialog compares this with the board's value.

  function impliedOf(row) {
    var change = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var growthPct = clamp(change, MODEL.growth_floor, MODEL.growth_cap);
    var growth = 1 + (growthPct / 100) * MODEL.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? MODEL.unknown_age_days : row.age_days;
    var maturity =
      MODEL.maturity_floor +
      (Math.min(age, MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range;
    var breadth = 1 + Math.min(row.chains.length, MODEL.breadth_cap) * MODEL.breadth_weight;
    var relative =
      1 +
      (clamp(change - row.category_median_growth, -MODEL.relative_cap, MODEL.relative_cap) / 100) *
        MODEL.relative_weight;
    return Math.round(MODEL.scale * Math.pow(row.tvl_usd, MODEL.tvl_power) * growth * maturity * breadth * relative);
  }

  // ---- farm plan -----------------------------------------------------------
  //
  // The same eight-step plan the build attaches to each row, re-derived here
  // from the row's own fields so the detail dialog always agrees with the
  // board. Capital follows the TVL bands, the hold follows the age, and the
  // wording follows the category group.

  function capitalFor(tvl) {
    if (tvl >= 5000000000) return 250;
    if (tvl >= 1000000000) return 150;
    if (tvl >= 100000000) return 100;
    return 50;
  }

  function holdFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }

  function groupFor(category) {
    var c = category.toLowerCase();
    if (c.indexOf("curator") !== -1 || c.indexOf("allocator") !== -1) return "curator";
    if (c.indexOf("dex") !== -1 || c.indexOf("yield") !== -1 || c.indexOf("farming") !== -1 || c.indexOf("index") !== -1) return "dex";
    if (c.indexOf("cdp") !== -1 || c.indexOf("lending") !== -1 || c.indexOf("collateral") !== -1) return "lending";
    if (c === "rwa") return "rwa";
    if (c.indexOf("derivative") !== -1) return "deriv";
    if (c.indexOf("basis") !== -1) return "basis";
    if (c.indexOf("restaking") !== -1 || c.indexOf("staking") !== -1) return "staking";
    if (category === "Chain") return "chain";
    if (c.indexOf("stablecoin") !== -1) return "stable";
    if (c.indexOf("prediction") !== -1) return "prediction";
    if (c.indexOf("payment") !== -1) return "payments";
    if (c.indexOf("bridge") !== -1) return "bridge";
    if (c.indexOf("insurance") !== -1) return "insurance";
    if (c.indexOf("governance") !== -1) return "governance";
    return "generic";
  }

  function mainAction(group, name, chain, capital) {
    switch (group) {
      case "curator":
        return "Deposit $" + capital + " into a " + name + " vault on " + chain + " and keep the shares.";
      case "dex":
        return "Provide $" + capital + " of liquidity to " + name + "'s main pool on " + chain + " and keep the position open.";
      case "lending":
        return "Supply $" + capital + " of USDC to " + name + " on " + chain + " and keep the position open.";
      case "rwa":
        return "Mint $" + capital + " of the protocol's yield asset on " + chain + " and hold it.";
      case "deriv":
        return "Deposit $" + capital + " of USDC as margin on " + name + " and open one small hedge.";
      case "basis":
        return "Deposit $" + capital + " as margin for the basis trade on " + name + " and hold the hedged position.";
      case "staking":
        return "Stake $" + capital + " of the chain's staking asset through " + name + " and keep the receipt.";
      case "chain":
        return "Stake $" + capital + " of the chain's native asset through " + name + " and keep the stake.";
      case "stable":
        return "Mint or deposit $" + capital + " of the stable asset through " + name + " on " + chain + ".";
      case "prediction":
        return "Fund $" + capital + " and place one market position on " + name + ".";
      case "payments":
        return "Route $" + capital + " of payments through " + name + " on " + chain + " and keep the volume flowing.";
      case "bridge":
        return "Bridge $" + capital + " of USDC to " + chain + " through " + name + " and use the bridged funds in its app.";
      case "insurance":
        return "Buy $" + capital + " of cover from " + name + " on " + chain + " and keep the policy.";
      case "governance":
        return "Deposit $" + capital + " into " + name + " on " + chain + " and vote on one proposal.";
      default:
        return "Deposit $" + capital + " of USDC into " + name + " on " + chain + " and keep the position open.";
    }
  }

  var WEEKLY = {
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

  var CHECKS = {
    curator: "Read the curator's latest allocation report and check the vault's holdings match what it claims.",
    dex: "Check the pool's fees and impermanent loss weekly before adding more liquidity.",
    lending: "Check the borrow rate and the health factor weekly so a price move cannot liquidate the position.",
    rwa: "Check the attestation for the underlying real-world asset and confirm the issuer's reserves.",
    deriv: "Check the funding rate and the liquidation price before opening a larger position.",
    stable: "Check the peg and the reserves backing the stable asset weekly.",
    staking: "Check the validator or operator set and the unbonding period before staking more.",
    prediction: "Check the market's resolution rules so you know how a position settles.",
    bridge: "Check the bridge's audited contracts and the time a transfer takes before moving larger sums.",
    insurance: "Read the policy's exclusions so you know exactly what the cover pays for.",
  };

  function farmStepsFor(row) {
    var capital = capitalFor(row.tvl_usd);
    var gas = capital >= 150 ? 8 : 4;
    var group = groupFor(row.category);
    var chain = row.chains[0];
    var hold = holdFor(row.age_days);
    var steps = [];

    steps.push(
      "Use a fresh wallet that holds only the funds you plan to farm on " + chain +
        ", and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.",
    );

    steps.push(
      mainAction(group, row.name, chain, capital) +
        " Cost: $" + capital + " of capital and about $" + gas + " of gas. Time: 15 minutes to set up.",
    );

    if (row.chains.length >= 2) {
      steps.push(
        "Bridge a small test amount to " + row.chains[1] +
          " and repeat the main action there so the activity is recorded on a second chain. " +
          "Cost: about $5 of gas for the bridge. Time: 20 minutes.",
      );
    } else {
      var half = capital / 2;
      if (group === "dex") {
        steps.push(
          "Add a second, smaller position of $" + half + " to another pool on " + chain +
            " so the activity is not a single deposit. Cost: $" + half + " of capital and about $3 of gas. Time: 15 minutes.",
        );
      } else if (group === "lending") {
        steps.push(
          "Borrow a small amount against the $" + capital + " deposit and repay it, so the position shows both sides of the market. " +
            "Cost: $" + half + " of capital and about $3 of gas. Time: 15 minutes.",
        );
      } else if (group === "deriv") {
        steps.push(
          "Open a second, smaller hedge in the opposite direction to show two-sided activity. " +
            "Cost: $" + half + " of capital and about $3 of gas. Time: 15 minutes.",
        );
      } else if (group === "staking") {
        steps.push(
          "Split the stake across two validators or operators so the position is not tied to one of them. " +
            "Cost: $" + half + " of capital and about $3 of gas. Time: 15 minutes.",
        );
      } else {
        steps.push(
          "Repeat the main action with a second, smaller position of $" + half + " so the activity is not a single deposit. " +
            "Cost: $" + half + " of capital and about $3 of gas. Time: 15 minutes.",
        );
      }
    }

    steps.push(
      "Make one qualifying action each week, such as " + (WEEKLY[group] || "a deposit, a borrow, a swap or a vote") +
        ". Cost: about $2 of gas a week. Time: 10 minutes a week.",
    );

    steps.push(
      "Hold the position for at least " + hold + " days so the activity is counted in more than one snapshot. " +
        "Cost: the $" + capital + " stays in the position. Time: " + hold + " days.",
    );

    steps.push(
      "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes. " +
        "Cost: no fee to check, and never pay to claim. Time: 10 minutes.",
    );

    steps.push(
      (CHECKS[group] || "Read the protocol's docs and check what activity its points program actually counts.") +
        " Cost: nothing to check. Time: 10 minutes.",
    );

    steps.push(
      "Write the wallet, the dates and every transaction in a farm log, and unwind the position gradually, keeping enough gas to exit. " +
        "Cost: nothing but the log. Time: 5 minutes to log; 30 minutes to unwind.",
    );

    return steps;
  }

  // ---- state ---------------------------------------------------------------

  var DEFAULT_SORT = {
    pre: { key: "implied_value_usd", dir: -1 },
    live: { key: "mcap_usd", dir: -1 },
    set: { key: "tvl_usd", dir: -1 },
  };

  var state = {
    tab: "pre",
    q: "",
    category: "all",
    chain: "all",
    growth: "all",
    sortKey: DEFAULT_SORT.pre.key,
    sortDir: DEFAULT_SORT.pre.dir,
    selected: null,
  };

  function readHash() {
    var params = new URLSearchParams((location.hash || "").replace(/^#/, ""));
    var tab = params.get("tab");
    if (tab === "pre" || tab === "live" || tab === "set") state.tab = tab;
    state.q = params.get("q") || "";
    state.category = params.get("category") || "all";
    state.chain = params.get("chain") || "all";
    state.growth = params.get("growth") || "all";
    var sortKey = params.get("sort");
    var sortDir = params.get("dir");
    if (sortKey) state.sortKey = sortKey;
    if (sortDir === "asc" || sortDir === "desc") state.sortDir = sortDir === "asc" ? 1 : -1;
    state.selected = params.get("row") || null;
  }

  function writeHash() {
    var params = new URLSearchParams();
    params.set("tab", state.tab);
    if (state.q) params.set("q", state.q);
    if (state.category !== "all") params.set("category", state.category);
    if (state.chain !== "all") params.set("chain", state.chain);
    if (state.growth !== "all") params.set("growth", state.growth);
    params.set("sort", state.sortKey);
    params.set("dir", state.sortDir === 1 ? "asc" : "desc");
    if (state.selected) params.set("row", state.selected);
    history.replaceState(null, "", "#" + params.toString());
  }

  // ---- data access ---------------------------------------------------------

  function tabRows() {
    if (state.tab === "live") return DATA.live;
    if (state.tab === "set") return DATA.set_aside;
    return DATA.rows;
  }

  function matchesGrowth(row) {
    if (state.growth === "all") return true;
    var change = row.change_7d;
    if (state.growth === "up") return change !== null && change !== undefined && change > 0;
    if (state.growth === "down") return change !== null && change !== undefined && change < 0;
    if (state.growth === "unknown") return change === null || change === undefined;
    return true;
  }

  function filteredRows() {
    var rows = tabRows();
    var q = state.q.trim().toLowerCase();
    return rows.filter(function (row) {
      if (state.category !== "all" && row.category !== state.category) return false;
      if (state.chain !== "all" && row.chains.indexOf(state.chain) === -1) return false;
      if (!matchesGrowth(row)) return false;
      if (q) {
        var hay = (row.name + " " + row.slug + " " + row.category).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function compareValues(a, b) {
    if (a === null || a === undefined) return 1;
    if (b === null || b === undefined) return -1;
    if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
    return a - b;
  }

  function sortedRows(rows) {
    var key = state.sortKey;
    var dir = state.sortDir;
    return rows.slice().sort(function (a, b) {
      var diff = compareValues(a[key], b[key]) * dir;
      if (diff !== 0) return diff;
      return a.slug < b.slug ? -1 : 1;
    });
  }

  // ---- rendering -----------------------------------------------------------

  var CATEGORIES = Array.from(new Set(DATA.rows.map(function (r) { return r.category; }))).sort();
  var CHAINS = Array.from(
    new Set(
      DATA.rows.reduce(function (all, r) { return all.concat(r.chains); }, []),
    ),
  ).sort();

  function option(value, label, selected) {
    return '<option value="' + esc(value) + '"' + (selected ? " selected" : "") + ">" + esc(label) + "</option>";
  }

  function stat(label, value) {
    return '<div class="stat"><span class="stat-value">' + esc(value) + '</span><span class="stat-label">' + esc(label) + "</span></div>";
  }

  function renderShell() {
    root.innerHTML =
      '<header class="hero">' +
      "<h1>Token Radar</h1>" +
      '<p class="lede">Pre-token protocols ranked by implied value, from the ' +
      esc(fmtDate(DATA.as_of)) +
      " snapshot. " +
      "The score starts from locked value and adjusts for growth, age, chain breadth and growth against the category median.</p>" +
      '<div class="stats">' +
      stat("Watchlist", DATA.watchlist_size) +
      stat("Board", DATA.board_size) +
      stat("Early", DATA.early_size) +
      stat("Live token", DATA.live_size) +
      stat("Set aside", DATA.set_aside_size) +
      "</div>" +
      '<p class="source">Source: ' + esc(DATA.source) + " · Floor " + fmtUsd(DATA.floor_usd) + " TVL · Model " + esc(DATA.model_version) + "</p>" +
      "</header>" +
      '<section class="controls" aria-label="Filters">' +
      '<div class="control-row">' +
      '<label>Search <input id="q" type="search" placeholder="Name, slug or category" value="' + esc(state.q) + '"></label>' +
      '<label>Category <select id="category">' +
      option("all", "All categories", state.category === "all") +
      CATEGORIES.map(function (c) { return option(c, c, state.category === c); }).join("") +
      "</select></label>" +
      '<label>Chain <select id="chain">' +
      option("all", "All chains", state.chain === "all") +
      CHAINS.map(function (c) { return option(c, c, state.chain === c); }).join("") +
      "</select></label>" +
      '<label>7-day growth <select id="growth">' +
      option("all", "Any growth", state.growth === "all") +
      option("up", "Growing", state.growth === "up") +
      option("down", "Falling", state.growth === "down") +
      option("unknown", "No 7-day change", state.growth === "unknown") +
      "</select></label>" +
      "</div>" +
      '<div class="tabs" role="tablist">' +
      '<button type="button" data-tab="pre" role="tab" aria-selected="' + (state.tab === "pre") + '">Pre-token (' + DATA.board_size + ")</button>" +
      '<button type="button" data-tab="live" role="tab" aria-selected="' + (state.tab === "live") + '">Live token (' + DATA.live_size + ")</button>" +
      '<button type="button" data-tab="set" role="tab" aria-selected="' + (state.tab === "set") + '">Set aside (' + DATA.set_aside_size + ")</button>" +
      "</div>" +
      "</section>" +
      '<section class="table-wrap"><div id="count" class="count"></div><table id="table"></table></section>' +
      '<section class="model-panel" id="model-panel"></section>' +
      '<dialog id="detail" class="detail"></dialog>';
    bindControls();
    renderModelPanel();
  }

  function bindControls() {
    var q = document.getElementById("q");
    var category = document.getElementById("category");
    var chain = document.getElementById("chain");
    var growth = document.getElementById("growth");
    q.addEventListener("input", function () { state.q = q.value; renderTable(); });
    category.addEventListener("change", function () { state.category = category.value; renderTable(); });
    chain.addEventListener("change", function () { state.chain = chain.value; renderTable(); });
    growth.addEventListener("change", function () { state.growth = growth.value; renderTable(); });
    Array.prototype.forEach.call(document.querySelectorAll(".tabs button"), function (button) {
      button.addEventListener("click", function () {
        state.tab = button.getAttribute("data-tab");
        var def = DEFAULT_SORT[state.tab];
        state.sortKey = def.key;
        state.sortDir = def.dir;
        renderShell();
        renderTable();
      });
    });
    var dialog = document.getElementById("detail");
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) closeDetail();
    });
    dialog.addEventListener("close", function () {
      if (state.selected) { state.selected = null; writeHash(); }
    });
  }

  function headerCell(key, label, numeric) {
    var arrow = "";
    if (state.sortKey === key) arrow = state.sortDir === 1 ? " ▲" : " ▼";
    return (
      '<th data-sort="' + key + '" class="' + (numeric ? "num" : "") + '" scope="col">' + esc(label) + arrow + "</th>"
    );
  }

  function renderTable() {
    var table = document.getElementById("table");
    var count = document.getElementById("count");
    var rows = sortedRows(filteredRows());
    var total = tabRows().length;
    count.textContent =
      rows.length === total
        ? total + " rows"
        : rows.length + " of " + total + " rows shown";

    var head = "";
    var body = "";
    if (state.tab === "pre") {
      head =
        "<tr>" +
        headerCell("rank", "Rank", true) +
        headerCell("name", "Protocol") +
        headerCell("category", "Category") +
        headerCell("tvl_usd", "TVL", true) +
        headerCell("change_7d", "7d", true) +
        headerCell("age_days", "Age", true) +
        headerCell("implied_value_usd", "Implied", true) +
        "</tr>";
      body = rows
        .map(function (row) {
          var changeClass = row.change_7d === null || row.change_7d === undefined ? "" : row.change_7d < 0 ? "neg" : "pos";
          return (
            '<tr data-slug="' + esc(row.slug) + '" tabindex="0">' +
            '<td class="num">' + row.rank + "</td>" +
            '<td><span class="name">' + esc(row.name) + "</span><span class=\"slug\">" + esc(row.slug) + "</span></td>" +
            "<td>" + esc(row.category) + "</td>" +
            '<td class="num">' + fmtUsd(row.tvl_usd) + "</td>" +
            '<td class="num ' + changeClass + '">' + fmtPct(row.change_7d) + "</td>" +
            '<td class="num">' + fmtAge(row.age_days) + "</td>" +
            '<td class="num strong">' + fmtUsd(row.implied_value_usd) + "</td>" +
            "</tr>"
          );
        })
        .join("");
    } else if (state.tab === "live") {
      head =
        "<tr>" +
        headerCell("name", "Protocol") +
        headerCell("category", "Category") +
        headerCell("tvl_usd", "TVL", true) +
        headerCell("mcap_usd", "Market cap", true) +
        headerCell("change_7d", "7d", true) +
        "</tr>";
      body = rows
        .map(function (row) {
          var changeClass = row.change_7d === null || row.change_7d === undefined ? "" : row.change_7d < 0 ? "neg" : "pos";
          return (
            "<tr>" +
            '<td><span class="name">' + esc(row.name) + "</span><span class=\"slug\">" + esc(row.slug) + "</span></td>" +
            "<td>" + esc(row.category) + "</td>" +
            '<td class="num">' + fmtUsd(row.tvl_usd) + "</td>" +
            '<td class="num">' + fmtUsd(row.mcap_usd) + "</td>" +
            '<td class="num ' + changeClass + '">' + fmtPct(row.change_7d) + "</td>" +
            "</tr>"
          );
        })
        .join("");
    } else {
      head =
        "<tr>" +
        headerCell("name", "Protocol") +
        headerCell("category", "Category") +
        headerCell("tvl_usd", "TVL", true) +
        headerCell("mcap_usd", "Market cap", true) +
        "</tr>";
      body = rows
        .map(function (row) {
          return (
            "<tr>" +
            '<td><span class="name">' + esc(row.name) + "</span><span class=\"slug\">" + esc(row.slug) + "</span></td>" +
            "<td>" + esc(row.category) + "</td>" +
            '<td class="num">' + fmtUsd(row.tvl_usd) + "</td>" +
            '<td class="num">' + fmtUsd(row.mcap_usd) + "</td>" +
            "</tr>"
          );
        })
        .join("");
    }

    table.innerHTML = "<thead>" + head + "</thead><tbody>" + body + "</tbody>";

    Array.prototype.forEach.call(table.querySelectorAll("th[data-sort]"), function (th) {
      th.addEventListener("click", function () {
        var key = th.getAttribute("data-sort");
        if (state.sortKey === key) state.sortDir = -state.sortDir;
        else { state.sortKey = key; state.sortDir = -1; }
        renderTable();
      });
    });
    Array.prototype.forEach.call(table.querySelectorAll("tr[data-slug]"), function (tr) {
      tr.addEventListener("click", function () { openDetail(tr.getAttribute("data-slug")); });
      tr.addEventListener("keydown", function (event) {
        if (event.key === "Enter") openDetail(tr.getAttribute("data-slug"));
      });
    });
    writeHash();
  }

  function renderModelPanel() {
    var panel = document.getElementById("model-panel");
    var m = MODEL;
    panel.innerHTML =
      "<h2>How the score is built</h2>" +
      "<p>Implied value = " + m.scale + " × TVL<sup>" + m.tvl_power + "</sup> × growth × maturity × breadth × relative growth. " +
      "Each multiplier is clamped, so no single signal dominates: growth is capped between " + m.growth_floor + "% and +" + m.growth_cap +
      "%, maturity rises from " + m.maturity_floor + " to " + (m.maturity_floor + m.maturity_range) + " over " + m.maturity_days +
      " days, breadth adds " + m.breadth_weight + " per chain up to " + m.breadth_cap +
      " chains, and relative growth compares a protocol with its category median, capped at ±" + m.relative_cap + " points.</p>" +
      '<dl class="constants">' +
      "<div><dt>Scale</dt><dd>" + m.scale + "</dd></div>" +
      "<div><dt>TVL power</dt><dd>" + m.tvl_power + "</dd></div>" +
      "<div><dt>Growth weight</dt><dd>" + m.growth_weight + "</dd></div>" +
      "<div><dt>Growth clamp</dt><dd>" + m.growth_floor + "% to +" + m.growth_cap + "%</dd></div>" +
      "<div><dt>Maturity</dt><dd>" + m.maturity_floor + " + up to " + m.maturity_range + " over " + m.maturity_days + " days</dd></div>" +
      "<div><dt>Unknown age</dt><dd>" + m.unknown_age_days + " days</dd></div>" +
      "<div><dt>Breadth</dt><dd>+" + m.breadth_weight + " per chain, max " + m.breadth_cap + "</dd></div>" +
      "<div><dt>Relative weight</dt><dd>" + m.relative_weight + ", capped at ±" + m.relative_cap + "</dd></div>" +
      "</dl>" +
      "<p>Wrapped, staked and bridged products are set aside by a generic rule — category or name pattern, never a hand-picked list — " +
      "because they wrap an asset that already exists. Live-token protocols are shown for context and are never ranked.</p>";
  }

  // ---- detail dialog -------------------------------------------------------

  function findRow(slug) {
    for (var i = 0; i < DATA.rows.length; i += 1) {
      if (DATA.rows[i].slug === slug) return DATA.rows[i];
    }
    return null;
  }

  function openDetail(slug) {
    var row = findRow(slug);
    if (!row) return;
    state.selected = slug;
    var dialog = document.getElementById("detail");
    var recomputed = impliedOf(row);
    var matches = recomputed === row.implied_value_usd;
    var steps = farmStepsFor(row);
    dialog.innerHTML =
      '<form method="dialog" class="detail-head"><h2>' + esc(row.name) + "</h2>" +
      '<button type="submit" class="close" aria-label="Close">Close</button></form>' +
      '<p class="detail-sub">Rank ' + row.rank + " · " + esc(row.category) + " · " + esc(row.chains.join(", ")) + "</p>" +
      '<dl class="facts">' +
      "<div><dt>TVL</dt><dd>" + fmtUsd(row.tvl_usd) + "</dd></div>" +
      "<div><dt>7-day change</dt><dd>" + fmtPct(row.change_7d) + "</dd></div>" +
      "<div><dt>Listed</dt><dd>" + fmtDate(row.listed_at) + "</dd></div>" +
      "<div><dt>Age</dt><dd>" + fmtAge(row.age_days) + "</dd></div>" +
      "<div><dt>Implied value</dt><dd>" + fmtInt(row.implied_value_usd) + "</dd></div>" +
      "</dl>" +
      "<h3>Model breakdown</h3>" +
      '<dl class="facts">' +
      "<div><dt>Scale</dt><dd>" + MODEL.scale + " × TVL<sup>" + MODEL.tvl_power + "</sup></dd></div>" +
      "<div><dt>Growth</dt><dd>×" + row.growth_multiplier + "</dd></div>" +
      "<div><dt>Maturity</dt><dd>×" + row.maturity_multiplier + "</dd></div>" +
      "<div><dt>Breadth</dt><dd>×" + row.breadth_multiplier + "</dd></div>" +
      "<div><dt>Relative growth</dt><dd>×" + row.relative_growth_multiplier + "</dd></div>" +
      "<div><dt>Category median 7d</dt><dd>" + fmtPct(row.category_median_growth) + "</dd></div>" +
      "</dl>" +
      '<p class="recompute">' + (matches
        ? "Recomputed implied value " + fmtInt(recomputed) + " matches the board."
        : "Recomputed implied value " + fmtInt(recomputed) + " does not match the board value " + fmtInt(row.implied_value_usd) + ".") + "</p>" +
      "<h3>Farm plan</h3>" +
      '<ol class="steps">' +
      steps.map(function (step) { return "<li>" + esc(step) + "</li>"; }).join("") +
      "</ol>";
    dialog.showModal();
    writeHash();
  }

  function closeDetail() {
    var dialog = document.getElementById("detail");
    if (dialog.open) dialog.close();
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeDetail();
  });

  // ---- init ----------------------------------------------------------------

  readHash();
  renderShell();
  renderTable();
  if (state.selected) openDetail(state.selected);
})();
