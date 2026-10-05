import React, { useEffect, useState, useCallback } from 'react';
import { ThemeProvider } from './context/ThemeContext';
import { Sidebar, NavigationPage } from './components/layout/Sidebar';
import { TopHeader } from './components/layout/TopHeader';
import { DashboardPage } from './components/pages/DashboardPage';
import { EntitiesPage } from './components/pages/EntitiesPage';
import { EntityInvestigationPage } from './components/pages/EntityInvestigationPage';
import { FindingsPage } from './components/pages/FindingsPage';
import { EvidencePage } from './components/pages/EvidencePage';
import { AnalyticsPage } from './components/pages/AnalyticsPage';
import { SystemStatusPage } from './components/pages/SystemStatusPage';
import { AboutMethodologyPage } from './components/pages/AboutMethodologyPage';
import { WorkflowPage } from './components/pages/WorkflowPage';
import { AlertReviewPage } from './components/pages/AlertReviewPage';
import { ReportPage } from './components/pages/ReportPage';
import { TrendsPage } from './components/pages/TrendsPage';
import { ValidationPage } from './components/pages/ValidationPage';
import { fetchDashboardMetrics, fetchHealth, fetchAssessments, activateAssessment, deleteAssessment } from './lib/api';
import type { DashboardMetrics, AssessmentInfo } from './types/api';

const VALID_PAGES: NavigationPage[] = [
  'dashboard',
  'workflow',
  'entities',
  'findings',
  'alert-review',
  'evidence',
  'analytics',
  'system',
  'about',
  'report',
  'trends',
  'validation'
];

function parseHash(): { page: NavigationPage; entityId: string | null; evidenceId: string | null } {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = hash.split('?');
  const [pageCandidate, subId] = pathPart ? pathPart.split('/') : ['dashboard', null];
  const page = VALID_PAGES.includes(pageCandidate as NavigationPage) 
    ? (pageCandidate as NavigationPage) 
    : 'dashboard';

  const params = new URLSearchParams(queryPart || '');
  const entityId = params.get('id') || (pageCandidate === 'entities' && subId ? decodeURIComponent(subId) : null);
  const evidenceId = params.get('evidence');

  return { page, entityId, evidenceId };
}

