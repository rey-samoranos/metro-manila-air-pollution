# main.py - FastAPI backend with full AQI computation
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import joblib, json, os
import numpy as np
from typing import Optional, Dict, Any

app = FastAPI(
    title="Metro Manila Air Quality Risk Prediction API (with full AQI)",
    version="1.1.0"
)

# Allow CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True
)

BASE_DIR = os.path.dirname(__file__)
MODEL_DIR = os.path.join(BASE_DIR, "model")

# load model bundle (must exist)
bundle_path = os.path.join(MODEL_DIR, "air_pollution_model_bundle.pkl")
bundle = joblib.load(bundle_path)

pipeline = bundle["pipeline"]
label_encoder = bundle["label_encoder"]
FEATURES = bundle["features"]

# dashboard files (optional)
dashboard_by_city = {}
dashboard_data = {}
try:
    with open(os.path.join(MODEL_DIR, "dashboard_by_city.json")) as f:
        dashboard_by_city = json.load(f)
except Exception:
    dashboard_by_city = {}

try:
    with open(os.path.join(MODEL_DIR, "dashboard_data.json")) as f:
        dashboard_data = json.load(f)
except Exception:
    dashboard_data = {}

# -----------------------
# AQI breakpoint tables
# -----------------------
# Breakpoint format: (Conc_low, Conc_high, I_low, I_high)
# Units expected:
#   pm25, pm10 -> μg/m3
#   o3, no2, so2 -> ppb
#   co -> ppm

AQI_BREAKPOINTS = {
    "pm25": [
        (0.0, 12.0, 0, 50),
        (12.1, 35.4, 51, 100),
        (35.5, 55.4, 101, 150),
        (55.5, 150.4, 151, 200),
        (150.5, 250.4, 201, 300),
        (250.5, 350.4, 301, 400),
        (350.5, 500.4, 401, 500),
    ],
    "pm10": [
        (0, 54, 0, 50),
        (55, 154, 51, 100),
        (155, 254, 101, 150),
        (255, 354, 151, 200),
        (355, 424, 201, 300),
        (425, 504, 301, 400),
        (505, 604, 401, 500),
    ],
    # O3 breakpoints (8-hour where applicable) in ppb (converted from ppm ranges commonly used)
    "o3": [
        (0, 54, 0, 50),
        (55, 70, 51, 100),
        (71, 85, 101, 150),
        (86, 105, 151, 200),
        (106, 200, 201, 300)
    ],
    # CO (8-hour) in ppm
    "co": [
        (0.0, 4.4, 0, 50),
        (4.5, 9.4, 51, 100),
        (9.5, 12.4, 101, 150),
        (12.5, 15.4, 151, 200),
        (15.5, 30.4, 201, 300),
        (30.5, 40.4, 301, 400),
        (40.5, 50.4, 401, 500),
    ],
    # NO2 (1-hour) in ppb
    "no2": [
        (0, 53, 0, 50),
        (54, 100, 51, 100),
        (101, 360, 101, 150),
        (361, 649, 151, 200),
        (650, 1249, 201, 300),
        (1250, 1649, 301, 400),
        (1650, 2049, 401, 500),
    ],
    # SO2 (1-hour) in ppb
    "so2": [
        (0, 35, 0, 50),
        (36, 75, 51, 100),
        (76, 185, 101, 150),
        (186, 304, 151, 200),
        (305, 604, 201, 300),
        (605, 804, 301, 400),
        (805, 1004, 401, 500),
    ]
}

# AQI categories
def aqi_category(aqi_val: float) -> str:
    if aqi_val <= 50:
        return "Good"
    if aqi_val <= 100:
        return "Moderate"
    if aqi_val <= 150:
        return "Unhealthy for Sensitive Groups"
    if aqi_val <= 200:
        return "Unhealthy"
    if aqi_val <= 300:
        return "Very Unhealthy"
    return "Hazardous"

# Linear interpolation formula
def linear_iaqi(Cp, Clow, Chigh, Ilow, Ihigh):
    return ((Ihigh - Ilow) / (Chigh - Clow)) * (Cp - Clow) + Ilow

def compute_sub_aqi(pollutant: str, value: float) -> Optional[float]:
    """Compute sub-index (AQI) for a pollutant based on breakpoints."""
    if value is None:
        return None
    if pollutant not in AQI_BREAKPOINTS:
        return None
    for (Clow, Chigh, Ilow, Ihigh) in AQI_BREAKPOINTS[pollutant]:
        if Clow <= value <= Chigh:
            return max(0.0, linear_iaqi(value, Clow, Chigh, Ilow, Ihigh))
    # if value is above highest breakpoint, extrapolate using last interval
    last = AQI_BREAKPOINTS[pollutant][-1]
    Clow, Chigh, Ilow, Ihigh = last
    if value > Chigh:
        # extrapolate linearly
        return max(0.0, linear_iaqi(value, Clow, Chigh, Ilow, Ihigh))
    return None

