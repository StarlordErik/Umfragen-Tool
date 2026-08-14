const app = document.getElementById("results-app");
const mode = window.RESULTS_MODE || "rankings";
const pageRoute = mode === "oils" ? "/einzelne-oel-wertungen" : "/ergebnisse";
const revealedOils = new Set();
const openOils = new Set();
const openRankings = new Set();
const expandedRankings = new Set();
const commentScrollPositions = new Map();
const PASSWORD_KEY = "oil_tasting_results_password";

const state = {
  password: window.sessionStorage?.getItem(PASSWORD_KEY) || "",
  payload: null,
  allRankingsExpanded: false,
};

function text(path, fallback = "") {
  let node = window.UI_TEXTS || {};
  for (const key of path) {
    if (!node || typeof node !== "object" || !(key in node)) return fallback;
    node = node[key];
  }
  return typeof node === "string" ? node : fallback;
}

function globalText(key, fallback = "") {
  return text(["global", key], fallback);
}

function routeText(key, fallback = "") {
  return text([pageRoute, key], fallback);
}

function resultsText(key, fallback = "") {
  return text(["/ergebnisse", key], fallback);
}

function oilText(key, fallback = "") {
  return text(["/einzelne-oel-wertungen", key], fallback);
}

function categoryText(key, fallback = "") {
  return text(["/einzelne-oel-wertungen", "categories", key], fallback);
}

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const number = (value) => (value === null || value === undefined ? globalText("open_value", "offen") : Number(value).toFixed(2).replace(".", ","));
const currency = (value) => (value === null || value === undefined ? globalText("open_value", "offen") : `${number(value)} €`);
const signedCurrency = (value) => {
  if (value === null || value === undefined) return globalText("open_value", "offen");
  const numeric = Number(value);
  const sign = numeric >= 0 ? "+" : "-";
  return `${sign}${Math.abs(numeric).toFixed(2).replace(".", ",")} €`;
};
const signedWholeCurrency = (value) => {
  if (value === null || value === undefined) return globalText("open_value", "offen");
  const numeric = Number(value);
  const rounded = Math.round(Math.abs(numeric));
  const sign = rounded === 0 ? "" : numeric >= 0 ? "+" : "-";
  return `${sign}${rounded} €`;
};
const realCurrency = (value) => (value === null || value === undefined ? oilText("real_price_unknown", "Realpreis unbekannt") : `${Number(value).toFixed(0)} €/l`);
const percent = (value) => (value === null || value === undefined ? globalText("open_value", "offen") : `${Math.round(value * 100)}%`);
const rank = (value) => (value ? `${resultsText("rank_prefix", "Platz")} ${value}` : resultsText("rank_missing", "ohne Rang"));
const isMobileView = () => window.matchMedia("(max-width: 860px)").matches;
const pageHeading = () => routeText("heading", mode === "oils" ? "Aufschlüsselung je Öl" : "Ergebnisse");
const pageEyebrow = () => routeText("eyebrow", mode === "oils" ? "detaillierte Ergebnisse" : "Live-Auswertung");

async function loadResults() {
  if (!state.password) {
    renderLogin();
    return;
  }

  const response = await fetch(`/api/results?password=${encodeURIComponent(state.password)}`, { credentials: "same-origin" });
  const payload = await response.json();
  if (!payload.ok) {
    window.sessionStorage?.removeItem(PASSWORD_KEY);
    state.password = "";
    renderLogin(payload.error || "Passwort ist falsch.");
    return;
  }

  state.payload = payload;
  render(payload);
}

function renderLogin(error = "") {
  app.innerHTML = `
    <section class="results-header">
      <div>
        <p class="eyebrow">${escapeHtml(pageEyebrow())}</p>
        <h1>${escapeHtml(pageHeading())}</h1>
        <p class="lead">${escapeHtml(routeText("login_lead", "Passwort eingeben, um die Ergebnisse zu öffnen."))}</p>
      </div>
      <div class="topbar-actions">
        <a class="ghost-button" href="/">${escapeHtml(globalText("home_button", "zurück zur Startseite"))}</a>
      </div>
    </section>

    <form class="setup-editor oil-login-panel" action="/ergebnisse/login" method="post" data-login-form="results">
      <label>
        ${escapeHtml(globalText("password_label", "Passwort"))}
        <input id="results-password" name="results-password" type="password" autocomplete="section-results current-password" autofocus>
      </label>
      <div class="setup-actions">
        <p class="notice ${error ? "error" : ""}">${escapeHtml(error || " ")}</p>
        <button class="save-button" type="button" data-action="login-results">${escapeHtml(globalText("login_button", "Öffnen"))}</button>
      </div>
    </form>
  `;
}

