# SAT-SA: Supervisory Analytics Tool for SOC Assessment
### Smart India Hackathon (SIH 2026) — Problem Statement 157

> **Offline-first, air-gapped supervisory analytics tool for regulatory evaluation and prioritization of Critical Sector Entities (CSEs).**

---

## ⚡ Quickstart Commands

```bash
# 1. Setup Python Virtual Environment & Analytics
python -m venv .venv
.\.venv\Scripts\activate            # On Windows (or source .venv/bin/activate on Unix)
pip install -r sat-sa/analytics/requirements.txt

# 2. Seed Database & Start Backend Gateway (:4000)
cd sat-sa/backend
npm install
npm run seed                       # Seeds sat_sa.db from sample dataset
npm run dev

# 3. In a second terminal, Start Frontend Dashboard (:5173)
cd sat-sa/frontend
npm install
npm run dev
```

Visit: **`http://localhost:5173`**

---

## 🧪 Run All Verification Tests

```bash
# Backend & Data Layer Integration Tests (16 tests)
cd sat-sa/backend && npm test

# Python Supervisory Analytics & ML Tests (95 tests)
pytest sat-sa/analytics/tests -v
```

**Total: 111 / 111 passing tests — 0 failures.**

---

## 📚 Complete Documentation

- **Primary Project README**: [`sat-sa/README.md`](./sat-sa/README.md) (Architecture, 5 modules, scoring formulas, demo walkthrough)
- **Detailed System Architecture**: [`sat-sa/docs/ARCHITECTURE.md`](./sat-sa/docs/ARCHITECTURE.md)
- **Phase-by-Phase Completion Log**: [`sat-sa/IMPLEMENTATION_STATUS.md`](./sat-sa/IMPLEMENTATION_STATUS.md)
- **Problem Statement Specification**: [`sat-sa/PROJECT_SPEC.md`](./sat-sa/PROJECT_SPEC.md)
