import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseService } from './db.js';
import { AnalyticsService } from './analytics.service.js';
import { AssessmentService } from './assessment.service.js';
import { createApiRouter } from './routes.js';

const app = express();
const PORT = process.env.PORT || 4000;

// Enable CORS for offline local environment
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Assessment-Id']
}));

// Body parser with 50MB payload limit
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Database, Analytics, and Assessment services initialization
const dbPath = process.env.DB_PATH || path.resolve(process.cwd(), 'sat_sa.db');
const dbService = new DatabaseService(dbPath);
const analyticsService = AnalyticsService.getInstance();
const assessmentService = new AssessmentService(dbPath);

// Health check endpoint
app.get('/api/health', (req: Request, res: Response) => {
  const activeAssessment = assessmentService.getActiveAssessment();
  const targetDb = assessmentService.getDbForAssessment(activeAssessment.assessment_id);
  const counts = targetDb.getCounts();
  const targetAnalytics = assessmentService.getAnalyticsForAssessment(activeAssessment.assessment_id);
  res.json({
    status: 'ok',
    service: 'sat-sa-backend',
    database: 'sqlite-connected',
    active_assessment_id: activeAssessment.assessment_id,
    active_assessment_name: activeAssessment.name,
    dataset_version: activeAssessment.dataset_version,
    db_counts: counts,
    cached_analytics: !!targetAnalytics.getCachedResult(),
    timestamp: new Date().toISOString()
  });
});

// Mount the core SAT-SA API Router
app.use('/api', createApiRouter(dbService, analyticsService, assessmentService));


// Serve frontend static files
const frontendDistPath = path.resolve(process.cwd(), '../frontend/dist');
if (fs.existsSync(frontendDistPath)) {
  app.use(express.static(frontendDistPath));
  app.get('*', (req, res, next) => {
    if (req.originalUrl.startsWith('/api')) return next();
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
}

// Fallback 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.originalUrl
  });
});

// Centralized error handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('[SAT-SA Backend Error]', err);
  res.status(500).json({
    success: false,
    message: err.message || 'Internal server error',
    error: process.env.NODE_ENV === 'production' ? undefined : String(err)
  });
});

// Determine if running as test runner or directly
const isTestMode = process.env.NODE_ENV === 'test' || process.argv.some(arg => arg.includes('test'));

if (!isTestMode) {
  app.listen(PORT, async () => {
    console.log(`[SAT-SA Backend] Server listening on http://localhost:${PORT}`);
    // Pre-load analytics cache or run initial analysis in background
    try {
      if (!analyticsService.getCachedResult()) {
        console.log('[SAT-SA Backend] Initializing supervisory analytics cache...');
        await analyticsService.getOrRunAnalysis(dbPath);
        console.log('[SAT-SA Backend] Analytics cache successfully initialized.');
      }
    } catch (err) {
      console.warn('[SAT-SA Backend] Warning: Analytics initial run deferred until requested:', err);
    }
  });
}

export { app, dbService, analyticsService };
export default app;
