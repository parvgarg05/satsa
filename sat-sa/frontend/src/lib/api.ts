import { 
  DashboardMetrics, EntitiesResponse, FindingsResponse, 
  EntityDetailResponse, EvidenceResponse, EvidenceIntegrityResponse 
  , ExternalDatasetSummary, ExternalDatasetDetails
} from '../types/api';

const API_BASE = '/api';

export interface EntityFilterOptions {
  sector?: string;
  risk_level?: string;
  sort?: string;
  order?: string;
}

export interface FindingFilterOptions {
  entity_id?: string;
  finding_type?: string;
  severity?: string;
}

export async function fetchHealth(): Promise<{ status: string; cached_analytics: boolean }> {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error('Failed to fetch system health');
  return res.json();
}

export async function fetchDashboardMetrics(): Promise<DashboardMetrics> {
  const res = await fetch(`${API_BASE}/dashboard`);
  if (!res.ok) throw new Error('Failed to fetch dashboard metrics');
  return res.json();
}

export async function fetchEntities(filters: EntityFilterOptions = {}): Promise<EntitiesResponse> {
  const params = new URLSearchParams();
  params.set('sort', filters.sort || 'risk_score');
  params.set('order', filters.order || 'desc');
  if (filters.sector && filters.sector !== 'ALL') params.set('sector', filters.sector);
  if (filters.risk_level && filters.risk_level !== 'ALL') params.set('risk_level', filters.risk_level);

  const res = await fetch(`${API_BASE}/entities?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch entities');
  return res.json();
}

export async function fetchFindings(filters: FindingFilterOptions = {}, assessmentId?: string): Promise<FindingsResponse> {
  const params = new URLSearchParams();
  if (filters.entity_id) params.set('entity_id', filters.entity_id);
  if (filters.finding_type && filters.finding_type !== 'ALL') params.set('finding_type', filters.finding_type);
  if (filters.severity && filters.severity !== 'ALL') params.set('severity', filters.severity);
  if (assessmentId) params.set('assessment_id', assessmentId);

  const res = await fetch(`${API_BASE}/findings?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch findings');
  return res.json();
}

export async function fetchCriticalFindings(): Promise<FindingsResponse> {
  return fetchFindings({ severity: 'CRITICAL' });
}

export async function fetchEntityDetail(id: string): Promise<EntityDetailResponse> {
  const res = await fetch(`${API_BASE}/entities/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Failed to fetch entity ${id}`);
  return res.json();
}

export async function fetchAlertPriorities(filters: {
  entity_id?: string;
  severity?: string;
  priority_level?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<any> {
  const params = new URLSearchParams();
  if (filters.entity_id) params.set('entity_id', filters.entity_id);
  if (filters.severity && filters.severity !== 'ALL') params.set('severity', filters.severity);
  if (filters.priority_level && filters.priority_level !== 'ALL') params.set('priority_level', filters.priority_level);
  if (filters.limit) params.set('limit', filters.limit.toString());
  if (filters.offset) params.set('offset', filters.offset.toString());
  
  const url = `${API_BASE}/alert-priorities${params.toString() ? `?${params.toString()}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch alert priorities');
  return res.json();
}

export async function fetchReport(entityId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/report/${encodeURIComponent(entityId)}`);
  if (!res.ok) throw new Error(`Failed to fetch report for ${entityId}`);
  return res.json();
}

export async function fetchTrends(entityId?: string, days?: number): Promise<any> {
  const params = new URLSearchParams();
  if (entityId && entityId !== 'ALL') params.set('entity_id', entityId);
  if (days) params.set('days', days.toString());
  const res = await fetch(`${API_BASE}/trends?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch temporal trends');
  return res.json();
}

export async function uploadExpertLabels(file: File, assessmentId?: string): Promise<any> {
  const formData = new FormData();
  formData.append('file', file);
  const url = assessmentId ? `${API_BASE}/upload-labels?assessment_id=${encodeURIComponent(assessmentId)}` : `${API_BASE}/upload-labels`;
  const headers: Record<string, string> = {};
  if (assessmentId) headers['x-assessment-id'] = assessmentId;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: formData,
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || data.message || 'Failed to upload expert finding labels');
  return data;
}

export async function fetchValidationMetrics(assessmentId?: string): Promise<any> {
  const url = assessmentId ? `${API_BASE}/validation-metrics?assessment_id=${encodeURIComponent(assessmentId)}` : `${API_BASE}/validation-metrics`;
  const headers: Record<string, string> = {};
  if (assessmentId) headers['x-assessment-id'] = assessmentId;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error('Failed to fetch validation metrics');
  return res.json();
}

export async function runValidation(assessmentId?: string): Promise<any> {
  const url = assessmentId ? `${API_BASE}/validation-runs?assessment_id=${encodeURIComponent(assessmentId)}` : `${API_BASE}/validation-runs`;
  const headers: Record<string, string> = {};
  if (assessmentId) headers['x-assessment-id'] = assessmentId;
  const res = await fetch(url, { method: 'POST', headers });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || 'Failed to create validation run');
  return data.validation_run;
}

export async function fetchExpertFindingLabels(assessmentId?: string): Promise<any> {
  const url = assessmentId ? `${API_BASE}/expert-finding-labels?assessment_id=${encodeURIComponent(assessmentId)}` : `${API_BASE}/expert-finding-labels`;
  const headers: Record<string, string> = {};
  if (assessmentId) headers['x-assessment-id'] = assessmentId;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error('Failed to fetch expert finding labels');
  return res.json();
}

export async function submitExpertFindingLabel(label: {
  finding_id: string;
  entity_id: string;
  expert_label: 'CONFIRMED' | 'NOT_CONFIRMED';
  reviewer_id: string;
  review_timestamp: string;
  rationale?: string;
}, assessmentId?: string): Promise<any> {
  const url = assessmentId ? `${API_BASE}/expert-finding-labels?assessment_id=${encodeURIComponent(assessmentId)}` : `${API_BASE}/expert-finding-labels`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (assessmentId) headers['x-assessment-id'] = assessmentId;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(label)
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.validation_errors?.[0]?.message || data.error || 'Failed to save expert finding label');
  return data;
}