function AppContent() {
  const initial = parseHash();
  const [currentPage, setCurrentPage] = useState<NavigationPage>(initial.page);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(initial.entityId);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(initial.evidenceId);

  // Global telemetry status
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loadingMetrics, setLoadingMetrics] = useState(true);
  const [metricsError, setMetricsError] = useState<string | null>(null);

  // Assessment isolation state
  const [assessments, setAssessments] = useState<AssessmentInfo[]>([]);
  const [activeAssessment, setActiveAssessment] = useState<AssessmentInfo | null>(null);

  // Sync state to URL hash so page refreshes and browser Back/Forward buttons work
  useEffect(() => {
    let newHash = `#/${currentPage}`;
    const params = new URLSearchParams();
    if (selectedEntityId) params.set('id', selectedEntityId);
    if (selectedEvidenceId && currentPage === 'evidence') params.set('evidence', selectedEvidenceId);
    const qs = params.toString();
    if (qs) newHash += `?${qs}`;

    if (window.location.hash !== newHash) {
      window.history.pushState(null, '', newHash);
    }
  }, [currentPage, selectedEntityId, selectedEvidenceId]);

  // Handle browser Back / Forward buttons & URL changes
  useEffect(() => {
    const handlePopState = () => {
      const parsed = parseHash();
      setCurrentPage(parsed.page);
      setSelectedEntityId(parsed.entityId);
      setSelectedEvidenceId(parsed.evidenceId);
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('hashchange', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('hashchange', handlePopState);
    };
  }, []);

  const refreshAssessments = useCallback(async () => {
    try {
      const data = await fetchAssessments();
      setAssessments(data.assessments || []);
      const active = data.assessments?.find(a => a.is_active) || data.assessments?.[0] || null;
      setActiveAssessment(active);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    async function loadInitialStatus() {
      try {
        const [dashRes, asmRes] = await Promise.all([
          fetchDashboardMetrics(),
          fetchAssessments().catch(() => ({ success: false, assessments: [], active_assessment_id: 'ASM-DEFAULT' })),
          fetchHealth().catch(() => ({ status: 'Online', cached_analytics: true })),
        ]);
        setMetrics(dashRes);
        setAssessments(asmRes.assessments || []);
        const active = asmRes.assessments?.find(a => a.is_active) || asmRes.assessments?.[0] || null;
        setActiveAssessment(active);
        setMetricsError(null);
      } catch (err: any) {
        setMetricsError(err.message || 'Failed to connect to backend gateway');
      } finally {
        setLoadingMetrics(false);
      }
    }
    loadInitialStatus();
  }, []);

  // Refresh dashboard metrics — called after analysis or assessment switch completes
  const refreshMetrics = useCallback(async () => {
    try {
      const dashRes = await fetchDashboardMetrics();
      setMetrics(dashRes);
      setMetricsError(null);
    } catch (err: any) {
      // Non-fatal; dashboard will show stale data
    }
  }, []);

  // Switch between assessment periods
  const handleSwitchAssessment = useCallback(async (id: string) => {
    try {
      await activateAssessment(id);
      await Promise.all([
        refreshAssessments(),
        refreshMetrics()
      ]);
      setSelectedEntityId(null);
      setSelectedEvidenceId(null);
    } catch (err: any) {
      alert(`Failed to switch assessment: ${err.message}`);
    }
  }, [refreshAssessments, refreshMetrics]);

  // Delete an inactive assessment
  const handleDeleteAssessment = useCallback(async (id: string) => {
    if (!window.confirm(`Are you sure you want to permanently delete assessment ${id}? This will remove its database and analysis results.`)) {
      return;
    }
    try {
      await deleteAssessment(id);
      await Promise.all([
        refreshAssessments(),
        refreshMetrics()
      ]);
    } catch (err: any) {
      alert(`Failed to delete assessment: ${err.message}`);
    }
  }, [refreshAssessments, refreshMetrics]);

  // Navigation helpers
  const handleNavigate = (page: NavigationPage) => {
    setCurrentPage(page);
    setSelectedEntityId(null);
  };

  const handleOpenEntityInvestigation = (entityId: string) => {
    setSelectedEntityId(entityId);
  };

  const handleBackFromEntity = () => {
    setSelectedEntityId(null);
  };

  const handleInspectEvidence = (evidenceId: string) => {
    setSelectedEvidenceId(evidenceId);
    setCurrentPage('evidence');
  };

  const handleBack = () => {
    if (selectedEntityId) {
      setSelectedEntityId(null);
    } else if (window.history.length > 1) {
      window.history.back();
    } else {
      handleNavigate('dashboard');
    }
  };

  // Section titles for top header
  const getSectionTitle = () => {
    if (selectedEntityId) return { section: 'Investigate', title: 'Entity Investigation', sub: selectedEntityId };
    switch (currentPage) {
      case 'dashboard': return { section: 'Overview', title: 'Supervisory Dashboard' };
      case 'workflow': return { section: 'Workflow', title: 'Analysis Workflow' };
      case 'entities': return { section: 'Investigate', title: 'Entities Leaderboard' };
      case 'findings': return { section: 'Investigate', title: 'Supervisory Signals' };
      case 'alert-review': return { section: 'Investigate', title: 'Alert Review Queue' };
      case 'evidence': return { section: 'Data', title: 'Evidence Explorer' };
      case 'analytics': return { section: 'Analytics', title: 'Risk Methodology' };
      case 'trends': return { section: 'Analytics', title: 'Temporal Trends' };
      case 'validation': return { section: 'Analytics', title: 'Manual Validation' };
      case 'report': return { section: 'Export', title: 'Supervisory Report' };
      case 'system': return { section: 'System', title: 'System Status' };
      case 'about': return { section: 'System', title: 'About & Scope' };
      default: return { section: 'SAT-SA', title: 'Supervisory Assessment' };
    }
  };

  const headerInfo = getSectionTitle();

  const totalFindings = metrics ? (
    metrics.finding_counts_by_type.EXECUTION_GAP +
    metrics.finding_counts_by_type.NEGATIVE_SPACE +
    metrics.finding_counts_by_type.ANOMALY +
    metrics.finding_counts_by_type.PEER_DEVIATION +
    metrics.finding_counts_by_type.REPEATED_INCIDENT
  ) : undefined;

  return (
    <div className="min-h-screen bg-app-bg text-app-text flex font-sans antialiased transition-colors">
      {/* ────────────────────────────────────────────────────────── */}
      {/* 1. PERSISTENT LEFT SIDEBAR */}
      {/* ────────────────────────────────────────────────────────── */}
      <Sidebar
        currentPage={currentPage}
        onNavigate={handleNavigate}
        entityCount={metrics ? metrics.total_entities : undefined}
        findingCount={totalFindings}
      />

      {/* ────────────────────────────────────────────────────────── */}
      {/* 2. MAIN APPLICATION CONTENT AREA */}
      {/* ────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto h-screen bg-app-bg transition-colors print:overflow-visible print:h-auto print:bg-white">
        {/* Top Header */}
        <TopHeader
          currentSection={headerInfo.section}
          currentPageTitle={headerInfo.title}
          subTitle={headerInfo.sub}
          onNavigateToSystem={() => handleNavigate('system')}
          canGoBack={currentPage !== 'dashboard' || !!selectedEntityId}
          onBack={handleBack}
          onNavigateToDashboard={() => handleNavigate('dashboard')}
          activeAssessment={activeAssessment}
          assessments={assessments}
          onSwitchAssessment={handleSwitchAssessment}
          onDeleteAssessment={handleDeleteAssessment}
          onNavigateToWorkflow={() => handleNavigate('workflow')}
        />

        {/* Page Content Body */}
        <main className="flex-1 p-5 md:p-6 bg-app-bg transition-colors print:p-0 print:m-0 print:bg-white">
          {selectedEntityId ? (
            <EntityInvestigationPage
              entityId={selectedEntityId}
              onBack={handleBackFromEntity}
              onInspectEvidence={handleInspectEvidence}
            />
          ) : (
            <>
              {currentPage === 'dashboard' && (
                <DashboardPage
                  metrics={metrics}
                  loading={loadingMetrics}
                  error={metricsError}
                  onNavigateToEntity={handleOpenEntityInvestigation}
                  onNavigateToEntities={() => handleNavigate('entities')}
                  onNavigateToFindings={() => handleNavigate('findings')}
                  onInspectEvidence={handleInspectEvidence}
                />
              )}

              {currentPage === 'workflow' && (
                <WorkflowPage
                  activeAssessment={activeAssessment}
                  onAssessmentChanged={async () => {
                    await Promise.all([
                      refreshAssessments(),
                      refreshMetrics()
                    ]);
                  }}
                  onNavigateToDashboard={async () => {
                    await Promise.all([
                      refreshAssessments(),
                      refreshMetrics()
                    ]);
                    handleNavigate('dashboard');
                  }}
                  onNavigateToEntities={() => handleNavigate('entities')}
                  onNavigateToFindings={() => handleNavigate('findings')}
                  onSelectEntity={(entityId) => {
                    handleNavigate('entities');
                    handleOpenEntityInvestigation(entityId);
                  }}
                />
              )}

              {currentPage === 'entities' && (
                <EntitiesPage
                  onSelectEntity={handleOpenEntityInvestigation}
                />
              )}

              {currentPage === 'findings' && (
                <FindingsPage
                  onNavigateToEntity={handleOpenEntityInvestigation}
                  onInspectEvidence={handleInspectEvidence}
                />
              )}

              {currentPage === 'alert-review' && (
                <AlertReviewPage
                  onInspectEvidence={handleInspectEvidence}
                />
              )}

              {currentPage === 'evidence' && (
                <EvidencePage
                  initialEvidenceId={selectedEvidenceId}
                  onNavigateToEntity={handleOpenEntityInvestigation}
                />
              )}

              {currentPage === 'analytics' && (<AnalyticsPage />)}

              {currentPage === 'system' && (<SystemStatusPage />)}

              {currentPage === 'about' && (<AboutMethodologyPage />)}

              {currentPage === 'report' && (<ReportPage onInspectEvidence={handleInspectEvidence} />)}

              {currentPage === 'trends' && (<TrendsPage />)}

              {currentPage === 'validation' && (<ValidationPage activeAssessment={activeAssessment} />)}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}
