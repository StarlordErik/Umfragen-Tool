const app = document.getElementById("results-app");
let latestPayload = null;
let resizeTimer = null;

const colors = ["#2f7d62", "#3b6fb6", "#b65353", "#d49b2b", "#6f5aa7", "#318c9c", "#8d6b2d"];

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const percent = (value) => (value === null || value === undefined ? "offen" : `${Math.round(value * 100)}%`);

async function loadResults() {
  const response = await fetch("/api/results", { credentials: "same-origin" });
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error || "Ergebnisse konnten nicht geladen werden.");
  latestPayload = payload;
  render(payload);
}

function render(payload) {
  const { config, summary } = payload;
  const updated = summary.updated_at ? new Date(summary.updated_at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "noch keine Daten";

  app.innerHTML = `
    <section class="results-header">
      <div>
        <p class="eyebrow">Live-Auswertung</p>
        <h1>${escapeHtml(config.event.title || "Ölverkostung")}</h1>
        <p class="lead">Aktualisiert: ${escapeHtml(updated)}</p>
      </div>
      <div class="topbar-actions">
        <a class="ghost-button" href="/">Links</a>
        <a class="ghost-button" href="/admin">Setup</a>
        <a class="primary-link" href="/api/export.csv">CSV</a>
      </div>
    </section>

    <section class="kpi-grid">
      ${metricCard("Gäste", summary.respondent_count, "Geräte mit gespeicherter Sitzung")}
      ${metricCard("Antworten", summary.response_count, `${summary.expected_responses || 0} möglich`)}
      ${metricCard("Fortschritt", percent(summary.completion_ratio), "über alle drei Links")}
      ${metricCard("Trefferquote", percent(summary.guess_accuracy), `${summary.guess_correct}/${summary.guess_total} Sorten richtig`)}
    </section>

    <section class="chart-grid">
      <article class="metric-card chart-card">
        <h2>Punkte nach Kategorie</h2>
        <canvas id="bar-chart"></canvas>
      </article>
      <article class="metric-card chart-card">
        <h2>Überlagerte Profile</h2>
        <canvas id="radar-chart"></canvas>
      </article>
    </section>

    <section class="chart-grid">
      <article class="metric-card">
        <h2>Öl-Chiffren</h2>
        ${renderResolution(config)}
      </article>
      <article class="metric-card">
        <h2>Öl-Sorte erkannt</h2>
        ${renderAccuracy(payload.oils)}
      </article>
    </section>

    <section class="chart-grid">
      <article class="metric-card">
        <h2>Wortwolke</h2>
        ${renderWordCloud(payload.word_cloud)}
      </article>
      <article class="metric-card">
        <h2>Öl-Übersicht</h2>
        ${renderOilTable(payload.oils, payload.metrics)}
      </article>
    </section>

    <section class="metric-card">
      <h2>Letzte Einträge</h2>
      ${renderRecent(payload.recent_entries)}
    </section>
  `;

  drawAllCharts(payload);
}

function metricCard(label, value, sub) {
  return `
    <article class="metric-card">
      <h2>${escapeHtml(label)}</h2>
      <div class="metric-value">${escapeHtml(value)}</div>
      <p class="metric-sub">${escapeHtml(sub)}</p>
    </article>
  `;
}

function renderResolution(config) {
  const oilNames = Object.fromEntries(config.oils.map((oil) => [oil.id, oil.name]));
  return `
    <div class="resolution-grid">
      ${config.surveys
        .map(
          (survey) => `
            <div>
              <h3>${escapeHtml(survey.short_title || survey.title)}</h3>
              <div class="resolution-list">
                ${survey.samples
                  .map(
                    (sample) => `
                      <div class="resolution-row">
                        <strong>${escapeHtml(sample.cipher)}</strong>
                        <span>${escapeHtml(oilNames[sample.oil_id] || sample.oil_id)}</span>
                      </div>
                    `,
                  )
                  .join("")}
              </div>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderAccuracy(oils) {
  if (!oils.some((oil) => oil.guess_total)) {
    return `<p class="notice">Noch keine Sorten-Tipps gespeichert.</p>`;
  }
  return `
    <div class="resolution-list">
      ${oils
        .map((oil) => {
          const ratio = oil.guess_accuracy ?? 0;
          return `
            <div class="accuracy-row">
              <strong>${escapeHtml(percent(oil.guess_accuracy))}</strong>
              <div>
                <div>${escapeHtml(oil.name)}</div>
                <div class="progress-track"><div class="progress-fill" style="width:${Math.round(ratio * 100)}%"></div></div>
                <div class="metric-sub">${escapeHtml(oil.guess_correct)}/${escapeHtml(oil.guess_total)} richtig als ${escapeHtml(oil.type || "Typ")}</div>
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderWordCloud(words) {
  if (!words?.length) return `<div class="word-cloud"><span>Noch keine Notizen</span></div>`;
  const max = Math.max(...words.map((item) => item.count), 1);
  return `
    <div class="word-cloud">
      ${words
        .map((item, index) => {
          const size = 0.86 + (item.count / max) * 1.9;
          const color = colors[index % colors.length];
          return `<span title="${escapeHtml(item.count)}x" style="font-size:${size.toFixed(2)}rem; --word-color:${color}">${escapeHtml(item.word)}</span>`;
        })
        .join("")}
    </div>
  `;
}

function renderOilTable(oils, metrics) {
  const compactMetrics = metrics.filter((metric) => metric.key !== "confidence").slice(0, 5);
  if (!compactMetrics.length) return `<p class="notice">Noch keine Zahlenwerte gespeichert.</p>`;
  return `
    <div class="data-table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Öl</th>
            ${compactMetrics.map((metric) => `<th>${escapeHtml(metric.label)}</th>`).join("")}
            <th>Antworten</th>
          </tr>
        </thead>
        <tbody>
          ${oils
            .map(
              (oil) => `
                <tr>
                  <td>${escapeHtml(oil.name)}</td>
                  ${compactMetrics.map((metric) => `<td>${metric.oils[oil.id] ? escapeHtml(metric.oils[oil.id].avg) : "offen"}</td>`).join("")}
                  <td>${escapeHtml(oil.response_count)}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderRecent(entries) {
  if (!entries?.length) return `<p class="notice">Noch keine Einträge.</p>`;
  return `
    <div class="data-table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Zeit</th>
            <th>Gast</th>
            <th>IP</th>
            <th>Umfrage</th>
            <th>Chiffre</th>
            <th>Öl</th>
            <th>Antworten</th>
          </tr>
        </thead>
        <tbody>
          ${entries
            .map(
              (entry) => `
                <tr>
                  <td>${escapeHtml(new Date(entry.updated_at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" }))}</td>
                  <td>${escapeHtml(entry.respondent)}</td>
                  <td>${escapeHtml(entry.ip)}</td>
                  <td>${escapeHtml(entry.survey_title)}</td>
                  <td>${escapeHtml(entry.cipher)}</td>
                  <td>${escapeHtml(entry.oil_name)}</td>
                  <td>${escapeHtml(answerSummary(entry.answers))}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function answerSummary(answers) {
  return Object.entries(answers || {})
    .filter(([, value]) => value !== "" && value !== null && value !== undefined)
    .map(([key, value]) => `${key}: ${value}`)
    .join(" · ");
}

function drawAllCharts(payload) {
  drawBarChart(document.getElementById("bar-chart"), payload);
  drawRadarChart(document.getElementById("radar-chart"), payload);
}

function chartMetrics(payload) {
  return payload.metrics
    .filter((metric) => metric.key !== "confidence")
    .filter((metric) => {
      const values = Object.values(metric.oils).filter(Boolean);
      if (!values.length) return false;
      return values.every((item) => Number(item.max ?? 5) <= 10 && Number(item.min ?? 0) >= -10);
    })
    .slice(0, 6);
}

function drawBarChart(canvas, payload) {
  if (!canvas) return;
  const { ctx, width, height } = prepareCanvas(canvas);
  const oils = payload.oils;
  const metrics = chartMetrics(payload);
  const pad = { left: 46, right: 16, top: 22, bottom: 78 };
  ctx.clearRect(0, 0, width, height);

  if (!metrics.length) {
    drawEmpty(ctx, width, height, "Noch keine Werte");
    return;
  }

  const values = [];
  for (const metric of metrics) {
    for (const oil of oils) {
      const item = metric.oils[oil.id];
      if (item) values.push(item.avg);
    }
  }
  const min = Math.min(0, ...values);
  const max = Math.max(5, ...values);
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const zeroY = pad.top + plotHeight - ((0 - min) / (max - min)) * plotHeight;

  drawAxis(ctx, pad, width, height, min, max);

  const groupWidth = plotWidth / metrics.length;
  const barWidth = Math.max(4, Math.min(18, (groupWidth - 18) / oils.length));

  metrics.forEach((metric, groupIndex) => {
    const groupX = pad.left + groupIndex * groupWidth + groupWidth / 2;
    oils.forEach((oil, oilIndex) => {
      const item = metric.oils[oil.id];
      if (!item) return;
      const value = item.avg;
      const x = groupX - (oils.length * barWidth) / 2 + oilIndex * barWidth;
      const y = pad.top + plotHeight - ((value - min) / (max - min)) * plotHeight;
      ctx.fillStyle = colors[oilIndex % colors.length];
      ctx.fillRect(x, Math.min(y, zeroY), barWidth - 1, Math.max(2, Math.abs(zeroY - y)));
    });

    ctx.save();
    ctx.translate(groupX, height - 46);
    ctx.rotate(-Math.PI / 5);
    ctx.fillStyle = "#4f5968";
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(metric.label, 0, 0);
    ctx.restore();
  });

  drawLegend(ctx, oils.map((oil) => oil.name), width, height);
}

function drawRadarChart(canvas, payload) {
  if (!canvas) return;
  const { ctx, width, height } = prepareCanvas(canvas);
  const oils = payload.oils;
  const metrics = chartMetrics(payload).slice(0, 5);
  ctx.clearRect(0, 0, width, height);

  if (metrics.length < 3) {
    drawEmpty(ctx, width, height, "Mehr Kategorien nötig");
    return;
  }

  const centerX = width / 2;
  const centerY = height / 2 - 14;
  const radius = Math.min(width, height) * 0.28;
  const angleStep = (Math.PI * 2) / metrics.length;

  ctx.strokeStyle = "#dbe0e7";
  ctx.fillStyle = "#69707d";
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let ring = 1; ring <= 5; ring += 1) {
    ctx.beginPath();
    for (let index = 0; index < metrics.length; index += 1) {
      const angle = -Math.PI / 2 + index * angleStep;
      const x = centerX + Math.cos(angle) * radius * (ring / 5);
      const y = centerY + Math.sin(angle) * radius * (ring / 5);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  metrics.forEach((metric, index) => {
    const angle = -Math.PI / 2 + index * angleStep;
    const x = centerX + Math.cos(angle) * (radius + 30);
    const y = centerY + Math.sin(angle) * (radius + 24);
    ctx.fillText(metric.label, x, y);
  });

  oils.forEach((oil, oilIndex) => {
    ctx.beginPath();
    metrics.forEach((metric, metricIndex) => {
      const item = metric.oils[oil.id];
      const min = Number(item?.min ?? 0);
      const max = Number(item?.max ?? 5);
      const normalized = item ? Math.max(0, Math.min(1, (item.avg - min) / (max - min || 1))) : 0;
      const angle = -Math.PI / 2 + metricIndex * angleStep;
      const x = centerX + Math.cos(angle) * radius * normalized;
      const y = centerY + Math.sin(angle) * radius * normalized;
      if (metricIndex === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.strokeStyle = colors[oilIndex % colors.length];
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = colors[oilIndex % colors.length];
    ctx.fill();
    ctx.globalAlpha = 1;
  });

  drawLegend(ctx, oils.map((oil) => oil.name), width, height);
}

function prepareCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(320, rect.width);
  const height = Math.max(240, rect.height);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, width, height };
}

function drawAxis(ctx, pad, width, height, min, max) {
  const plotHeight = height - pad.top - pad.bottom;
  ctx.strokeStyle = "#dbe0e7";
  ctx.fillStyle = "#69707d";
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  for (let tick = 0; tick <= 5; tick += 1) {
    const value = min + ((max - min) * tick) / 5;
    const y = pad.top + plotHeight - ((value - min) / (max - min)) * plotHeight;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.fillText(value.toFixed(0), pad.left - 8, y);
  }
}

function drawLegend(ctx, labels, width, height) {
  const startY = height - 24;
  let x = 14;
  ctx.font = "11px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  labels.forEach((label, index) => {
    const text = shorten(label, 22);
    const textWidth = ctx.measureText(text).width;
    if (x + textWidth + 22 > width) return;
    ctx.fillStyle = colors[index % colors.length];
    ctx.fillRect(x, startY - 5, 10, 10);
    ctx.fillStyle = "#4f5968";
    ctx.textAlign = "left";
    ctx.fillText(text, x + 15, startY);
    x += textWidth + 30;
  });
}

function drawEmpty(ctx, width, height, label) {
  ctx.fillStyle = "#69707d";
  ctx.font = "15px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, width / 2, height / 2);
}

function shorten(value, maxLength) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (latestPayload) drawAllCharts(latestPayload);
  }, 120);
});

loadResults().catch((error) => {
  app.innerHTML = `<div class="loading-panel">${escapeHtml(error.message)}</div>`;
});

setInterval(() => {
  loadResults().catch(() => undefined);
}, 2000);
