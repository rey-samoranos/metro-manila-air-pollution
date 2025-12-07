// script.js - Updated to use backend full AQI
const API_BASE_URL = "http://127.0.0.1:8000";

// DOM helpers
const $ = (id) => document.getElementById(id);
const apiAlert = $('apiAlert');
const modelAccuracyElement = $('modelAccuracy');
const locationSelect = $('location');
const dataLoading = $('dataLoading');
const airQualityData = $('airQualityData');
const noDataMessage = $('noDataMessage');
const resultsContainer = $('resultsContainer');
const noResultsMessage = $('noResultsMessage');
const predictBtn = $('predictBtn');
const refreshBtn = $('refreshBtn');
const chartNote = $('chartNote');

const elPm25 = $('actualPm25');
const elPm10 = $('actualPm10');
const elNo2  = $('actualNo2');
const elSo2  = $('actualSo2');
const elCo   = $('actualCo');
const elO3   = $('actualO3');
const elTemp = $('actualTemp');
const elHumidity = $('actualHumidity');

const pm25Status = $('pm25Status');
const pm10Status = $('pm10Status');
const no2Status = $('no2Status');
const so2Status = $('so2Status');
const coStatus = $('coStatus');
const o3Status = $('o3Status');
const tempStatus = $('tempStatus');
const humidityStatus = $('humidityStatus');

const predCityEl = $('predictionLocation');
const predTimeEl = $('predictionTime');
const riskTextEl = $('riskLevelText');
const confidenceEl = $('confidenceValue');
const aqiValueEl = $('aqiValue');
const aqiCategoryEl = $('aqiCategory');
const mainPollutantEl = $('mainPollutant');

const probLowEl = $('probLow');
const probModerateEl = $('probModerate');
const probHighEl = $('probHigh');

let inputsBarChart = null;

function showAlert(message, type='success', autoHide=true) {
  if (!apiAlert) return;
  apiAlert.innerHTML = message;
  apiAlert.className = `alert alert-${type}`;
  apiAlert.style.display = 'block';
  if (autoHide) setTimeout(()=> apiAlert.style.display='none', 5000);
}

async function init() {
  if (predictBtn) predictBtn.addEventListener('click', onPredictClick);
  if (refreshBtn) refreshBtn.addEventListener('click', loadCities);

  await loadModelInfo();
  await loadCities();
  initEmptyInputsChart();
  showAlert('UI ready. Select a city and click Generate Prediction.', 'success', true);
}

async function loadModelInfo() {
  try {
    const res = await fetch(`${API_BASE_URL}/dashboard`);
    if (!res.ok) throw new Error('dashboard fetch failed');
    const data = await res.json();
    if (modelAccuracyElement) {
      if (data && data.model_accuracy !== undefined && data.model_accuracy !== null) {
        const ma = (typeof data.model_accuracy === 'number' && data.model_accuracy <= 1) ? (data.model_accuracy*100).toFixed(1) + '%' : data.model_accuracy;
        modelAccuracyElement.textContent = ma;
      } else modelAccuracyElement.textContent = '--';
    }
  } catch (err) {
    if (modelAccuracyElement) modelAccuracyElement.textContent = '--';
  }
}

async function loadCities() {
  if (!locationSelect) return;
  try {
    const res = await fetch(`${API_BASE_URL}/cities`);
    if (!res.ok) throw new Error('cities fetch failed');
    const data = await res.json();
    const cities = data.cities || data;
    locationSelect.innerHTML = '<option value="">-- Choose a location --</option>';
    if (Array.isArray(cities)) {
      cities.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        locationSelect.appendChild(opt);
      });
    } else if (typeof cities === 'object') {
      Object.keys(cities).forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        locationSelect.appendChild(opt);
      });
    }
    showAlert('Cities loaded', 'success', true);
  } catch (err) {
    showAlert('Error loading cities. Is backend running?', 'error', false);
    locationSelect.innerHTML = '<option value="">Could not load cities</option>';
  }
}

