
const state = {
  readings: [],
  ranges: { chart_th: 24, chart_water: 24 },
  chartsReady: false,
  pollTimer: null,
};

const el = (id) => document.getElementById(id);

// ---formaaatti----------
const fmtTime = (date) =>
  date.toLocaleTimeString("fi-FI", { hour: "2-digit", minute: "2-digit" });

const fmtDate = (date) => `${date.getDate()}.${date.getMonth() + 1}.`;

const fmtNum = (v, decimals = 1) => (v === null || v === undefined || Number.isNaN(v) ? "--" : v.toFixed(decimals));

function trendArrow(current, previous) {
  if (previous === null || previous === undefined || current === null) return { text: "–", cls: "flat" };
  const diff = current - previous;
  if (Math.abs(diff) < 0.05) return { text: "± 0.0", cls: "flat" };
  const arrow = diff > 0 ? "▲" : "▼";
  const cls = diff > 0 ? "up" : "down";
  return { text: `${arrow} ${Math.abs(diff).toFixed(1)}`, cls };
}



// ---- thingSpeakki haku ----------

async function fetchThingSpeak() {
  const { CHANNEL_ID, READ_API_KEY, DEFAULT_RESULTS, FIELDS } = CONFIG;
  const url = new URL(`https://api.thingspeak.com/channels/${CHANNEL_ID}/feeds.json`);
  url.searchParams.set("results", DEFAULT_RESULTS);
  if (READ_API_KEY && READ_API_KEY !== "YOUR_READ_API_KEY") {
    url.searchParams.set("api_key", READ_API_KEY);
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`ThingSpeak-haku epäonnistui (${res.status})`);
  const data = await res.json();

  return (data.feeds || []).map((feed) => ({
    time: new Date(feed.created_at),
    temp: parseFloat(feed[FIELDS.temperature]),
    hum: parseFloat(feed[FIELDS.humidity]),
    water: parseFloat(feed[FIELDS.water]),
  }));
}

// --------datapipeline ----------
async function refreshData() {
  try {
    const readings = await fetchThingSpeak();
    state.readings = readings;

    if (CONFIG.CACHE_LAST_READING && readings.length) {
      try {
        localStorage.setItem("vesivuoto_cache", JSON.stringify(readings.slice(-50)));
      } catch (e) { }
    }

    render();
  } catch (err) {
    console.error(err);

    if (!state.readings.length && CONFIG.CACHE_LAST_READING) {
      try {
        const cached = JSON.parse(localStorage.getItem("vesivuoto_cache") || "[]");
        if (cached.length) {
          state.readings = cached.map((r) => ({ ...r, time: new Date(r.time) }));
          render();
        }
      } catch (e) { }
    }

    setConnectionStatus("offline");
  }
}


function setConnectionStatus(status) {
  const dot = el("connectionDot");
  const text = el("connectionText");
  dot.classList.remove("online", "offline", "stale");
  dot.classList.add(status);

  if (status === "online") {
    text.textContent = "Yhdistetty ThingSpeakiin";
  } else if (status === "stale") {
    text.textContent = "Ei reaaliaikaista dataa";
  } else {
    text.textContent = "Ei yhteyttä";
  }
}

// ---------- Renderi----------
function render() {
  const readings = state.readings;
  if (!readings.length) return;

  const latest = readings[readings.length - 1];
  const previous = readings.length > 1 ? readings[readings.length - 2] : null;
  const isStale = Date.now() - latest.time.getTime() > CONFIG.STALE_AFTER_MS;
  document.querySelector(".app").classList.toggle("is-stale", isStale);

  const staleBanner = el("staleBanner");
  if (isStale) {
    staleBanner.hidden = false;
    el("staleMessage").textContent =
      `Ei reaaliaikaista dataa — viimeisin lukema ${fmtTime(latest.time)}, laite ei ole lähettänyt sen jälkeen`;
    setConnectionStatus("stale");
  } else {
    staleBanner.hidden = true;
    setConnectionStatus("online")
  }
  updateCard("temp", latest.temp, previous?.temp, "temperature", latest.time);
  updateCard("hum", latest.hum, previous?.hum, "humidity", latest.time);
  updateCard("water", latest.water, previous?.water, "water", latest.time);

  el("lastUpdated").textContent = `Päivitetty klo: ${fmtTime(latest.time)}`;

  evaluateAlerts(latest);
  renderTable(readings);
  if (state.chartsReady) {
    drawChart("chart_th");
    drawChart("chart_water");
  }
}

