"""
SAT-SA Analytics Microservice
FastAPI service exposing local ML & statistical supervisory analytics modules.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="SAT-SA Supervisory Analytics Engine",
    description="Offline-first analytical engine for SOC supervisory assessment",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {
        "status": "online",
        "service": "SAT-SA Analytics Engine",
        "version": "1.0.0",
        "mode": "offline-deterministic"
    }

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "modules": [
            "execution_gaps",
            "negative_space",
            "anomaly_detection",
            "peer_analysis",
            "repeated_incidents",
            "risk_scoring"
        ]
    }