async function onPredictClick() {
  if (!locationSelect) return;
  const city = locationSelect.value;
  if (!city) {
    showAlert('Please select a city first', 'error'); return;
  }

  if (dataLoading) dataLoading.style.display = 'block';
  if (airQualityData) airQualityData.style.display = 'none';
  if (resultsContainer) resultsContainer.style.display = 'none';
  if (noResultsMessage) noResultsMessage.style.display = 'none';

  try {
    const resp = await fetch(`${API_BASE_URL}/predict`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ city })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(()=>({error:'unknown'}));
      throw new Error(err.error || `Predict failed (${resp.status})`);
    }
    const json = await resp.json();
    const inputs = json.inputs_used || {};
    const prediction = json.prediction || 'Unknown';
    const probs = json.probabilities || {Low:0, Moderate:0, High:0};

    // show inputs panel (now we have inputs)
    if (inputs) {
      updateDataDisplay(inputs);
      if (airQualityData) airQualityData.style.display = 'block';
    }

    // use server-side AQI values
    const aqiVal = json.aqi;
    const aqiCat = json.aqi_category;
    const mainPol = json.main_pollutant;

    displayPrediction(json, inputs, prediction, probs, aqiVal, aqiCat, mainPol);
    showAlert(`Prediction generated for ${city}`, 'success');
  } catch (err) {
    showAlert(`Prediction failed: ${err.message || err}`, 'error', false);
    if (noResultsMessage) noResultsMessage.style.display = 'block';
  } finally {
    if (dataLoading) dataLoading.style.display = 'none';
  }
}

function updateDataDisplay(inputs) {
  const pm25 = safeNum(inputs.pm25, inputs.pm2_5, inputs['PM2.5']);
  const pm10 = safeNum(inputs.pm10, inputs['PM10']);
  const no2  = safeNum(inputs.no2, inputs.NO2);
  const so2  = safeNum(inputs.so2, inputs.SO2);
  const co   = safeNum(inputs.co, inputs.CO);
  const o3   = safeNum(inputs.o3, inputs.O3);
  const temp = safeNum(inputs.temperature, inputs.temp, inputs.t);
  const hum  = safeNum(inputs.humidity, inputs.hum);

  if (elPm25) elPm25.textContent = formatVal(pm25);
  if (elPm10) elPm10.textContent = formatVal(pm10);
  if (elNo2)  elNo2.textContent  = formatVal(no2);
  if (elSo2)  elSo2.textContent  = formatVal(so2);
  if (elCo)   elCo.textContent   = formatVal(co);
  if (elO3)   elO3.textContent   = formatVal(o3);
  if (elTemp) elTemp.textContent = formatVal(temp);
  if (elHumidity) elHumidity.textContent = formatVal(hum);

  if (pm25Status) setStatus(pm25, pm25Status);
  if (pm10Status) setStatus(pm10, pm10Status);
  if (no2Status) setSimpleStatus(no2, no2Status);
  if (so2Status) setSimpleStatus(so2, so2Status);
  if (coStatus) setSimpleStatus(co, coStatus);
  if (o3Status) setSimpleStatus(o3, o3Status);
  if (tempStatus) { tempStatus.textContent = `${formatVal(temp)} °C`; tempStatus.className='data-status'; }
  if (humidityStatus) { humidityStatus.textContent = `${formatVal(hum)} %`; humidityStatus.className='data-status'; }

  updateInputsChart({ pm25, pm10, no2, so2, co, o3, temp, hum });
}

function safeNum(...args) {
  for (const a of args) {
    if (a === undefined || a === null) continue;
    const n = Number(a);
    if (!Number.isNaN(n)) return n;
  }
  return 0;
}
function formatVal(v) { return (v===null||v===undefined) ? '--' : (Math.round(v*10)/10).toFixed(1); }

function setStatus(value, el) {
  if (!el) return;
  if (value <= 12) { el.textContent = 'Good'; el.className='data-status status-good'; }
  else if (value <= 35.4) { el.textContent='Moderate'; el.className='data-status status-moderate'; }
  else { el.textContent='Poor'; el.className='data-status status-poor'; }
}
function setSimpleStatus(v, el) {
  if (!el) return;
  if (v === 0) { el.textContent='—'; el.className='data-status'; return; }
  if (v <= 20) { el.textContent='Good'; el.className='data-status status-good'; }
  else if (v <= 50) { el.textContent='Moderate'; el.className='data-status status-moderate'; }
  else { el.textContent='Poor'; el.className='data-status status-poor'; }
}