# Request model
class PredictRequest(BaseModel):
    city: Optional[str] = None
    pm25: Optional[float] = None
    pm10: Optional[float] = None
    no2: Optional[float] = None
    so2: Optional[float] = None
    co: Optional[float] = None
    o3: Optional[float] = None
    temperature: Optional[float] = None
    humidity: Optional[float] = None

@app.get("/")
def home():
    return {"status": "FastAPI Air Quality Prediction API with AQI is running"}

@app.get("/cities")
def get_cities():
    # prefer dashboard_by_city keys, else return static if empty
    if dashboard_by_city:
        return {"cities": sorted(list(dashboard_by_city.keys()))}
    # fallback sample list (Metro Manila)
    sample = ["Caloocan","Las Piñas","Makati City","Malabon","Mandaluyong City",
              "Navotas","Parañaque City","Pasig","Quezon City","San Juan","Taguig","Valenzuela","Manila"]
    return {"cities": sample}

@app.get("/dashboard")
def get_dashboard():
    # Return dashboard_data if available, else minimal info
    if dashboard_data:
        return dashboard_data
    return {"model_accuracy": bundle.get("accuracy", None)}

@app.post("/predict")
def predict(req: PredictRequest):
    # Determine inputs: prefer dashboard_by_city latest_inputs if city provided
    inputs = {}
    if req.city:
        city = req.city
        # attempt to find in dashboard_by_city (case-insensitive)
        found = None
        for c in dashboard_by_city.keys():
            if c.lower() == city.lower():
                found = c
                break
        if found:
            inputs = dashboard_by_city[found].get("latest_inputs", {})
        else:
            # if not in dashboard_by_city, allow using provided fields only
            inputs = {}
    # overwrite with any explicit fields in request
    for f in ["pm25","pm10","no2","so2","co","o3","temperature","humidity"]:
        val = getattr(req, f)
        if val is not None:
            inputs[f] = float(val)

    # ensure we have all features required by pipeline
    X = []
    for feat in FEATURES:
        v = inputs.get(feat, 0.0)
        try:
            X.append(float(v))
        except:
            X.append(0.0)
    arr = np.array([X])

    # Predict using pipeline
    pred_enc = pipeline.predict(arr)[0]
    pred_label = label_encoder.inverse_transform([pred_enc])[0]
    proba = pipeline.predict_proba(arr)[0]
    proba_dict = {label_encoder.classes_[i]: float(proba[i]) for i in range(len(proba))}

    # Compute sub-AQIs for pollutants
    # Map input keys to pollutant names used in AQI_BREAKPOINTS
    pollutant_map = {
        "pm25": "pm25",
        "pm10": "pm10",
        "no2": "no2",
        "so2": "so2",
        "co": "co",
        "o3": "o3"
    }
    sub_aqi: Dict[str, Any] = {}
    for key, pol in pollutant_map.items():
        val = inputs.get(key, None)
        if val is None:
            sub_aqi[key] = None
        else:
            # units: make sure values are in same units as breakpoints
            # (we assume backend receives pm in μg/m3, gases in ppb except CO in ppm)
            sub = compute_sub_aqi(pol, float(val))
            sub_aqi[key] = None if sub is None else round(float(sub), 1)

    # Determine overall AQI and main pollutant
    # use sub_aqi values (ignore None)
    valid_subs = {k: v for k, v in sub_aqi.items() if v is not None}
    if valid_subs:
        overall_aqi = max(valid_subs.values())
        main_pollutant = max(valid_subs, key=lambda k: valid_subs[k])
    else:
        overall_aqi = None
        main_pollutant = None

    # aqi category
    overall_cat = aqi_category(overall_aqi) if overall_aqi is not None else None

    # Build response
    response = {
        "city": req.city,
        "prediction": pred_label,
        "probabilities": proba_dict,
        "inputs_used": {k: float(v) if v is not None else None for k, v in inputs.items()},
        "sub_aqi": sub_aqi,
        "aqi": round(float(overall_aqi), 1) if overall_aqi is not None else None,
        "aqi_category": overall_cat,
        "main_pollutant": main_pollutant
    }

    return response