function updateCard(prefix, value, prevValue, thresholdKey, readingTime) {
  el(`${prefix}Value`).textContent = fmtNum(value);
  el(`${prefix}Time`).textContent = `${fmtDate(readingTime)} klo: ${fmtTime(readingTime)}`;

  const trend = trendArrow(value, prevValue);
  const trendEl = el(`${prefix}Trend`);
  trendEl.textContent = trend.text;
  trendEl.className = `trend ${trend.cls}`;

  const card = el(`card-${prefix === "hum" ? "humidity" : prefix === "temp" ? "temp" : "water"}`);
  const isAlert = isOutOfRange(thresholdKey, value);
  card.classList.toggle("alert-active", isAlert);
}

function isOutOfRange(key, value) {
  const t = CONFIG.THRESHOLDS[key];
  if (!t || value === undefined || value === null) return false;
  if (t.min !== undefined && value < t.min) return true;
  if (t.max !== undefined && value > t.max) return true;
  return false;
}

function evaluateAlerts(latest) {
  const problems = [];
  if (isOutOfRange("temperature", latest.temp)) {
    problems.push(`Lämpötila poikkeaa normaalista (${fmtNum(latest.temp)} °C)`);
  }
  if (isOutOfRange("humidity", latest.hum)) {
    problems.push(`Ilmankosteus koholla (${fmtNum(latest.hum)} %)`);
  }
  if (isOutOfRange("water", latest.water)) {
    problems.push(`Mahdollinen vesivuoto havaittu (VMA303: ${fmtNum(latest.water)} %)`);
  }

  const banner = el("alertBanner");
  const statusCard = el("card-status");
  const statusText = el("systemStatus");
  const statusIcon = statusCard.querySelector(".card-icon");

  statusCard.classList.remove("ok", "warn", "alert");

  if (problems.length === 0) {
    banner.hidden = true;
    statusText.textContent = "OK";
    statusCard.classList.add("ok");
    statusIcon.textContent = "🟢";
  } else {
    banner.hidden = false;
    el("alertMessage").textContent = problems.join(" · ");
    statusText.textContent = problems.length > 1 ? "MONTA HÄLYTYSTÄ" : "HÄLYTYS";
    statusCard.classList.add("alert");
    statusIcon.textContent = "🔴";
  }
}


function renderTable(readings) {
  const body = el("readingsBody");
  const rows = readings.slice(-12).reverse();
  body.innerHTML = rows
    .map((r) => {
      const tempAlert = isOutOfRange("temperature", r.temp);
      const humAlert = isOutOfRange("humidity", r.hum);
      const waterAlert = isOutOfRange("water", r.water);
      const alert = tempAlert || humAlert || waterAlert;
      const badge = alert
        ? '<span class="badge badge-alert">Hälytys</span>'
        : '<span class="badge badge-ok">OK</span>';
      return `<tr>
        <td>${fmtDate(r.time)}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ${fmtTime(r.time)}</td>
        <td class="${tempAlert ? "cell-alert" : ""}">${fmtNum(r.temp)}</td>
        <td class="${humAlert ? "cell-alert" : ""}">${fmtNum(r.hum)}</td>
        <td class="${waterAlert ? "cell-alert" : ""}">${fmtNum(r.water)}</td>
        <td>${badge}</td>
      </tr>`;
    })
    .join("");
}