function displayPrediction(json, inputs, prediction, probs, aqiVal, aqiCat, mainPol) {
  if (predCityEl) predCityEl.textContent = json.city || (locationSelect ? locationSelect.value : '--');
  if (predTimeEl) predTimeEl.textContent = new Date().toLocaleString();
  if (riskTextEl) riskTextEl.textContent = `${prediction} Risk`;

  const confidence = Math.max(probs.High || 0, probs.Moderate || 0, probs.Low || 0) * 100;
  if (confidenceEl) confidenceEl.textContent = `${confidence.toFixed(1)}%`;

  if (aqiValueEl && aqiVal !== null && aqiVal !== undefined) aqiValueEl.textContent = aqiVal.toFixed(1);
  if (aqiCategoryEl) aqiCategoryEl.textContent = aqiCat || '--';
  if (mainPollutantEl) mainPollutantEl.textContent = mainPol || '--';

  if (riskDisplay) {
    riskDisplay.className = 'risk-level-display';
    if (prediction === 'Low') { riskDisplay.classList.add('risk-low'); if (riskTitle) riskTitle.innerHTML = '<i class="fas fa-check-circle"></i> Low Risk'; }
    else if (prediction === 'Moderate') { riskDisplay.classList.add('risk-moderate'); if (riskTitle) riskTitle.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Moderate Risk'; }
    else { riskDisplay.classList.add('risk-high'); if (riskTitle) riskTitle.innerHTML = '<i class="fas fa-skull-crossbones"></i> High Risk'; }
  }

  if (probLowEl) probLowEl.textContent = `${((probs.Low||0)*100).toFixed(1)}%`;
  if (probModerateEl) probModerateEl.textContent = `${((probs.Moderate||0)*100).toFixed(1)}%`;
  if (probHighEl) probHighEl.textContent = `${((probs.High||0)*100).toFixed(1)}%`;

  updateRecommendations(prediction, aqiVal);

  if (resultsContainer) resultsContainer.style.display = 'block';
  if (noResultsMessage) noResultsMessage.style.display = 'none';
}

function updateRecommendations(riskLevel, aqi) {
  const recs = getRecommendations(riskLevel, aqi);
  fillList('generalRecs', recs.general);
  fillList('sensitiveRecs', recs.sensitive_groups);
  fillList('actionRecs', recs.actions);
}
function fillList(id, items) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = '';
  items.forEach(it => {
    const li = document.createElement('li');
    li.textContent = it;
    el.appendChild(li);
  });
}
function getRecommendations(riskLevel, aqi) {
  const rec = { general:[], sensitive_groups:[], actions:[] };
  if (riskLevel === "Low" || aqi <= 50) {
    rec.general = ["Air quality is satisfactory","Normal outdoor activities are safe"];
    rec.sensitive_groups = ["No special precautions needed"];
    rec.actions = ["Continue public transport encouragement"];
  } else if (riskLevel === "Moderate" || aqi <= 100) {
    rec.general = ["Air quality acceptable; some may be sensitive","Limit prolonged outdoor exertion if sensitive"];
    rec.sensitive_groups = ["Children/elderly: reduce prolonged outdoor exertion"];
    rec.actions = ["Reduce vehicle idling","Limit outdoor burning"];
  } else {
    rec.general = ["Air quality is unhealthy; avoid prolonged outdoor exertion"];
    rec.sensitive_groups = ["Avoid outdoor activities; use masks/air purifiers"];
    rec.actions = ["Consider emergency pollution control measures"];
  }
  return rec;
}

function initEmptyInputsChart() {
  const canvas = document.getElementById('inputsBarChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  inputsBarChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['PM2.5','PM10','NO2','SO2','CO','O3','Temp','Humidity'],
      datasets: [{ label: 'Value', data: [0,0,0,0,0,0,0,0], backgroundColor: '#7ab8ff' }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { y: { beginAtZero: true } }
    }
  });
}
function updateInputsChart(values) {
  if (!inputsBarChart) return;
  const data = [
    values.pm25 || 0,
    values.pm10 || 0,
    values.no2  || 0,
    values.so2  || 0,
    values.co   || 0,
    values.o3   || 0,
    values.temp || 0,
    values.hum  || 0
  ];
  inputsBarChart.data.datasets[0].data = data;
  inputsBarChart.update();
  if (chartNote) chartNote.innerHTML = `<i class="fas fa-info-circle"></i> Showing pollutant & environment values used for prediction.`;
}

document.addEventListener('DOMContentLoaded', init);
