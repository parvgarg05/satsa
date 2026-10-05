# SAT-SA Offline Dependency Manifest

This document outlines the dependencies required to run SAT-SA in an air-gapped environment.

## 1. System Requirements (Runtime)

| Component | Version | Purpose | Internet Required |
|-----------|---------|---------|-------------------|
| Node.js | v22+ with `node:sqlite` | Backend server and frontend static hosting | NO |
| Python | 3.10+ | Analytics execution | NO |
| OS | Windows/Linux | Host environment | NO |

## 2. Python Dependencies (Runtime)

These packages must be downloaded on an internet-connected machine as `.whl` files and transferred, or packaged into a virtual environment bundle.

| Package | Version | Purpose | Internet Required |
|---------|---------|---------|-------------------|
| pandas | >=2.2.0 | Data manipulation | NO |
| numpy | >=1.26.0 | Numerical operations | NO |
| scikit-learn | >=1.4.0 | ML Isolation Forest anomaly detection | NO |

*Note on scikit-learn*: Inference is performed entirely locally without any model downloads, telemetry, or external API requests.

## 3. Node.js Dependencies (Runtime)

The `node_modules` directory must be bundled on the build machine.

| Package | Version | Purpose | Internet Required |
|---------|---------|---------|-------------------|
| express | ^4.18.0 | Backend HTTP Server | NO |
| cors | ^2.8.5 | Cross-Origin Resource Sharing | NO |
| multer | ^1.4.5 | File Upload Parsing (CSV/JSON) | NO |
| csv-parser | ^3.2.0 | CSV Ingestion Parsing | NO |
| node:sqlite | Node.js built-in | Local Database Access | NO |

*Note on `node:sqlite`*: The target must use a Node.js version that provides the built-in module. No external database server is required.

## 4. Frontend Assets (Build-Time)

All frontend assets are bundled into static files during the build process. The production build (`dist/`) contains no external calls.

| Package | Version | Purpose | Internet Required |
|---------|---------|---------|-------------------|
| react | ^18.2.0 | UI Library | NO (Bundled) |
| react-dom | ^18.2.0 | UI Rendering | NO (Bundled) |
| tailwindcss | ^3.4.0 | CSS Framework | NO (Build-only) |
| lucide-react | ^0.344.0 | SVG Icons | NO (Bundled) |
| vite | ^5.0.0 | Bundler | NO (Build-only) |

*External asset audit*: All Google Fonts and CDN links have been removed. Lucide icons are bundled as inline SVGs by Vite.