function render(payload) {
  rememberCommentScroll();
  const { summary } = payload;
  const updated = summary.updated_at
    ? new Date(summary.updated_at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : routeText("no_data_updated", "noch keine Daten");

  app.innerHTML = `
    <section class="results-header">
      <div>
        <p class="eyebrow">${escapeHtml(pageEyebrow())}</p>
        <h1>${escapeHtml(pageHeading())}</h1>
        <p class="lead">${escapeHtml(routeText("updated_prefix", "Aktualisiert:"))} ${escapeHtml(updated)}</p>
      </div>
      <div class="topbar-actions results-actions">
        <a class="ghost-button" href="/">${escapeHtml(globalText("home_button", "zurück zur Startseite"))}</a>
      </div>
    </section>

    ${
      mode === "rankings"
        ? `<section class="kpi-grid compact">
            ${metricCard(resultsText("tester_count", "Probanden"), summary.tester_count)}
            ${metricCard(resultsText("response_count", "abgegebene Wertungen"), summary.response_count, `${summary.expected_responses || 0} ${globalText("possible_suffix", "möglich")}`)}
          </section>`
        : ""
    }

    ${mode === "oils" ? renderOilSection(payload) : renderRankingSection(payload)}
  `;
  restoreCommentScroll();
}

function renderRankingSection(payload) {
  const forceExpanded = state.allRankingsExpanded && !isMobileView();
  return `
    <section class="overview-section">
      ${renderOverallChart(payload)}
      ${renderPriceScatterChart(payload)}
      <div class="section-heading ranking-section-heading">
        <div>
          <h2>${escapeHtml(resultsText("ranking_heading", "Ranglisten"))}</h2>
          <p>${escapeHtml(resultsText("ranking_subtitle", "Alle Öle, Probanden und Testreihen."))}</p>
        </div>
        <button class="ghost-button desktop-only" type="button" data-action="toggle-all-rankings">${escapeHtml(forceExpanded ? resultsText("collapse_all", "Top 3 anzeigen") : resultsText("expand_all", "alle aufklappen"))}</button>
      </div>
      <div class="ranking-grid">
        ${payload.rankings.map((ranking) => renderRankingCard(ranking, `global-${ranking.key}`)).join("")}
      </div>
      <div class="detail-link-panel">
        <a class="ghost-button" href="/einzelne-oel-wertungen">${escapeHtml(resultsText("detail_link", "Aufschlüsselung je Öl"))}</a>
      </div>
    </section>
  `;
}

function renderOverallChart(payload) {
  const surveys = payload.config.surveys || [];
  const oils = overallChartOils(payload);
  const hasValues = oils.some((oil) => surveys.some((survey) => oil.overall.by_survey[survey.id]?.avg !== null && oil.overall.by_survey[survey.id]?.avg !== undefined));
  if (!hasValues) {
    return `
      <article class="metric-card overall-chart-card empty-chart">
        <h2>${escapeHtml(resultsText("chart_title", "Gesamteindruck je Öl"))}</h2>
        <p class="notice">${escapeHtml(resultsText("chart_empty", "Noch keine Gesamteindruck-Werte."))}</p>
      </article>
    `;
  }

  return `
    <article class="metric-card overall-chart-card">
      <div class="overall-chart-heading">
        <div>
          <h2>${escapeHtml(resultsText("chart_title", "Gesamteindruck je Öl"))}</h2>
          <p class="metric-sub">${escapeHtml(resultsText("chart_subtitle", "Gruppierte Wertungen aus Geschmack, Geruch und Erfahrung."))}</p>
        </div>
        <div class="overall-chart-legend">
          ${surveys.map((survey) => `<span><i style="--legend-color:${escapeHtml(survey.accent || "#d49b2b")}"></i>${escapeHtml(seriesLabel(survey))}</span>`).join("")}
          <span><i class="mean-key"></i>${escapeHtml(resultsText("chart_mean_label", "Mittelwert"))}</span>
        </div>
      </div>
      <div class="overall-chart-scroll">
        <div class="overall-chart-frame" style="--oil-count:${escapeHtml(Math.max(1, oils.length))}">
          <div class="overall-y-labels">
            ${oils.map((oil) => `<span title="${escapeHtml(oil.name)}">${escapeHtml(oil.name)}</span>`).join("")}
          </div>
          <div class="overall-chart-plot">
            ${renderChartGridLines()}
            <div class="overall-chart-groups">
              ${oils.map((oil) => renderOverallGroup(oil, surveys)).join("")}
            </div>
          </div>
          <div></div>
          <div class="overall-x-axis">${renderChartXAxis()}</div>
        </div>
      </div>
    </article>
  `;
}

function overallChartOils(payload) {
  const byId = new Map((payload.oils || []).map((oil) => [oil.id, oil]));
  const ranked = findRanking(payload.rankings || [], "overall_all")?.items || [];
  const ordered = ranked.map((item) => byId.get(item.oil_id)).filter(Boolean);
  const used = new Set(ordered.map((oil) => oil.id));
  const rest = (payload.oils || [])
    .filter((oil) => !used.has(oil.id))
    .sort((a, b) => a.name.localeCompare(b.name, "de-DE"));
  return [...ordered, ...rest];
}

function chartTicks() {
  return [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];
}

function renderChartXAxis() {
  return chartTicks()
    .map((value) => `<span style="left:${escapeHtml(chartX(value))}%">${escapeHtml(value)}</span>`)
    .join("");
}

function renderChartGridLines() {
  return chartTicks()
    .map((value) => `<span class="overall-grid-line ${value === 0 ? "zero" : ""}" style="left:${escapeHtml(chartX(value))}%"></span>`)
    .join("");
}

function renderOverallGroup(oil, surveys) {
  const mean = oil.overall.all.avg;
  return `
    <div class="overall-chart-group" title="${escapeHtml(oil.name)}">
      <div class="overall-bars">
        ${surveys.map((survey) => renderOverallBar(oil.overall.by_survey[survey.id]?.avg, survey.accent)).join("")}
        ${renderMeanLine(mean)}
      </div>
    </div>
  `;
}

function renderOverallBar(value, color) {
  if (value === null || value === undefined) return `<span class="overall-bar-slot empty"></span>`;
  const numeric = Number(value);
  const position = chartX(numeric);
  const left = Math.min(position, 50);
  const width = Math.abs(position - 50);
  const direction = numeric >= 0 ? "positive" : "negative";
  return `
    <span class="overall-bar-slot">
      <span class="overall-bar ${direction}" style="--bar-color:${escapeHtml(color || "#d49b2b")};--bar-left:${escapeHtml(left.toFixed(3))}%;--bar-width:${escapeHtml(Math.max(0.8, width).toFixed(3))}%"></span>
    </span>
  `;
}

function renderMeanLine(value) {
  if (value === null || value === undefined) return "";
  const left = chartX(Number(value));
  return `<span class="overall-mean-line" style="--mean-left:${escapeHtml(left.toFixed(3))}%"></span>`;
}

function chartX(value) {
  return Math.max(0, Math.min(100, ((value + 5) / 10) * 100));
}

function renderPriceScatterChart(payload) {
  const chart = payload.price_scatter || {};
  const points = chart.points || [];
  if (!points.length) {
    return "";
  }
  const max = Math.max(Number(chart.domain?.max) || 0, 1);
  const ticks = priceChartTicks(max);
  return `
    <article class="metric-card price-scatter-card">
      <div class="price-scatter-heading">
        <div>
          <h2>${escapeHtml(resultsText("price_scatter_title", "Geschätzter vs. realer Preis"))}</h2>
          <p class="metric-sub">${escapeHtml(resultsText("price_scatter_subtitle", "Punkte über der Linie wurden höher geschätzt als der reale Preis."))}</p>
        </div>
        <div class="price-scatter-legend">
          <span><i class="over"></i>${escapeHtml(resultsText("price_scatter_over_label", "überschätzt"))}</span>
          <span><i class="under"></i>${escapeHtml(resultsText("price_scatter_under_label", "unterschätzt"))}</span>
          <span><i class="reference"></i>${escapeHtml(resultsText("price_scatter_reference_label", "100%-Linie"))}</span>
        </div>
      </div>
      <div class="price-scatter-frame">
        <div class="price-scatter-y-title">${escapeHtml(resultsText("price_scatter_y_axis", "Schätzung"))}</div>
        <div class="price-scatter-y-axis">
          ${ticks.map((value) => `<span style="top:${escapeHtml(priceChartY(value, max))}%">${escapeHtml(formatPriceTick(value))}</span>`).join("")}
        </div>
        <div class="price-scatter-plot">
          <svg class="price-scatter-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            ${ticks
              .map((value) => {
                const x = priceChartX(value, max);
                const y = priceChartY(value, max);
                return `<line class="price-scatter-grid vertical" x1="${escapeHtml(x)}" y1="0" x2="${escapeHtml(x)}" y2="100"></line><line class="price-scatter-grid horizontal" x1="0" y1="${escapeHtml(y)}" x2="100" y2="${escapeHtml(y)}"></line>`;
              })
              .join("")}
            <line class="price-scatter-reference" x1="0" y1="100" x2="100" y2="0"></line>
          </svg>
          <div class="price-scatter-points">
            ${points.map((point) => renderPriceScatterPoint(point, max)).join("")}
          </div>
        </div>
        <div></div>
        <div></div>
        <div class="price-scatter-x-axis">
          ${ticks.map((value) => `<span style="left:${escapeHtml(priceChartX(value, max))}%">${escapeHtml(formatPriceTick(value))}</span>`).join("")}
        </div>
        <div class="price-scatter-x-title">${escapeHtml(resultsText("price_scatter_x_axis", "Realpreis"))}</div>
      </div>
    </article>
  `;
}

function renderPriceScatterPoint(point, max) {
  const actual = Number(point.actual_price_per_liter_eur);
  const guess = Number(point.price_guess_avg);
  const percentValue = Number(point.price_deviation_percent);
  const left = priceChartX(actual, max);
  const top = priceChartY(guess, max);
  const labelSide = left > 62 ? " label-left" : "";
  const title = `${point.name}: Realpreis ${currency(actual)}, Schätzung ${currency(guess)}, ${signedPercentPoints(percentValue)}`;
  return `
    <span
      class="price-scatter-point ${percentValue >= 0 ? "over" : "under"}${labelSide}"
      style="--point-x:${escapeHtml(left)}%;--point-y:${escapeHtml(top)}%"
      title="${escapeHtml(title)}"
      aria-label="${escapeHtml(title)}"
    >
      <span class="price-scatter-dot" aria-hidden="true"></span>
      <span class="price-scatter-label">${escapeHtml(shortOilLabel(point.name))}</span>
    </span>
  `;
}

function shortOilLabel(name) {
  const textValue = String(name || "").replace(/\s+/g, " ").trim();
  if (textValue.length <= 24) return textValue;
  return `${textValue.slice(0, 22).trim()}...`;
}

function priceChartTicks(max) {
  const step = Math.max(1, Math.ceil(max / 4 / 5) * 5);
  const ticks = [];
  for (let value = 0; value < max; value += step) {
    ticks.push(value);
  }
  if (ticks[ticks.length - 1] !== max) ticks.push(max);
  return ticks;
}

function priceChartX(value, max) {
  return Math.max(0, Math.min(100, (Number(value) / max) * 100));
}

function priceChartY(value, max) {
  return Math.max(0, Math.min(100, 100 - (Number(value) / max) * 100));
}

function formatPriceTick(value) {
  return `${Math.round(Number(value))} €`;
}

function renderOilSection(payload) {
  const oils = [...payload.oils].sort((a, b) => a.name.localeCompare(b.name, "de-DE"));
  return `
    <section class="overview-section">
      <div class="oil-grid">
        ${oils.map((oil) => renderOilCard(oil, payload.config.surveys, payload.rankings)).join("")}
      </div>
    </section>
  `;
}

function metricCard(label, value, sub = "") {
  return `
    <article class="metric-card">
      <h2>${escapeHtml(label)}</h2>
      <div class="metric-value">${escapeHtml(value)}</div>
      ${sub ? `<p class="metric-sub">${escapeHtml(sub)}</p>` : ""}
    </article>
  `;
}

function renderRankingCard(ranking, id) {
  const mobile = isMobileView();
  const open = !mobile || openRankings.has(id);
  const forceExpanded = state.allRankingsExpanded && !mobile;
  const expanded = forceExpanded || expandedRankings.has(id);
  const shown = expanded ? ranking.items : ranking.items.slice(0, 3);
  const domain = rankingDomain(ranking.items, ranking);
  const showToggle = ranking.items.length > 3 && !forceExpanded;
  return `
    <article class="metric-card ranking-card ${open ? "open" : ""}" style="--ranking-color:${escapeHtml(rankingColorAccent(ranking))}" data-ranking-card="${escapeHtml(id)}">
      <button class="ranking-card-toggle" type="button" data-action="toggle-ranking-card" data-ranking-id="${escapeHtml(id)}">
        <span class="ranking-card-title">
          <h3>${escapeHtml(ranking.title)}</h3>
          ${ranking.subtitle ? `<p class="metric-sub">${escapeHtml(ranking.subtitle)}</p>` : ""}
        </span>
        <span class="ranking-card-icon">${open ? "-" : "+"}</span>
      </button>
      <div class="ranking-card-body">
        ${ranking.items.length ? `<ol>${shown.map((item, index) => renderRankingItem(item, ranking, "", index, ranking.items.length, domain, expanded)).join("")}</ol>` : `<p class="notice">${escapeHtml(resultsText("no_values", "Noch keine Werte."))}</p>`}
        ${showToggle ? `<button class="text-button ranking-toggle" type="button" data-action="toggle-ranking" data-ranking-id="${escapeHtml(id)}">${expanded ? escapeHtml(resultsText("show_top_3", "Top 3 anzeigen")) : escapeHtml(resultsText("show_all", "Alle anzeigen"))}</button>` : ""}
      </div>
    </article>
  `;
}

function renderRankingItem(item, ranking, currentOilId, index, total, domain, showBoxPlot = false) {
  const value = formatByUnit(item.value, ranking.unit);
  const current = item.oil_id === currentOilId ? " current" : "";
  const rankRatio = total <= 1 ? 0 : index / (total - 1);
  const color = rankingColor(ranking, rankRatio);
  const graph = showBoxPlot ? renderRankingGraph(item, ranking, domain) : "";
  return `
    <li class="${current}${graph ? " has-graph" : ""}" style="--rank-bg:${escapeHtml(color)}">
      ${renderRankPlace(item.rank, rankingUsesCrowns(ranking))}
      <span class="rank-name">${escapeHtml(item.name)}</span>
      <strong>${escapeHtml(value)}</strong>
      ${graph}
    </li>
  `;
}

function renderRankPlace(rankValue, useCrown = true) {
  const place = Number(rankValue);
  if (useCrown && [1, 2, 3].includes(place)) {
    return `
      <span class="rank-place crown-place crown-${escapeHtml(place)}" title="${escapeHtml(rank(place))}" aria-label="${escapeHtml(rank(place))}">
        <span class="crown-shape" aria-hidden="true"></span>
        <span class="crown-number">${escapeHtml(place)}</span>
      </span>
    `;
  }
  return `<span class="rank-place">${escapeHtml(rankValue || "")}</span>`;
}

function renderRankingGraph(item, ranking, domain) {
  if (ranking.graph === "price_deviation") return renderPriceDeviationPlot(item, ranking.price_domain);
  if (item.box) return renderBoxPlot(item.box, domain, ranking.unit);
  return "";
}

function renderBoxPlot(box, domain, unit) {
  if (!box || !domain) return "";
  const left = position(box.min, domain);
  const q1 = position(box.q1, domain);
  const medianValue = position(box.median ?? box.avg, domain);
  const q3 = position(box.q3, domain);
  const right = position(box.max, domain);
  const title = `n=${box.count}, min ${formatByUnit(box.min, unit)}, Median ${formatByUnit(box.median ?? box.avg, unit)}, max ${formatByUnit(box.max, unit)}`;
  return `
    <div class="rank-boxplot" title="${escapeHtml(title)}">
      ${renderBoxPlotScale(domain, unit)}
      <span class="boxplot-whisker" style="left:${left}%;width:${Math.max(1, right - left)}%"></span>
      <span class="boxplot-box" style="left:${q1}%;width:${Math.max(1, q3 - q1)}%"></span>
      <span class="boxplot-median" style="left:${medianValue}%"></span>
    </div>
  `;
}

function renderBoxPlotScale(domain, unit = "") {
  const ticks = [];
  for (let index = 0; index <= 4; index += 1) {
    const value = domain.min + ((domain.max - domain.min) * index) / 4;
    const edge = index === 0 ? " first" : index === 4 ? " last" : "";
    const label = edge ? `<em>${escapeHtml(formatScaleLabel(value, unit))}</em>` : "";
    ticks.push(`<span class="${edge}" style="left:${escapeHtml(position(value, domain))}%">${label}</span>`);
  }
  return `<span class="boxplot-scale" aria-hidden="true">${ticks.join("")}</span>`;
}

function formatScaleLabel(value, unit) {
  const rounded = Math.round(Number(value));
  if (unit === "%") return `${Math.round(Number(value) * 100)}%`;
  if (unit === "€" || unit === "€±") return `${rounded} €`;
  return String(rounded);
}

function renderPriceDeviationPlot(item, domain) {
  if (!domain || item.actual_price_per_liter_eur === null || item.actual_price_per_liter_eur === undefined || item.price_guess_avg === null || item.price_guess_avg === undefined) {
    return "";
  }
  const actual = Number(item.actual_price_per_liter_eur);
  const guess = Number(item.price_guess_avg);
  const leftValue = Math.min(actual, guess);
  const rightValue = Math.max(actual, guess);
  const left = position(leftValue, domain);
  const right = position(rightValue, domain);
  const actualPos = position(actual, domain);
  const guessPos = position(guess, domain);
  const direction = guess >= actual ? "over" : "under";
  const eurDeviation = item.price_deviation_eur ?? guess - actual;
  const percentLabel = item.price_deviation_percent === null || item.price_deviation_percent === undefined ? "" : `, ${signedPercentPoints(item.price_deviation_percent)}`;
  return `
    <div class="rank-price-deviation" title="${escapeHtml(`Realpreis ${currency(actual)}, Schätzung ${currency(guess)}${percentLabel}`)}">
      ${renderBoxPlotScale(domain, "€")}
      <span class="price-deviation-range ${direction}" style="left:${escapeHtml(left)}%;width:${escapeHtml(Math.max(1, right - left))}%">
        <span class="price-deviation-label">${escapeHtml(signedWholeCurrency(eurDeviation))}</span>
      </span>
      <span class="price-marker actual" style="left:${escapeHtml(actualPos)}%"></span>
      <span class="price-marker guess" style="left:${escapeHtml(guessPos)}%"></span>
    </div>
  `;
}

function renderOilCard(oil, surveys, rankings) {
  const open = openOils.has(oil.id);
  return `
    <article class="oil-card ${open ? "open" : ""}" data-oil-id="${escapeHtml(oil.id)}">
      <button class="oil-card-toggle" type="button" data-action="toggle-oil" data-oil-id="${escapeHtml(oil.id)}">
        <h3>${escapeHtml(oil.name)}</h3>
        <span>${open ? "-" : "+"}</span>
      </button>

      <div class="oil-card-body">
        <div class="oil-meta-row">
          <span>${escapeHtml(oil.type || "Öl")}</span>
          <span>${escapeHtml(realCurrency(oil.actual_price_per_liter_eur))}</span>
          <span>${escapeHtml(oil.response_count)} ${escapeHtml(oilText("ratings_suffix", "Wertungen"))}</span>
        </div>

        <div class="cipher-box ${revealedOils.has(oil.id) ? "revealed" : ""}">
          <div class="cipher-values">
            ${surveys
              .map((survey) => `<span><b>${escapeHtml(seriesLabel(survey))}</b>${escapeHtml(oil.ciphers[survey.id] || "-")}</span>`)
              .join("")}
          </div>
          ${revealedOils.has(oil.id) ? "" : `<button class="cipher-shield" type="button" data-action="reveal">${escapeHtml(oilText("decrypt_button", "Dechiffrierung aufdecken"))}</button>`}
        </div>

        <div class="oil-stats">
          ${renderBreakdownCategories(oil, surveys, rankings)}
        </div>

        <div class="comment-panel">
          <h4>${escapeHtml(oilText("comments_title", "Kommentare zum Aromaprofil"))}</h4>
          <div class="comment-scroll" data-scroll-key="${escapeHtml(oil.id)}">
            ${oil.comments.length ? oil.comments.map(renderComment).join("") : `<p class="notice">${escapeHtml(oilText("comments_empty", "Noch keine Kommentare."))}</p>`}
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderBreakdownCategories(oil, surveys, rankings) {
  return `
    ${renderCategory(oil, categoryText("overall", "Gesamt"), oil.overall.all.avg, oil.overall.all.rank, findRanking(rankings, "overall_all"), "number", "var(--overall-ranking-color)")}
    ${surveys
      .map((survey) =>
        renderCategory(
          oil,
          seriesLabel(survey),
          oil.overall.by_survey[survey.id]?.avg,
          oil.overall.by_survey[survey.id]?.rank,
          findRanking(rankings, `overall_${survey.id}`),
          "number",
          survey.accent,
        ),
      )
      .join("")}
    ${renderCategory(oil, categoryText("spread", "Streuung"), oil.spread.value, oil.spread.rank, findRanking(rankings, "spread"), "number")}
    ${renderCategory(oil, categoryText("own_spread", "individuelle Streuung"), oil.own_spread.value, oil.own_spread.rank, findRanking(rankings, "own_spread"), "number")}
    ${renderCategory(oil, categoryText("accuracy", "Richtig klassifiziert"), oil.guess.accuracy, oil.guess.rank, findRanking(rankings, "guess_accuracy"), "percent")}
    ${renderCategory(oil, categoryText("bitter", "Bitterkeit"), oil.bitter.avg, oil.bitter.rank, findRanking(rankings, "bitter"), "number")}
    ${renderCategory(oil, categoryText("price_guess", "Geschätzter Preis"), oil.price_guess.avg, oil.price_guess.rank, findRanking(rankings, "price_guess"), "currency")}
    ${renderCategory(oil, categoryText("price_deviation", "Abweichung vom realen Preis"), oil.price_deviation.avg, oil.price_deviation.rank, findRanking(rankings, "price_deviation"), "signed_percent_points")}
  `;
}

function renderCategory(oil, label, value, rankValue, ranking, valueType, color = "") {
  const id = `oil-${oil.id}-${ranking?.key || slugify(label)}`;
  const display = valueType === "percent" ? percent(value) : valueType === "signed_percent_points" ? signedPercentPoints(value) : valueType === "currency" ? currency(value) : valueType === "signed_currency" ? signedCurrency(value) : number(value);
  const categoryColor = color || rankingColorAccent(ranking || {});
  return `
    <details class="category-detail" style="--category-color:${escapeHtml(categoryColor)}">
      <summary>
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(display)}</strong>
        <em>${rankMarkup(rankValue, ranking)}</em>
      </summary>
      ${ranking ? renderMiniRanking(ranking, id, oil.id) : `<p class="notice">${escapeHtml(oilText("no_ranking", "Noch keine Rangliste."))}</p>`}
    </details>
  `;
}

function rankMarkup(rankValue, ranking) {
  const value = Number(rankValue);
  if (!rankingUsesCrowns(ranking) || ![1, 2, 3].includes(value)) return escapeHtml(rank(rankValue));
  return `${escapeHtml(resultsText("rank_prefix", "Platz"))} <span class="rank-crowned-number crown-${escapeHtml(value)}"><span class="inline-rank-crown" aria-hidden="true"></span><span class="rank-crowned-digit">${escapeHtml(value)}</span></span>`;
}

function rankingUsesCrowns(ranking) {
  return !["guess_accuracy", "own_spread"].includes(ranking?.key || "");
}

function renderMiniRanking(ranking, id, currentOilId) {
  const expanded = expandedRankings.has(id);
  const shown = expanded ? ranking.items : ranking.items.slice(0, 3);
  const domain = rankingDomain(ranking.items, ranking);
  return `
    ${ranking.items.length ? `<ol class="mini-ranking" style="--ranking-color:${escapeHtml(rankingColorAccent(ranking))};">${shown.map((item, index) => renderRankingItem(item, ranking, currentOilId, index, ranking.items.length, domain, expanded)).join("")}</ol>` : `<p class="notice">${escapeHtml(resultsText("no_values", "Noch keine Werte."))}</p>`}
    ${ranking.items.length > 3 ? `<button class="text-button ranking-toggle" type="button" data-action="toggle-ranking" data-ranking-id="${escapeHtml(id)}">${expanded ? escapeHtml(resultsText("show_top_3", "Top 3 anzeigen")) : escapeHtml(resultsText("show_all", "Alle anzeigen"))}</button>` : ""}
  `;
}

function renderComment(comment) {
  const author = comment.author ? comment.author : oilText("anonymous", "anonym");
  return `
    <article class="comment-item">
      <span>${escapeHtml(comment.series_label || comment.survey_title || "")} - ${escapeHtml(author)}</span>
      <p>${escapeHtml(comment.text)}</p>
    </article>
  `;
}

function findRanking(rankings, titleOrKey) {
  return rankings.find((ranking) => ranking.title === titleOrKey || ranking.key === titleOrKey || ranking.key === slugify(titleOrKey));
}

function seriesLabel(survey) {
  return survey.series_label || survey.short_title || survey.title || survey.id;
}

function formatByUnit(value, unit) {
  if (unit === "%") return percent(value);
  if (unit === "%±") return signedPercentPoints(value);
  if (unit === "€±") return signedCurrency(value);
  if (unit === "€") return currency(value);
  return number(value);
}

function signedPercentPoints(value) {
  if (value === null || value === undefined) return globalText("open_value", "offen");
  const numeric = Number(value);
  const sign = numeric >= 0 ? "+" : "-";
  return `${sign}${Math.abs(numeric).toFixed(0)}%`;
}

function rankingDomain(items, ranking) {
  if (ranking?.key === "overall_all" || String(ranking?.key || "").startsWith("overall_")) {
    return { min: -5, max: 5 };
  }
  return boxDomain(items);
}

function boxDomain(items) {
  const values = items.flatMap((item) => (item.box ? [item.box.min, item.box.max] : []));
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return { min: min - 1, max: max + 1 };
  return { min, max };
}

function position(value, domain) {
  return Math.max(0, Math.min(100, ((value - domain.min) / (domain.max - domain.min)) * 100));
}

function rankingColorAccent(ranking) {
  if (ranking.color) return ranking.color;
  return "var(--neutral-ranking-color)";
}

function rankingColor(ranking, rankRatio) {
  if (ranking.key === "price_guess") return priceGradientColor(rankRatio);
  const ratio = ranking.key === "guess_accuracy" ? 1 - rankRatio : rankRatio;
  return gradientColor(ratio);
}

function gradientColor(ratio) {
  const hue = 122 - ratio * 122;
  return `hsl(${hue} 34% 18%)`;
}

function priceGradientColor(ratio) {
  const hue = 214 - ratio * 12;
  const saturation = 54 + ratio * 14;
  const lightness = 18 + ratio * 16;
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

function rememberCommentScroll() {
  for (const node of app.querySelectorAll(".comment-scroll[data-scroll-key]")) {
    commentScrollPositions.set(node.dataset.scrollKey, node.scrollTop);
  }
}

function restoreCommentScroll() {
  for (const node of app.querySelectorAll(".comment-scroll[data-scroll-key]")) {
    const top = commentScrollPositions.get(node.dataset.scrollKey);
    if (top !== undefined) node.scrollTop = top;
  }
}

function slugify(value) {
  return String(value)
    .toLocaleLowerCase("de-DE")
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function handleClick(event) {
  const login = event.target.closest('[data-action="login-results"]');
  if (login) {
    state.password = document.getElementById("results-password")?.value || "";
    window.sessionStorage?.setItem(PASSWORD_KEY, state.password);
    loadResults().catch((error) => renderLogin(error.message));
    return;
  }

  const allRankings = event.target.closest('[data-action="toggle-all-rankings"]');
  if (allRankings) {
    state.allRankingsExpanded = !state.allRankingsExpanded;
    if (!state.allRankingsExpanded) expandedRankings.clear();
    if (state.payload) render(state.payload);
    return;
  }

  const rankingCard = event.target.closest('[data-action="toggle-ranking-card"]');
  if (rankingCard) {
    if (!isMobileView()) return;
    const id = rankingCard.dataset.rankingId;
    if (openRankings.has(id)) openRankings.delete(id);
    else openRankings.add(id);
    if (state.payload) render(state.payload);
    return;
  }

  const toggleRanking = event.target.closest('[data-action="toggle-ranking"]');
  if (toggleRanking) {
    const id = toggleRanking.dataset.rankingId;
    if (expandedRankings.has(id)) expandedRankings.delete(id);
    else expandedRankings.add(id);
    if (state.payload) render(state.payload);
    return;
  }

  const oilToggle = event.target.closest('[data-action="toggle-oil"]');
  if (oilToggle) {
    const id = oilToggle.dataset.oilId;
    if (openOils.has(id)) openOils.delete(id);
    else {
      openOils.clear();
      openOils.add(id);
    }
    if (state.payload) render(state.payload);
    return;
  }

  const reveal = event.target.closest('[data-action="reveal"]');
  if (reveal) {
    const card = reveal.closest(".oil-card");
    if (card?.dataset.oilId) revealedOils.add(card.dataset.oilId);
    const box = reveal.closest(".cipher-box");
    box?.classList.add("revealed");
    reveal.remove();
  }
}

app.addEventListener("click", handleClick);

app.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target?.id === "results-password") {
    event.preventDefault();
    app.querySelector('[data-action="login-results"]')?.click();
  }
});

app.addEventListener("submit", (event) => {
  event.preventDefault();
  event.target.querySelector("[data-action]")?.click();
});

let lastMobile = isMobileView();
window.addEventListener("resize", () => {
  const nextMobile = isMobileView();
  if (nextMobile !== lastMobile && state.payload) render(state.payload);
  lastMobile = nextMobile;
});

loadResults().catch((error) => {
  app.innerHTML = `<div class="loading-panel">${escapeHtml(error.message)}</div>`;
});

setInterval(() => {
  if (state.password) loadResults().catch(() => undefined);
}, 2000);