// ---------- chartit ----------

function sliceForRange(range) {
  if (range === "all") return state.readings;
  const cutoffMs = Date.now() - range * 60 * 60 * 1000; // range tunteina
  return state.readings.filter((r) => r.time.getTime() >= cutoffMs);
}

function drawChart(id) {
  const range = state.ranges[id];
  const data = sliceForRange(range);
  if (!data.length) return;

  const table = new google.visualization.DataTable();
  table.addColumn("datetime", "Aika");

  const isTh = id === "chart_th";
  if (isTh) {
    table.addColumn("number", "Lämpötila (°C)");
    table.addColumn("number", "Kosteus (%)");
    table.addRows(data.map((r) => [r.time, r.temp, r.hum]));
  } else {
    table.addColumn("number", "Vedenpinta / kosteus (%)");
    table.addRows(data.map((r) => [r.time, r.water]));
  }

  const isSmall = window.innerWidth < 620;

  const options = {
    backgroundColor: "transparent",
    colors: isTh ? ["#ff9f5b", "#5b9dff"] : ["#3fd0c9"],
    chartArea: { left: isSmall ? 40 : 55, top: 20, right: 16, bottom: 40 },
    legend: isTh ? { position: "top", textStyle: { color: "#93a1bd", fontSize: 12 } } : { position: "none" },
    hAxis: {
      textStyle: { color: "#93a1bd", fontSize: 11 },
      gridlines: { color: "#1c2740" },
      format: "d.M.",
    },
    vAxis: {
      textStyle: { color: "#93a1bd", fontSize: 11 },
      gridlines: { color: "#1c2740" },
      baselineColor: "#24314f",
    },
    curveType: "function",
    lineWidth: 2.5,
    pointSize: 3,
    fontName: "Inter",
    tooltip: { textStyle: { fontName: "Inter" } },
  };

  const chart = new google.visualization.LineChart(el(id));
  chart.draw(table, options);
  el(id)._chartRef = { chart, table, options };
}

function redrawAllCharts() {
  if (!state.chartsReady) return;
  drawChart("chart_th");
  drawChart("chart_water");
}

// ---------- rangee ----------

function wireRangeButtons() {
  document.querySelectorAll(".range-buttons").forEach((group) => {
    const target = group.dataset.target;
    group.querySelectorAll(".range-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        group.querySelectorAll(".range-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const range = btn.dataset.range === "all" ? "all" : parseInt(btn.dataset.range, 10);
        state.ranges[target] = range;
        drawChart(target);
      });
    });
  });
}

// --------init --------

function init() {


  wireRangeButtons();
  if (typeof google !== "undefined" && google.charts) {
    try {
      google.charts.load("current", { packages: ["corechart"] });
      google.charts.setOnLoadCallback(() => {
        state.chartsReady = true;
        render();
      });
    } catch (err) {
      console.warn("Google Charts ei latautunut, kaaviot piilotetaan.", err);
      hideCharts();
    }
  } else {
    console.warn("Google Charts -kirjastoa ei löytynyt, kaaviot piilotetaan.");
    hideCharts();
  }

  refreshData();
  state.pollTimer = setInterval(refreshData, CONFIG.POLL_INTERVAL_MS);

  window.addEventListener("resize", debounce(redrawAllCharts, 200));
}

function hideCharts() {
  document.querySelectorAll(".panel").forEach((panel) => {
    const chartDiv = panel.querySelector(".chart");
    if (chartDiv) {
      chartDiv.innerHTML =
        '<p style="color:var(--text-secondary);font-size:13px;padding:20px 4px;">Kaaviota ei voitu ladata (ei yhteyttä Google Chartsiin). Lukemat näkyvät alla olevassa taulukossa.</p>';
    }
  });
}

function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

document.addEventListener("DOMContentLoaded", init);
