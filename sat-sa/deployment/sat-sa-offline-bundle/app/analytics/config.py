"""Canonical local configuration for PS-157 analytics."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


_DEFAULT_PATH = Path(__file__).resolve().parents[1] / "config" / "analytics_config.json"


def load_config(path: str | Path | None = None) -> dict[str, Any]:
    config_path = Path(path) if path else _DEFAULT_PATH
    with config_path.open(encoding="utf-8") as handle:
        return json.load(handle)


CONFIG = load_config()


def assessment_reference_timestamp() -> str:
    return str(CONFIG["assessment"]["reference_timestamp"])