export async function resetExpertFindingLabels(assessmentId?: string): Promise<any> {
  const url = assessmentId ? `${API_BASE}/expert-finding-labels/reset?assessment_id=${encodeURIComponent(assessmentId)}` : `${API_BASE}/expert-finding-labels/reset`;
  const headers: Record<string, string> = {};
  if (assessmentId) headers['x-assessment-id'] = assessmentId;
  const res = await fetch(url, {
    method: 'POST',
    headers
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || 'Failed to reset expert finding labels');
  return data;
}

export async function fetchEvidence(id: string): Promise<EvidenceResponse> {
  const res = await fetch(`${API_BASE}/evidence/${encodeURIComponent(id)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 404) {
      throw new Error(err.message || `Evidence reference broken: Record '${id}' does not exist in SQLite database.`);
    }
    throw new Error(err.message || `Failed to fetch evidence ${id}`);
  }
  return res.json();
}

export async function fetchEvidenceIntegrity(): Promise<EvidenceIntegrityResponse> {
  const res = await fetch(`${API_BASE}/evidence/integrity`);
  if (!res.ok) throw new Error('Failed to verify evidence integrity in database');
  return res.json();
}

export async function triggerAnalysis(): Promise<{ success: boolean; message: string; duration_ms: number }> {
  const res = await fetch(`${API_BASE}/analyze`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to run analytics pipeline');
  return res.json();
}

export async function uploadDataset(file: File, options?: { newAssessment?: boolean; assessmentName?: string }): Promise<any> {
  const formData = new FormData();
  formData.append('files', file);
  if (options?.newAssessment) {
    formData.append('new_assessment', 'true');
  }
  if (options?.assessmentName) {
    formData.append('assessment_name', options.assessmentName);
  }
  const res = await fetch(`${API_BASE}/upload`, {
    method: 'POST',
    body: formData,
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    const errorDetails = data.validation_errors?.length
      ? `: ${data.validation_errors.map((e: any) => `${e.field || e.table || 'row'}: ${e.message}`).join(', ')}`
      : '';
    throw new Error((data.message || 'Upload failed') + errorDetails);
  }
  return data;
}

export async function fetchAssessments(): Promise<{ success: boolean; active_assessment_id: string; assessments: import('../types/api').AssessmentInfo[] }> {
  const res = await fetch(`${API_BASE}/assessments`);
  if (!res.ok) throw new Error('Failed to fetch assessments');
  return res.json();
}

export async function fetchActiveAssessment(): Promise<{ success: boolean; assessment: import('../types/api').AssessmentInfo }> {
  const res = await fetch(`${API_BASE}/assessments/active`);
  if (!res.ok) throw new Error('Failed to fetch active assessment');
  return res.json();
}

export async function createAssessment(name: string, description?: string): Promise<{ success: boolean; assessment: import('../types/api').AssessmentInfo }> {
  const res = await fetch(`${API_BASE}/assessments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description })
  });
  if (!res.ok) throw new Error('Failed to create assessment');
  return res.json();
}

export async function activateAssessment(id: string): Promise<{ success: boolean; active_assessment_id: string; assessment: import('../types/api').AssessmentInfo }> {
  const res = await fetch(`${API_BASE}/assessments/${encodeURIComponent(id)}/activate`, {
    method: 'POST'
  });
  if (!res.ok) throw new Error(`Failed to activate assessment ${id}`);
  return res.json();
}

export async function deleteAssessment(id: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/assessments/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to delete assessment');
  }
  return res.json();
}

export async function uploadExternalDataset(file: File): Promise<ExternalDatasetSummary> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/external-datasets`, { method: 'POST', body: formData });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || 'External dataset ingestion failed');
  return data.external_dataset as ExternalDatasetSummary;
}

export async function fetchExternalDatasetDetails(datasetId: string): Promise<ExternalDatasetDetails> {
  const res = await fetch(`${API_BASE}/external-datasets/${encodeURIComponent(datasetId)}`);
  if (!res.ok) throw new Error('Failed to fetch external dataset details');
  const data = await res.json();
  return data.external_dataset as ExternalDatasetDetails;
}
