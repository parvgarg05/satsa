export interface AssessmentInfo {
  assessment_id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  is_active: boolean;
  dataset_version?: string;
  status: 'READY' | 'ANALYZING' | 'ERROR';
  counts: {
    entities: number;
    assets: number;
    alerts: number;
    cases: number;
  };
  total_findings: number;
}

export interface DashboardMetrics {
  success: boolean;
  assessment_id?: string;
  assessment_name?: string;
  dataset_version?: string;
  total_entities: number;
  risk_distribution: {
    CRITICAL: number;
    HIGH: number;
    MEDIUM: number;
    LOW: number;
  };
  high_critical_entities: Array<{
    entity_id: string;
    entity_name: string;
    sector: string;
    risk_score: number;
    risk_level: string;
    finding_count: number;
    top_severity: string;
  }>;
  finding_counts_by_type: {
    EXECUTION_GAP: number;
    NEGATIVE_SPACE: number;
    ANOMALY: number;
    PEER_DEVIATION: number;
    REPEATED_INCIDENT: number;
  };
  severity_distribution: {
    CRITICAL: number;
    HIGH: number;
    MEDIUM: number;
    LOW: number;
  };
  useful_aggregate_metrics: {
    total_assets: number;
    total_alerts: number;
    total_cases: number;
    average_risk_score: number;
    escalated_cases_ratio: number;
    avg_investigation_duration_minutes: number;
    quick_closure_critical_count: number;
    stale_critical_assets_count: number;
    repeated_incident_clusters: number;
    telemetry_coverage_pct?: number;
    peer_deviations_count?: number;
  };
  latest_analysis_timestamp: string;
}

export interface EntitySummary {
  entity_id: string;
  entity_name: string;
  sector: string;
  risk_score: number;
  final_risk_score?: number;
  risk_level: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  finding_count: number;
  top_severity: string;
  primary_drivers?: string[];
  component_scores?: Record<string, any>;
  component_weighted_contributions?: Record<string, number>;
  component_raw_scores?: Record<string, number>;
  explanation?: any;
}

export interface EntitiesResponse {
  success: boolean;
  count: number;
  entities: EntitySummary[];
}

export interface Finding {
  finding_id: string;
  entity_id: string;
  finding_type: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  rationale: string;
  evidence_ids: string[];
  supporting_metrics: Record<string, any>;
}

export interface FindingsResponse {
  success: boolean;
  count: number;
  findings: Finding[];
}

export interface EntityDetailResponse {
  success: boolean;
  entity_id: string;
  entity_name: string;
  sector: string;
  risk_score: number;
  risk_level: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  component_scores: Record<string, {
    finding_type: string;
    weight_pct: string;
    raw_module_score: number;
    weighted_contribution: number;
    finding_count: number;
    top_severity: string;
  }>;
  findings: Finding[];
  explanation: {
    entity_id: string;
    entity_name: string;
    risk_score: number;
    risk_level: string;
    score_formula: string;
    module_breakdown: Array<any>;
    summary: string;
  };
  evidence_references: {
    total_assets: number;
    total_alerts: number;
    total_cases?: number;
    critical_assets: Array<any>;
    recent_alerts: Array<any>;
  };
}

export interface EvidenceResponse {
  success: boolean;
  id: string;
  evidence_type: 'alert' | 'case' | 'asset' | 'finding_drilldown';
  alert?: Record<string, any>;
  case?: Record<string, any>;
  asset?: Record<string, any>;
  entity?: Record<string, any>;
  related_alert?: Record<string, any>;
  related_case?: Record<string, any>;
  related_asset?: Record<string, any>;
  recent_alerts?: Array<Record<string, any>>;
  finding?: Record<string, any>;
  evidence_records?: {
    alerts: Array<Record<string, any>>;
    cases: Array<Record<string, any>>;
    assets: Array<Record<string, any>>;
  };
  broken_reference?: boolean;
  message?: string;
  error?: string;
}

export interface EvidenceIntegrityResponse {
  success: boolean;
  total_findings: number;
  total_references: number;
  valid_references: number;
  broken_references: number;
  integrity_passed: boolean;
  broken_details: Array<{
    finding_id: string;
    evidence_id: string;
    reason: string;
  }>;
}

export interface ExternalDatasetSummary {
  dataset_id: string;
  source: string;
  source_file: string;
  source_sha256: string;
  source_size_bytes: number;
  schema: string;
  schema_version: string;
  record_count: number;
  duplicate_count: number;
  ingestion_timestamp: string;
  provenance: Record<string, unknown>;
}

export interface ExternalDatasetDetails extends ExternalDatasetSummary {
  events: Array<{
    dataset_id: string;
    event_id: string;
    source_row_number: number;
    raw_record: string;
    raw_record_sha256: string;
    column_1: string;
    column_2: string;
    column_3: string;
    column_4: string;
    duplicate_of_event_id: string | null;
  }>;
  analytics: Array<{
    module: string;
    status: 'NOT_APPLICABLE' | 'AVAILABLE_AS_RAW_EVENT_ANALYSIS';
    message: string;
  }>;
}
