import { clearToken, getToken } from '../lib/auth'

const BASE = '/api'

export interface Role {
  id: number
  name: string
  specialization: string | null
  direction: string | null
}

export interface Grade {
  id: number
  code: string
  sort_order: number
}

export interface Level {
  code: number
  name: string
  theory: string | null
  practice: string | null
  comment: string | null
}

export interface Criterion {
  id: number
  order_num: number
  description: string
}

export interface Competency {
  id: number
  code: number
  name: string
  description: string | null
  sort_order: number
  criteria: Criterion[]
}

export interface DepartmentRef {
  id: number
  name: string
}

export interface OwnerRef {
  id: number
  full_name: string
}

export interface Employee {
  id: number
  full_name: string
  email: string | null
  position: string | null
  owner_id: number
  owner: OwnerRef | null
  role: Role | null
  grade: Grade | null
  department: DepartmentRef | null
  hired_at: string | null
  left_at: string | null
}

export interface EmployeeCreate {
  full_name: string
  email?: string | null
  position?: string | null
  hired_at?: string | null
}

export interface EmployeeUpdate {
  full_name?: string
  email?: string | null
  position?: string | null
  role_id?: number | null
  grade_id?: number | null
  department_id?: number | null
  hired_at?: string | null
  left_at?: string | null
}

// ---------- Dev metrics / extracted competencies / digital profile ----------

export interface QualityBreakdownComponents {
  conventional_commits_pct: number
  description_pct: number
  size_pct: number
  weights: Record<string, number>
}

export interface WipMrItem {
  mr_iid: number
  project_id: number | null
  project_name: string | null
  title: string
  url: string | null
  created_at: string | null
  updated_at: string | null
  age_days: number
  is_stale: boolean
  state: string
}

export interface PullRequestStatusAccess {
  available: boolean
  reason: string | null
  auto_sync_enabled: boolean
}

export interface PullRequestStatusSync {
  state: string
  merged_at: string | null
  checked_at: string
}

export interface DevMetricsSnapshotPublic {
  id: number
  period_start: string
  period_end: string
  total_commits: number
  total_mrs: number
  lines_added: number
  lines_removed: number
  mr_size_xs: number
  mr_size_s: number
  mr_size_m: number
  mr_size_l: number
  mr_size_xl: number
  mr_with_tests: number
  mr_with_description: number
  mr_with_review_discussion: number
  avg_iterations: number
  avg_time_to_merge_hours: number | null
  avg_quality_ratio: number
  comments_given: number
  comments_received: number
  ai_comments_received: number
  wip_count: number
  stale_count: number
  wip_mrs: WipMrItem[]
  stale_threshold_days: number | null
  quality_breakdown: QualityBreakdownComponents | null
}

export interface PullRequestSignals {
  small_size?: boolean
  has_description?: boolean
  minimal_rework?: boolean
  has_review_discussion?: boolean
  has_tests?: boolean
}

export interface PullRequestPublic {
  id: number
  external_id: string
  project_id: number | null
  project_name: string | null
  title: string
  url: string | null
  state: string
  created_at_ext: string
  merged_at_ext: string | null
  additions: number
  deletions: number
  files_changed: number
  tests_changed: number
  size_bucket: string
  iterations: number
  comments_count: number
  time_to_merge_hours: number | null
  signals: PullRequestSignals
  quality_ratio: number
  feature_keys: string[]
  commits_count: number | null
  conventional_commits_rate: number | null
  comments_from_peers: number | null
  comments_from_ai: number | null
  author_employee_id: number | null
  author_full_name: string | null
}

export interface ExtractedCompetencyPRExample {
  pr_id: number
  pr_external_id: string
  title: string
  url: string | null
  project_id: number | null
  evidence: string
}

export interface CompetencyTopSignal {
  signal: string
  signal_type: string
  occurrences: number
  weight: number
  contribution: number
}

export interface CompetencyTopicCoverage {
  topic_id: number
  section: string | null
  topic: string
  recommended_level: number | null
  score: number
  signal_count: number
}

export interface ExtractedCompetencyItem {
  competency_id: number
  competency_name: string
  sort_order: number
  frequency: number
  last_seen_at: string | null
  pr_examples: ExtractedCompetencyPRExample[]
  required_level: number | null
  current_level: number | null
  frequency_score: number | null
  max_level: number | null
  top_signals: CompetencyTopSignal[]
  topic_coverage: CompetencyTopicCoverage[]
  mptk_answer: string | null
}

export interface ExtractedCompetenciesResponse {
  items: ExtractedCompetencyItem[]
  period_start: string | null
  period_end: string | null
}

export interface ProjectCompetencyEmployeeContrib {
  employee_id: number
  full_name: string
  frequency: number
  pr_examples: ExtractedCompetencyPRExample[]
}

export interface ProjectExtractedCompetencyItem {
  competency_id: number
  competency_name: string
  sort_order: number
  project_target_level: number | null
  employees_with: number
  total_frequency: number
  employees: ProjectCompetencyEmployeeContrib[]
  top_signals: CompetencyTopSignal[]
}

export interface CodeBuddyDeveloperListItem {
  username: string
  full_name: string | null
  mr_count: number
  last_active_at: string | null
}

// ---------- Performance-аналитика продукта ----------

export interface DevScoreBreakdown {
  quality: number
  tests: number
  review: number
  low_rework: number
  volume: number
}

export interface DeveloperPerformance {
  employee_id: number
  full_name: string
  role_name: string | null
  grade_code: string | null
  mr_count: number
  prs_open: number
  prs_merged: number
  prs_closed: number
  avg_quality: number
  tests_pct: number
  description_pct: number
  avg_iterations: number
  rework_pct: number
  comments_received: number
  ai_comments_received: number
  comments_written: number
  lines_added: number
  lines_removed: number
  avg_ttm_hours: number | null
  composite_score: number
  breakdown: DevScoreBreakdown
  score_delta: number | null
  mr_count_delta: number | null
  quality_delta: number | null
}

export interface ProductHealth {
  total_prs: number
  prs_open: number
  prs_merged: number
  prs_closed: number
  avg_quality: number | null
  with_tests_pct: number | null
  avg_ttm_hours: number | null
  wip_count: number
  stale_count: number
  coverage_gap: number
  bus_factor_count: number
  workload_top_share: number | null
  active_developers: number
  team_size: number
  reviewers_count: number
  health_status: 'healthy' | 'attention' | 'critical'
  health_score: number
  total_prs_delta: number | null
  avg_quality_delta: number | null
}

export interface SignalEvidenceItem {
  label: string
  detail: string | null
  url: string | null
}

export interface PerfSignal {
  severity: 'critical' | 'warning' | 'info'
  kind: string
  title: string
  detail: string
  employee_id: number | null
  employee_name: string | null
  evidence: SignalEvidenceItem[]
}

export interface ProductPerformanceResponse {
  enabled: boolean
  period_from: string
  period_to: string
  health: ProductHealth
  developers: DeveloperPerformance[]
  signals: PerfSignal[]
}

export interface ReviewPerformer {
  name: string
  reason: string
}

export interface ReviewRisk {
  name: string | null
  severity: 'critical' | 'warning' | 'info'
  text: string
}

export interface ReviewAction {
  title: string
  detail: string
}

export interface ProductReviewResult {
  summary: string
  health_verdict: string
  top_performers: ReviewPerformer[]
  risks: ReviewRisk[]
  actions: ReviewAction[]
}

export interface PerformanceReview {
  id: number
  product_id: number
  status: 'queued' | 'running' | 'done' | 'error'
  period_from: string | null
  period_to: string | null
  content_json: ProductReviewResult | null
  model: string | null
  error: string | null
  created_at: string
  finished_at: string | null
}

export interface TrendBucket {
  period_from: string
  period_to: string
  total_prs: number
  prs_merged: number
  avg_quality: number | null
  with_tests_pct: number | null
  stale_open_count: number
}

export interface ProductTrends {
  enabled: boolean
  bucket_days: number
  buckets: TrendBucket[]
}

export interface ProjectExtractedCompetenciesResponse {
  items: ProjectExtractedCompetencyItem[]
  total_team: number
  period_start: string | null
  period_end: string | null
}

export interface DigitalProfileItem {
  title: string
  detail: string
  source: string | null
}

export interface DigitalProfileGapRow {
  competency: string
  mpk_level: string
  fact_summary: string
  comment: string
}

export interface DigitalProfileProject {
  name: string
  role: string | null
  summary: string
}

export interface DigitalProfileAction {
  title: string
  detail: string
  priority: 'high' | 'medium' | 'low'
}

export interface DigitalProfileContent {
  headline: string
  summary: string
  strengths: DigitalProfileItem[]
  weaknesses: DigitalProfileItem[]
  gaps: DigitalProfileGapRow[]
  projects: DigitalProfileProject[]
  actions: DigitalProfileAction[]
}

export interface DigitalProfilePublic {
  id: number
  generated_at: string
  content_md: string
  content_json: DigitalProfileContent | null
  input_summary: Record<string, unknown>
  model: string
}

export interface EmployeeProjectHistoryItem {
  product_id: number
  product_name: string
  product_status: string
  gitlab_group: string | null
  role_in_project: string | null
  joined_at: string | null
  left_at: string | null
  rotation_locked: boolean
  rotation_lock_note: string | null
  is_current: boolean
}

export interface EmployeeImportRow {
  row: number
  action: 'create' | 'skip' | 'error'
  full_name: string | null
  email: string | null
  position: string | null
  department_id: number | null
  hired_at: string | null
  warnings: string[]
  error: string | null
}

export interface EmployeeImportPreview {
  total_rows: number
  to_create: number
  to_skip: number
  errors: number
  rows: EmployeeImportRow[]
}

export interface EmployeeImportCommit {
  rows: EmployeeImportRow[]
}

export interface EmployeeImportResult {
  created: number
  skipped: number
  errors: string[]
}

export type UserRole = 'department_head' | 'manager' | 'core_team'

export interface ExternalLink {
  label: string
  url: string
}

export interface CurrentUser {
  id: number
  email: string
  full_name: string
  role: UserRole
  is_admin: boolean
  nav_visibility: Record<string, boolean>
  external_links: ExternalLink[]
}

// ---------- Admin panel ----------

export interface NavVisibilityResponse {
  items: Record<string, Record<string, boolean>>
}

export interface TechnologyCatalogEntry {
  technology_id: string
  name: string
  type: string
  aliases: string | null
  ecosystem: string
  detectability: 'high' | 'medium' | 'low'
  manifest_signals: string | null
  code_signals: string | null
  notes: string | null
}

export interface NotificationKindsResponse {
  enabled: Record<string, boolean>
  all_known_kinds: string[]
}

export interface NotificationAdminPublic {
  id: number
  recipient_user_id: number
  recipient_email: string | null
  kind: string
  title: string
  body: string | null
  link: string | null
  is_read: boolean
  created_at: string
}

export interface NotificationBroadcastRequest {
  title: string
  body: string | null
  role: UserRole | null
  user_ids: number[] | null
}

export interface CronRunPublic {
  id: number
  cron_name: string
  trigger: string
  status: string
  started_at: string
  finished_at: string | null
  error_msg: string | null
  triggered_by: number | null
}

export interface CronJobMeta {
  name: string
  schedule: string
  description: string
  paused: boolean
  last_run: CronRunPublic | null
}

export interface IntegrationsResponse {
  codebuddy_live: boolean
}

export interface GitLabConfigResponse {
  base_url: string
  api_token_set: boolean
  api_token_source: 'admin' | 'env' | 'none'
  auto_sync_enabled: boolean
}

export interface GitLabConfigUpdate {
  api_token?: string | null
  auto_sync_enabled: boolean
}

export interface CodeBuddyHealthResponse {
  ok: boolean
  reason: string | null
  status_code: number | null
  languages: number | null
  categories: number | null
  features: number | null
  checked_at: string
}

export interface LLMConfigResponse {
  base_url: string
  model: string
  api_key_set: boolean
}

export interface LLMConfigUpdate {
  base_url: string
  model: string
  api_key?: string | null
}

export interface LLMTestResponse {
  ok: boolean
  reason: string | null
  model: string | null
  checked_at: string
}

export interface ProfileItem {
  competency_id: number
  competency_name: string
  sort_order: number
  current_level: number | null
  required_level: number | null
  gap: number | null
}

export interface MpkProfile {
  items: ProfileItem[]
  last_assessment: { id: number; assessed_at: string } | null
  role: Role | null
  grade: Grade | null
}

export interface AssessmentListItem {
  id: number
  assessed_at: string
  source: string
  notes: string | null
  meeting_ids: number[]
}

export interface AssessmentScore {
  id: number
  competency_id: number
  level: number
  comment: string | null
}

export interface Assessment {
  id: number
  employee_id: number
  assessed_at: string
  author_id: number
  source: string
  notes: string | null
  meeting_ids: number[]
  scores: AssessmentScore[]
}

export interface AssessmentCreate {
  assessed_at?: string | null
  notes?: string | null
  meeting_ids?: number[]
  scores: { competency_id: number; level: number; comment?: string | null }[]
}

export interface HistoryPoint {
  assessed_at: string
  level: number
}

export interface HistoryCompetency {
  competency_id: number
  name: string
  sort_order: number
  points: HistoryPoint[]
}

export interface MpkHistory {
  competencies: HistoryCompetency[]
}

export type MeetingStatus = 'planned' | 'done' | 'cancelled'

export type AIGenType = 'practical' | 'theoretical' | 'case' | 'code_review' | 'mixed'
export type AIDifficulty = 'current' | 'target' | 'above_target' | 'custom'
export type AIFormat = 'discussion' | 'code' | 'diagram' | 'written'

export interface AIGenParams {
  competency_ids: number[]
  count: number
  type: AIGenType
  difficulty: AIDifficulty
  custom_level: number | null
  format: AIFormat
  time_budget_min: number
  custom_constraints: string
  key_only: boolean
}

export interface AIQuestion {
  uid: string | null
  competency_id: number
  competency_name: string | null
  question: string
  expected_level: number
  rationale: string | null
  reference_answer: string | null
}

export interface AITask {
  uid: string | null
  competency_id: number
  competency_name: string | null
  title: string
  description: string
  input_data: string | null
  expected_level: number
  time_min: number | null
  reference_solution: string | null
}

export type ArtifactKind =
  | 'question_answer'
  | 'task_answer'
  | 'task_code'
  | 'manager_comment'
  | 'general_note'

export interface MeetingArtifact {
  id: number
  meeting_id: number
  kind: ArtifactKind
  ai_item_uid: string | null
  competency_id: number | null
  content: string
  created_by: number
  created_at: string
  updated_at: string
}

export interface MeetingArtifactUpsert {
  kind: ArtifactKind
  ai_item_uid: string | null
  competency_id?: number | null
  content: string
}

export interface AIQuestionsStored {
  items: AIQuestion[]
  params: AIGenParams
  generated_at: string
  model: string
}

export interface AITasksStored {
  items: AITask[]
  params: AIGenParams
  generated_at: string
  model: string
}

export interface Meeting {
  id: number
  employee_id: number
  procedure_id: number | null
  scheduled_at: string
  duration_min: number
  status: MeetingStatus
  agenda_md: string | null
  summary_md: string | null
  transcript_md: string | null
  ai_questions: AIQuestionsStored | null
  ai_tasks: AITasksStored | null
  created_by: number
}

export interface MeetingCreate {
  scheduled_at: string
  duration_min?: number
  status?: MeetingStatus
  agenda_md?: string | null
  summary_md?: string | null
  procedure_id?: number | null
}

export type ProcedureStatus = 'open' | 'closed'

export interface ProcedureListItem {
  id: number
  title: string
  period_start: string | null
  period_end: string | null
  status: ProcedureStatus
  role_snapshot: string | null
  grade_snapshot: string | null
  meetings_count: number
  assessments_count: number
  created_at: string
}

export interface Procedure {
  id: number
  employee_id: number
  title: string
  period_start: string | null
  period_end: string | null
  status: ProcedureStatus
  summary_md: string | null
  role_snapshot: string | null
  grade_snapshot: string | null
  preparation_md: string | null
  created_by: number
  created_at: string
  meeting_ids: number[]
  assessment_ids: number[]
}

export interface RecommendationListItem {
  id: number
  title: string
  procedure_id: number | null
  model: string
  created_at: string
}

export interface Recommendation {
  id: number
  employee_id: number
  procedure_id: number | null
  title: string
  content_md: string
  context_summary: Record<string, unknown>
  model: string
  created_by: number
  created_at: string
}

export interface RecommendationGenerateRequest {
  procedure_id?: number | null
  title?: string | null
}

export type AIJobStatus = 'queued' | 'running' | 'done' | 'error'
export type AIJobKind =
  | 'meeting_questions'
  | 'meeting_tasks'
  | 'meeting_summary'
  | 'procedure_preparation'
  | 'employee_recommendation'
  | 'rotation_suggestion'
  | 'self_review_topics'
  | 'self_review_compare'
  | 'self_review_burnout'
  | 'self_review_calibration'
  | 'self_review_draft'
  | 'candidate_screening'
  | 'digital_profile'

export interface AIJob {
  id: number
  kind: AIJobKind
  status: AIJobStatus
  employee_id: number
  target_kind: string | null
  target_id: number | null
  payload: Record<string, unknown>
  result: Record<string, unknown> | null
  error: string | null
  started_at: string | null
  finished_at: string | null
  created_by: number
  created_at: string
}

export interface ProcedureCreate {
  title: string
  period_start?: string | null
  period_end?: string | null
}

export interface ProcedureUpdate {
  title?: string
  period_start?: string | null
  period_end?: string | null
  status?: ProcedureStatus
  summary_md?: string | null
}

export interface ProcedureSnapshotItem {
  competency_id: number
  competency_name: string
  sort_order: number
  procedure_level: number | null
  required_level: number | null
  gap: number | null
}

export interface ProcedureSnapshot {
  items: ProcedureSnapshotItem[]
}

export interface MeetingUpdate {
  scheduled_at?: string
  duration_min?: number
  status?: MeetingStatus
  agenda_md?: string | null
  summary_md?: string | null
}

function authHeaders(): Record<string, string> {
  const t = getToken()
  return t ? { Authorization: `Bearer ${t}` } : {}
}

async function fetchAuthed(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers as Record<string, string>) },
  })
  if (res.status === 401) {
    clearToken()
    window.location.href = '/login'
    throw new Error('unauthorized')
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(detail.detail || `HTTP ${res.status}`)
  }
  return res
}

export async function downloadBlob(path: string, filename: string): Promise<void> {
  const res = await fetchAuthed(path)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function openPrintView(path: string): Promise<void> {
  const res = await fetchAuthed(path)
  const html = await res.text()
  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const w = window.open(url, '_blank')
  if (!w) throw new Error('Браузер заблокировал всплывающее окно')
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(init.headers as Record<string, string>),
    },
  })
  if (res.status === 401) {
    clearToken()
    window.location.href = '/login'
    throw new Error('unauthorized')
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(detail.detail || `HTTP ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export type TechnologyStatus = 'adopt' | 'trial' | 'assess' | 'hold'
export type TechnologyMemberRole = 'leader' | 'expert' | 'practitioner'
export type TechnologyUsageType = 'production' | 'pilot' | 'evaluation' | 'legacy'
export type TechnologyLinkKind =
  | 'documentation' | 'methodology' | 'guide' | 'course'
  | 'community' | 'source' | 'article' | 'other'

export interface TechnologyCategory {
  id: number; code: string; name: string; description: string | null; sort_order: number
}
export interface TechnologyMetaOption { value: string; label: string }
export interface TechnologyMeta {
  categories: TechnologyCategory[]
  statuses: TechnologyMetaOption[]
  member_roles: TechnologyMetaOption[]
  usage_types: TechnologyMetaOption[]
  link_kinds: TechnologyMetaOption[]
}
export interface TechnologyAttentionFlags {
  overdue_review: boolean
  no_expertise: boolean
  hold_in_active_products: boolean
  has_attention: boolean
}
export interface TechnologyRef { id: number; name: string; status: TechnologyStatus }
export interface TechnologyListItem {
  id: number; name: string; icon_slug: string | null; category: TechnologyCategory; status: TechnologyStatus
  status_reason_md: string | null; replacement: TechnologyRef | null
  status_changed_at: string; last_reviewed_at: string | null; next_review_at: string | null
  is_active: boolean; leaders_count: number; experts_count: number
  practitioners_count: number; products_count: number; active_products_count: number
  attention: TechnologyAttentionFlags
}
export interface TechnologyMember {
  employee_id: number; full_name: string; role_name: string | null
  grade_code: string | null; department_name: string | null; employee_active: boolean
  role: TechnologyMemberRole; source: 'manual' | 'inferred'; notes: string | null
}
export interface TechnologyProductLink {
  product_id: number; product_name: string; product_status: string
  usage_type: TechnologyUsageType; notes: string | null
}
export interface TechnologyLink {
  id: number; kind: TechnologyLinkKind; title: string; url: string; sort_order: number
}
export interface TechnologyDecision {
  id: number; event_kind: 'created' | 'status_changed' | 'reviewed' | 'archived' | 'restored'
  from_status: TechnologyStatus | null; to_status: TechnologyStatus | null
  summary_md: string; next_review_at: string | null; created_by: number; created_at: string
}
export interface Technology extends TechnologyListItem {
  description_md: string | null; members: TechnologyMember[]
  products: TechnologyProductLink[]; links: TechnologyLink[]; decisions: TechnologyDecision[]
  created_by: number; created_at: string; updated_at: string
}
export interface ProductTechnology {
  technology_id: number; technology_name: string; icon_slug: string | null; category: TechnologyCategory
  status: TechnologyStatus; usage_type: TechnologyUsageType; notes: string | null
  attention: TechnologyAttentionFlags
}
export interface EmployeeTechnologyProductRef {
  product_id: number
  product_name: string
  usage_type: TechnologyUsageType
}
export interface EmployeeTechnology {
  technology_id: number
  technology_name: string
  icon_slug: string | null
  category: TechnologyCategory
  status: TechnologyStatus
  member_role: TechnologyMemberRole
  source: 'manual' | 'inferred'
  notes: string | null
  products: EmployeeTechnologyProductRef[]
  attention: TechnologyAttentionFlags
}
export interface TechnologyCompetencyLink {
  competency_id: number; competency_name: string; weight: number; notes: string | null
}
export interface TechnologyCandidate {
  employee_id: number; full_name: string; suggested_role: 'expert' | 'practitioner'
  department_id: number | null; department_name: string | null
  max_mpk_level: number | null; matched_competencies: string[]
  product_count: number; pr_count: number; reasons: string[]
}
export interface TechnologyBusFactor {
  leaders: number; experts: number; practitioners: number; active_products: number
  single_expert_risk: boolean; low_carrier_coverage: boolean
  departed_experts: number; signals: string[]
}
export interface TechnologyVulnerability {
  id: number; advisory_id: string; severity: 'critical' | 'high' | 'medium' | 'low' | 'unknown'
  summary: string; url: string | null; is_kev: boolean; epss: number | null
  affected: boolean; fetched_at: string
}
export interface TechnologyVersionEvidence {
  id: number; package_mapping_id: number; ecosystem: string; package_name: string
  project_id: number; project_name: string; product_id: number | null; product_name: string | null
  version: string; source: string; detected_at: string; vulnerabilities: TechnologyVulnerability[]
}
export interface TechnologySecuritySummary {
  critical: number; high: number; medium: number; low: number; kev: number
  affected_products: number; evidence: TechnologyVersionEvidence[]
}
export interface TechnologyPackageMapping {
  id: number; ecosystem: string; package_name: string
}
export interface TechnologyNewsItem {
  id: number; title: string; url: string; source: string; published_at: string; summary: string | null
}
export interface TechnologyNewsSource {
  id: number
  name: string
  feed_url: string
  is_active: boolean
  last_fetched_at: string | null
}
export interface TechnologyProposal {
  id: number; name: string; category_id: number; rationale_md: string; status: string
  decision_md: string | null; proposed_by: number; decided_by: number | null
  technology_id: number | null; created_at: string
}
export interface TechnologyCreatePayload {
  name: string; category_id: number; description_md?: string | null
  icon_slug?: string | null
  status: TechnologyStatus; status_reason_md?: string | null
  replacement_technology_id?: number | null; next_review_at?: string | null
}
export interface TechnologyUpdatePayload {
  name?: string; category_id?: number; description_md?: string | null
  icon_slug?: string | null
  replacement_technology_id?: number | null; next_review_at?: string | null
}

export const api = {
  login: async (email: string, password: string) => {
    const body = new URLSearchParams({ username: email, password })
    const res = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!res.ok) throw new Error('Неверный email или пароль')
    return res.json() as Promise<{ access_token: string; token_type: string }>
  },
  me: () => request<CurrentUser>('/auth/me'),

  technologies: {
    meta: () => request<TechnologyMeta>('/technologies/meta'),
    list: (params?: {
      q?: string; status?: TechnologyStatus; category_id?: number
      product_id?: number; attention_only?: boolean; include_archived?: boolean; limit?: number
      exclude_employee_id?: number; exclude_product_id?: number; offset?: number
    }) => {
      const qs = new URLSearchParams()
      if (params?.q) qs.set('q', params.q)
      if (params?.status) qs.set('status', params.status)
      if (params?.category_id) qs.set('category_id', String(params.category_id))
      if (params?.product_id) qs.set('product_id', String(params.product_id))
      if (params?.attention_only) qs.set('attention_only', 'true')
      if (params?.include_archived) qs.set('include_archived', 'true')
      if (params?.limit) qs.set('limit', String(params.limit))
      if (params?.offset) qs.set('offset', String(params.offset))
      if (params?.exclude_employee_id) qs.set('exclude_employee_id', String(params.exclude_employee_id))
      if (params?.exclude_product_id) qs.set('exclude_product_id', String(params.exclude_product_id))
      return request<TechnologyListItem[]>(`/technologies${qs.size ? `?${qs}` : ''}`)
    },
    get: (id: number) => request<Technology>(`/technologies/${id}`),
    create: (data: TechnologyCreatePayload) =>
      request<Technology>('/technologies', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: TechnologyUpdatePayload) =>
      request<Technology>(`/technologies/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    changeStatus: (id: number, data: {
      status: TechnologyStatus; reason_md: string; next_review_at?: string | null
      replacement_technology_id?: number | null
    }) => request<Technology>(`/technologies/${id}/status`, { method: 'POST', body: JSON.stringify(data) }),
    review: (id: number, data: { summary_md: string; next_review_at?: string | null }) =>
      request<Technology>(`/technologies/${id}/review`, { method: 'POST', body: JSON.stringify(data) }),
    archive: (id: number, reason_md: string) =>
      request<Technology>(`/technologies/${id}/archive`, { method: 'POST', body: JSON.stringify({ reason_md }) }),
    restore: (id: number, reason_md = 'Технология восстановлена в реестре') =>
      request<Technology>(`/technologies/${id}/restore`, { method: 'POST', body: JSON.stringify({ reason_md }) }),
    members: {
      add: (id: number, data: { employee_id: number; role: TechnologyMemberRole; notes?: string | null }) =>
        request<TechnologyMember>(`/technologies/${id}/members`, { method: 'POST', body: JSON.stringify(data) }),
      update: (id: number, employeeId: number, data: { role?: TechnologyMemberRole; notes?: string | null }) =>
        request<TechnologyMember>(`/technologies/${id}/members/${employeeId}`, { method: 'PATCH', body: JSON.stringify(data) }),
      remove: (id: number, employeeId: number) =>
        request<void>(`/technologies/${id}/members/${employeeId}`, { method: 'DELETE' }),
    },
    products: {
      add: (id: number, data: { product_id: number; usage_type: TechnologyUsageType; notes?: string | null }) =>
        request<TechnologyProductLink>(`/technologies/${id}/products`, { method: 'POST', body: JSON.stringify(data) }),
      update: (id: number, productId: number, data: { usage_type?: TechnologyUsageType; notes?: string | null }) =>
        request<TechnologyProductLink>(`/technologies/${id}/products/${productId}`, { method: 'PATCH', body: JSON.stringify(data) }),
      remove: (id: number, productId: number) =>
        request<void>(`/technologies/${id}/products/${productId}`, { method: 'DELETE' }),
    },
    links: {
      add: (id: number, data: { kind: TechnologyLinkKind; title: string; url: string; sort_order?: number }) =>
        request<TechnologyLink>(`/technologies/${id}/links`, { method: 'POST', body: JSON.stringify(data) }),
      update: (id: number, linkId: number, data: Partial<Omit<TechnologyLink, 'id'>>) =>
        request<TechnologyLink>(`/technologies/${id}/links/${linkId}`, { method: 'PATCH', body: JSON.stringify(data) }),
      remove: (id: number, linkId: number) =>
        request<void>(`/technologies/${id}/links/${linkId}`, { method: 'DELETE' }),
    },
    competencies: {
      list: (id: number) => request<TechnologyCompetencyLink[]>(`/technologies/${id}/competencies`),
      set: (id: number, items: { competency_id: number; weight: number; notes?: string | null }[]) =>
        request<TechnologyCompetencyLink[]>(`/technologies/${id}/competencies`, { method: 'PUT', body: JSON.stringify(items) }),
    },
    candidates: {
      list: (id: number, params?: { q?: string; department_id?: number; suggested_role?: 'expert' | 'practitioner'; limit?: number }) => {
        const qs = new URLSearchParams()
        if (params?.q) qs.set('q', params.q)
        if (params?.department_id) qs.set('department_id', String(params.department_id))
        if (params?.suggested_role) qs.set('suggested_role', params.suggested_role)
        if (params?.limit) qs.set('limit', String(params.limit))
        return request<TechnologyCandidate[]>(`/technologies/${id}/candidates${qs.size ? `?${qs}` : ''}`)
      },
      accept: (id: number, employeeId: number, role: 'expert' | 'practitioner') =>
        request<{ status: string }>(`/technologies/${id}/candidates/${employeeId}/accept?role=${role}`, { method: 'POST' }),
    },
    busFactor: (id: number) => request<TechnologyBusFactor>(`/technologies/${id}/bus-factor`),
    security: (id: number) => request<TechnologySecuritySummary>(`/technologies/${id}/security`),
    packages: {
      list: (id: number) => request<TechnologyPackageMapping[]>(`/technologies/${id}/packages`),
      add: (id: number, data: { ecosystem: string; package_name: string }) =>
        request<TechnologyPackageMapping>(`/technologies/${id}/packages`, { method: 'POST', body: JSON.stringify(data) }),
      remove: (id: number, mappingId: number) =>
        request<void>(`/technologies/${id}/packages/${mappingId}`, { method: 'DELETE' }),
    },
    versions: {
      add: (id: number, data: { package_mapping_id: number; project_id: number; version: string; source?: string }) =>
        request<TechnologyVersionEvidence>(`/technologies/${id}/versions`, { method: 'POST', body: JSON.stringify(data) }),
      update: (id: number, evidenceId: number, data: { version?: string; source?: string }) =>
        request<TechnologyVersionEvidence>(`/technologies/${id}/versions/${evidenceId}`, { method: 'PATCH', body: JSON.stringify(data) }),
      remove: (id: number, evidenceId: number) =>
        request<void>(`/technologies/${id}/versions/${evidenceId}`, { method: 'DELETE' }),
    },
    osvScan: (id: number, evidenceId: number) =>
      request<TechnologySecuritySummary>(`/technologies/${id}/versions/${evidenceId}/osv-scan`, { method: 'POST' }),
    news: {
      list: (id: number) => request<TechnologyNewsItem[]>(`/technologies/${id}/news`),
      add: (id: number, data: { title: string; url: string; source: string; published_at: string; summary?: string | null }) =>
        request<TechnologyNewsItem>(`/technologies/${id}/news`, { method: 'POST', body: JSON.stringify(data) }),
      sources: (id: number) => request<TechnologyNewsSource[]>(`/technologies/${id}/news-sources`),
      addSource: (id: number, data: { name: string; feed_url: string }) =>
        request<TechnologyNewsSource>(`/technologies/${id}/news-sources`, { method: 'POST', body: JSON.stringify(data) }),
      removeSource: (id: number, sourceId: number) =>
        request<void>(`/technologies/${id}/news-sources/${sourceId}`, { method: 'DELETE' }),
      fetchSource: (id: number, sourceId: number) =>
        request<TechnologyNewsItem[]>(`/technologies/${id}/news-sources/${sourceId}/fetch`, { method: 'POST' }),
    },
  },

  technologyProposals: {
    list: () => request<TechnologyProposal[]>('/technology-proposals'),
    create: (data: { name: string; category_id: number; rationale_md: string }) =>
      request<TechnologyProposal>('/technology-proposals', { method: 'POST', body: JSON.stringify(data) }),
    decide: (id: number, data: { status: 'assessing' | 'approved' | 'rejected'; decision_md: string }) =>
      request<TechnologyProposal>(`/technology-proposals/${id}/decision`, { method: 'POST', body: JSON.stringify(data) }),
  },

  employees: {
    list: () => request<Employee[]>('/employees'),
    get: (id: number) => request<Employee>(`/employees/${id}`),
    create: (data: EmployeeCreate) =>
      request<Employee>('/employees', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: EmployeeUpdate) =>
      request<Employee>(`/employees/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: number) => request<void>(`/employees/${id}`, { method: 'DELETE' }),
    mpkProfile: (id: number) => request<MpkProfile>(`/employees/${id}/mpk-profile`),
    mpkHistory: (id: number) => request<MpkHistory>(`/employees/${id}/mpk-history`),
    projects: (id: number) =>
      request<EmployeeProjectHistoryItem[]>(`/employees/${id}/projects`),
    technologies: (id: number) =>
      request<EmployeeTechnology[]>(`/employees/${id}/technologies`),
    devMetrics: (id: number, opts?: { from?: string; to?: string }) => {
      const qs = new URLSearchParams()
      if (opts?.from) qs.set('from', opts.from)
      if (opts?.to) qs.set('to', opts.to)
      const suffix = qs.toString() ? `?${qs}` : ''
      return request<DevMetricsSnapshotPublic | null>(
        `/employees/${id}/dev-metrics${suffix}`,
      )
    },
    pullRequests: (
      id: number,
      opts?: { from?: string; to?: string; limit?: number },
    ) => {
      const qs = new URLSearchParams()
      qs.set('limit', String(opts?.limit ?? 50))
      if (opts?.from) qs.set('from', opts.from)
      if (opts?.to) qs.set('to', opts.to)
      return request<PullRequestPublic[]>(
        `/employees/${id}/pull-requests?${qs}`,
      )
    },
    pullRequestStatusAccess: (id: number, url: string) =>
      request<PullRequestStatusAccess>(`/employees/${id}/pull-requests/status-access`, {
        method: 'POST', body: JSON.stringify({ url }),
      }),
    syncPullRequestStatus: (id: number, url: string) =>
      request<PullRequestStatusSync>(`/employees/${id}/pull-requests/sync-status`, {
        method: 'POST', body: JSON.stringify({ url }),
      }),
    extractedCompetencies: (
      id: number,
      opts?: { from?: string; to?: string; include_answers?: boolean },
    ) => {
      const qs = new URLSearchParams()
      if (opts?.from) qs.set('from', opts.from)
      if (opts?.to) qs.set('to', opts.to)
      if (opts?.include_answers) qs.set('include_answers', 'true')
      const suffix = qs.toString() ? `?${qs}` : ''
      return request<ExtractedCompetenciesResponse>(
        `/employees/${id}/extracted-competencies${suffix}`,
      )
    },
    competencyPrs: (
      employeeId: number,
      competencyId: number,
      opts?: { from?: string; to?: string },
    ) => {
      const qs = new URLSearchParams()
      if (opts?.from) qs.set('from', opts.from)
      if (opts?.to) qs.set('to', opts.to)
      const suffix = qs.toString() ? `?${qs}` : ''
      return request<PullRequestPublic[]>(
        `/employees/${employeeId}/competencies/${competencyId}/prs${suffix}`,
      )
    },
    digitalProfile: (id: number) =>
      request<DigitalProfilePublic | null>(
        `/employees/${id}/digital-profile`,
      ),
    generateDigitalProfile: (id: number) =>
      request<AIJob>(`/employees/${id}/digital-profile/generate`, {
        method: 'POST',
      }),
    importXlsx: {
      preview: async (file: File, departmentId: number | null) => {
        const fd = new FormData()
        fd.append('file', file)
        if (departmentId !== null) fd.append('department_id', String(departmentId))
        const res = await fetch(`${BASE}/employees/import-xlsx/preview`, {
          method: 'POST',
          headers: { ...authHeaders() },
          body: fd,
        })
        if (res.status === 401) {
          clearToken()
          window.location.href = '/login'
          throw new Error('unauthorized')
        }
        if (!res.ok) {
          const detail = await res.json().catch(() => ({ detail: res.statusText }))
          throw new Error(detail.detail || `HTTP ${res.status}`)
        }
        return res.json() as Promise<EmployeeImportPreview>
      },
      commit: (payload: EmployeeImportCommit) =>
        request<EmployeeImportResult>('/employees/import-xlsx/commit', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
    },
    procedures: {
      list: (empId: number) =>
        request<ProcedureListItem[]>(`/employees/${empId}/procedures`),
      get: (empId: number, id: number) =>
        request<Procedure>(`/employees/${empId}/procedures/${id}`),
      create: (empId: number, data: ProcedureCreate) =>
        request<Procedure>(`/employees/${empId}/procedures`, {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      update: (empId: number, id: number, data: ProcedureUpdate) =>
        request<Procedure>(`/employees/${empId}/procedures/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        }),
      delete: (empId: number, id: number) =>
        request<void>(`/employees/${empId}/procedures/${id}`, { method: 'DELETE' }),
      snapshot: (empId: number, id: number) =>
        request<ProcedureSnapshot>(`/employees/${empId}/procedures/${id}/snapshot`),
      generatePreparation: (empId: number, id: number) =>
        request<AIJob>(
          `/employees/${empId}/procedures/${id}/preparation/generate`,
          { method: 'POST' },
        ),
      downloadPreparationDocx: (empId: number, id: number, filename: string) =>
        downloadBlob(
          `/employees/${empId}/procedures/${id}/preparation/export.docx`,
          filename,
        ),
      openPreparationPrint: (empId: number, id: number) =>
        openPrintView(`/employees/${empId}/procedures/${id}/preparation/print`),
    },
    recommendations: {
      list: (empId: number) =>
        request<RecommendationListItem[]>(`/employees/${empId}/recommendations`),
      get: (empId: number, id: number) =>
        request<Recommendation>(`/employees/${empId}/recommendations/${id}`),
      generate: (empId: number, data: RecommendationGenerateRequest) =>
        request<AIJob>(`/employees/${empId}/recommendations/generate`, {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      delete: (empId: number, id: number) =>
        request<void>(`/employees/${empId}/recommendations/${id}`, {
          method: 'DELETE',
        }),
      downloadDocx: (empId: number, id: number, filename: string) =>
        downloadBlob(
          `/employees/${empId}/recommendations/${id}/export.docx`,
          filename,
        ),
      openPrint: (empId: number, id: number) =>
        openPrintView(`/employees/${empId}/recommendations/${id}/print`),
    },
    assessments: {
      list: (empId: number) =>
        request<AssessmentListItem[]>(`/employees/${empId}/assessments`),
      get: (empId: number, id: number) =>
        request<Assessment>(`/employees/${empId}/assessments/${id}`),
      create: (empId: number, data: AssessmentCreate) =>
        request<Assessment>(`/employees/${empId}/assessments`, {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      delete: (empId: number, id: number) =>
        request<void>(`/employees/${empId}/assessments/${id}`, { method: 'DELETE' }),
    },
    meetings: {
      list: (empId: number) => request<Meeting[]>(`/employees/${empId}/meetings`),
      get: (empId: number, id: number) =>
        request<Meeting>(`/employees/${empId}/meetings/${id}`),
      create: (empId: number, data: MeetingCreate) =>
        request<Meeting>(`/employees/${empId}/meetings`, {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      update: (empId: number, id: number, data: MeetingUpdate) =>
        request<Meeting>(`/employees/${empId}/meetings/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        }),
      delete: (empId: number, id: number) =>
        request<void>(`/employees/${empId}/meetings/${id}`, { method: 'DELETE' }),
      assessments: (empId: number, mid: number) =>
        request<AssessmentListItem[]>(
          `/employees/${empId}/meetings/${mid}/assessments`,
        ),
      artifacts: {
        list: (empId: number, mid: number) =>
          request<MeetingArtifact[]>(
            `/employees/${empId}/meetings/${mid}/artifacts`,
          ),
        upsert: (empId: number, mid: number, data: MeetingArtifactUpsert) =>
          request<MeetingArtifact | null>(
            `/employees/${empId}/meetings/${mid}/artifacts/upsert`,
            { method: 'PUT', body: JSON.stringify(data) },
          ),
        delete: (empId: number, mid: number, id: number) =>
          request<void>(
            `/employees/${empId}/meetings/${mid}/artifacts/${id}`,
            { method: 'DELETE' },
          ),
      },
      ai: {
        questions: (empId: number, mid: number, params: AIGenParams) =>
          request<AIJob>(
            `/employees/${empId}/meetings/${mid}/ai/questions`,
            { method: 'POST', body: JSON.stringify(params) },
          ),
        tasks: (empId: number, mid: number, params: AIGenParams) =>
          request<AIJob>(
            `/employees/${empId}/meetings/${mid}/ai/tasks`,
            { method: 'POST', body: JSON.stringify(params) },
          ),
        summary: (empId: number, mid: number, notes: string) =>
          request<AIJob>(
            `/employees/${empId}/meetings/${mid}/ai/summary`,
            { method: 'POST', body: JSON.stringify({ notes }) },
          ),
      },
    },
  },

  dashboard: {
    metrics: (managerId?: number | null) => {
      const qs = managerId ? `?manager_id=${managerId}` : ''
      return request<DashboardMetrics>(`/dashboard/metrics${qs}`)
    },
    team: (managerId?: number | null) => {
      const qs = managerId ? `?manager_id=${managerId}` : ''
      return request<TeamMetrics>(`/dashboard/team${qs}`)
    },
    upcoming: (days = 30, limit = 20, managerId?: number | null) => {
      const qs = managerId
        ? `&manager_id=${managerId}`
        : ''
      return request<UpcomingMeeting[]>(
        `/dashboard/upcoming?days=${days}&limit=${limit}${qs}`,
      )
    },
    devActivity: (
      managerId?: number | null,
      periodDays: number = 90,
    ) => {
      const params = new URLSearchParams()
      if (managerId) params.set('manager_id', String(managerId))
      params.set('period_days', String(periodDays))
      return request<DevActivitySummary>(
        `/dashboard/dev-activity?${params}`,
      )
    },
  },

  products: {
    list: () => request<ProductListItem[]>('/products'),
    get: (id: number) => request<Product>(`/products/${id}`),
    technologies: (id: number) => request<ProductTechnology[]>(`/products/${id}/technologies`),
    create: (data: ProductCreate) =>
      request<Product>('/products', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: ProductUpdate) =>
      request<Product>(`/products/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    delete: (id: number) =>
      request<void>(`/products/${id}`, { method: 'DELETE' }),
    addMember: (
      id: number,
      data: {
        employee_id: number
        role_in_project?: string | null
        joined_at?: string | null
      },
    ) =>
      request<ProductMember>(`/products/${id}/members`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateMember: (
      id: number,
      memberId: number,
      data: {
        role_in_project?: string | null
        joined_at?: string | null
        left_at?: string | null
      },
    ) =>
      request<ProductMember>(`/products/${id}/members/${memberId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    removeMember: (id: number, memberId: number) =>
      request<void>(`/products/${id}/members/${memberId}`, {
        method: 'DELETE',
      }),
    lockMember: (id: number, memberId: number, note: string | null) =>
      request<ProductMember>(
        `/products/${id}/members/${memberId}/rotation-lock`,
        { method: 'PUT', body: JSON.stringify({ note }) },
      ),
    unlockMember: (id: number, memberId: number) =>
      request<ProductMember>(
        `/products/${id}/members/${memberId}/rotation-lock`,
        { method: 'DELETE' },
      ),
    setStack: (
      id: number,
      items: { competency_id: number; target_level: number }[],
    ) =>
      request<ProductStackItem[]>(`/products/${id}/stack`, {
        method: 'PUT',
        body: JSON.stringify({ items }),
      }),
    matrix: (id: number, onlyStack = true) =>
      request<ProjectMatrix>(
        `/products/${id}/matrix${onlyStack ? '' : '?only_stack=false'}`,
      ),
    coverage: (id: number) =>
      request<ProjectCoverage>(`/products/${id}/coverage`),
    grades: (id: number) =>
      request<ProjectGradeDistribution>(`/products/${id}/grade-distribution`),
    rotations: (id: number) =>
      request<RotationsPanel>(`/products/${id}/rotations`),
    extractedCompetencies: (
      id: number,
      opts?: { from?: string; to?: string },
    ) => {
      const qs = new URLSearchParams()
      if (opts?.from) qs.set('from', opts.from)
      if (opts?.to) qs.set('to', opts.to)
      const suffix = qs.toString() ? `?${qs}` : ''
      return request<ProjectExtractedCompetenciesResponse>(
        `/products/${id}/extracted-competencies${suffix}`,
      )
    },
    devMetrics: (
      id: number,
      opts?: { from?: string; to?: string },
    ) => {
      const qs = new URLSearchParams()
      if (opts?.from) qs.set('from', opts.from)
      if (opts?.to) qs.set('to', opts.to)
      const suffix = qs.toString() ? `?${qs}` : ''
      return request<DevMetricsSnapshotPublic | null>(
        `/products/${id}/dev-metrics${suffix}`,
      )
    },
    pullRequests: (
      id: number,
      opts?: { from?: string; to?: string; limit?: number },
    ) => {
      const qs = new URLSearchParams()
      if (opts?.from) qs.set('from', opts.from)
      if (opts?.to) qs.set('to', opts.to)
      if (opts?.limit) qs.set('limit', String(opts.limit))
      const suffix = qs.toString() ? `?${qs}` : ''
      return request<PullRequestPublic[]>(
        `/products/${id}/pull-requests${suffix}`,
      )
    },
    competencyPrs: (
      id: number,
      competencyId: number,
      opts?: { from?: string; to?: string },
    ) => {
      const qs = new URLSearchParams()
      if (opts?.from) qs.set('from', opts.from)
      if (opts?.to) qs.set('to', opts.to)
      const suffix = qs.toString() ? `?${qs}` : ''
      return request<PullRequestPublic[]>(
        `/products/${id}/competencies/${competencyId}/prs${suffix}`,
      )
    },
    performance: (id: number, periodDays = 90) =>
      request<ProductPerformanceResponse>(
        `/products/${id}/performance?period_days=${periodDays}`,
      ),
    performanceTrends: (id: number, buckets = 6, bucketDays = 30) =>
      request<ProductTrends>(
        `/products/${id}/performance/trends` +
          `?buckets=${buckets}&bucket_days=${bucketDays}`,
      ),
    performanceReview: (id: number) =>
      request<PerformanceReview | null>(
        `/products/${id}/performance/ai-review`,
      ),
    createPerformanceReview: (id: number) =>
      request<PerformanceReview>(
        `/products/${id}/performance/ai-review`,
        { method: 'POST' },
      ),
    techMaturity: {
      template: (id: number) =>
        request<TechMaturityTemplate>(
          `/products/${id}/tech-maturity/template`,
        ),
      list: (id: number) =>
        request<TechMaturitySurveyListItem[]>(
          `/products/${id}/tech-maturity`,
        ),
      get: (id: number, surveyId: number) =>
        request<TechMaturitySurvey>(
          `/products/${id}/tech-maturity/${surveyId}`,
        ),
      create: (id: number, period: string) =>
        request<TechMaturitySurvey>(`/products/${id}/tech-maturity`, {
          method: 'POST',
          body: JSON.stringify({ period }),
        }),
      update: (
        id: number,
        surveyId: number,
        data: {
          info?: Record<string, string>
          answers?: Record<string, string | number | boolean>
          status?: TechMaturityStatus
        },
      ) =>
        request<TechMaturitySurvey>(
          `/products/${id}/tech-maturity/${surveyId}`,
          { method: 'PATCH', body: JSON.stringify(data) },
        ),
      delete: (id: number, surveyId: number) =>
        request<void>(`/products/${id}/tech-maturity/${surveyId}`, {
          method: 'DELETE',
        }),
    },
  },

  projects: {
    list: () => request<ProjectListItem[]>('/projects'),
    get: (id: number) => request<Project>(`/projects/${id}`),
    extractedCompetencies: (
      id: number,
      opts?: { from?: string; to?: string },
    ) => {
      const qs = new URLSearchParams()
      if (opts?.from) qs.set('from', opts.from)
      if (opts?.to) qs.set('to', opts.to)
      const suffix = qs.toString() ? `?${qs}` : ''
      return request<ProjectExtractedCompetenciesResponse>(
        `/projects/${id}/extracted-competencies${suffix}`,
      )
    },
    create: (data: ProjectCreate) =>
      request<Project>('/projects', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: ProjectUpdate) =>
      request<Project>(`/projects/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    delete: (id: number) =>
      request<void>(`/projects/${id}`, { method: 'DELETE' }),
    addMember: (
      id: number,
      data: { employee_id: number; role_in_project?: string | null; joined_at?: string | null },
    ) =>
      request<ProjectMember>(`/projects/${id}/members`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateMember: (
      id: number,
      memberId: number,
      data: {
        role_in_project?: string | null
        joined_at?: string | null
        left_at?: string | null
      },
    ) =>
      request<ProjectMember>(`/projects/${id}/members/${memberId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    removeMember: (id: number, memberId: number) =>
      request<void>(`/projects/${id}/members/${memberId}`, { method: 'DELETE' }),
    setStack: (
      id: number,
      items: { competency_id: number; target_level: number }[],
    ) =>
      request<ProjectStackItem[]>(`/projects/${id}/stack`, {
        method: 'PUT',
        body: JSON.stringify({ items }),
      }),
    matrix: (id: number, onlyStack = true) =>
      request<ProjectMatrix>(
        `/projects/${id}/matrix${onlyStack ? '' : '?only_stack=false'}`,
      ),
    coverage: (id: number) =>
      request<ProjectCoverage>(`/projects/${id}/coverage`),
    grades: (id: number) =>
      request<ProjectGradeDistribution>(`/projects/${id}/grade-distribution`),
    lockMember: (id: number, memberId: number, note: string | null) =>
      request<ProjectMember>(
        `/projects/${id}/members/${memberId}/rotation-lock`,
        { method: 'PUT', body: JSON.stringify({ note }) },
      ),
    unlockMember: (id: number, memberId: number) =>
      request<ProjectMember>(
        `/projects/${id}/members/${memberId}/rotation-lock`,
        { method: 'DELETE' },
      ),
    rotations: (id: number) =>
      request<RotationsPanel>(`/projects/${id}/rotations`),
    pullRequests: (
      id: number,
      opts?: { from?: string; to?: string; limit?: number },
    ) => {
      const qs = new URLSearchParams()
      if (opts?.from) qs.set('from', opts.from)
      if (opts?.to) qs.set('to', opts.to)
      if (opts?.limit) qs.set('limit', String(opts.limit))
      const suffix = qs.toString() ? `?${qs}` : ''
      return request<PullRequestPublic[]>(
        `/projects/${id}/pull-requests${suffix}`,
      )
    },
    refreshRotationSuggestion: (id: number, employeeId: number) =>
      request<{ job_id: number; employee_id: number; from_project_id: number }>(
        `/projects/${id}/rotations/refresh/${employeeId}`,
        { method: 'POST' },
      ),
    replacements: (id: number, employeeId: number, toProjectId: number) =>
      request<ReplacementsResponse>(
        `/projects/${id}/rotations/${employeeId}/replacements?to_project_id=${toProjectId}`,
      ),
    // tech-maturity переехал на /products/:id/tech-maturity — см. api.products.techMaturity.
  },

  users: {
    list: () => request<CurrentUser[]>('/users'),
  },

  departments: {
    list: () => request<Department[]>('/departments'),
    get: (id: number) => request<Department>(`/departments/${id}`),
    create: (data: DepartmentCreate) =>
      request<Department>('/departments', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: number, data: DepartmentUpdate) =>
      request<Department>(`/departments/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    delete: (id: number) =>
      request<void>(`/departments/${id}`, { method: 'DELETE' }),
    maturity: {
      template: (id: number) =>
        request<DeptMaturityTemplate>(
          `/departments/${id}/maturity/template`,
        ),
      list: (id: number) =>
        request<DeptMaturitySurveyListItem[]>(
          `/departments/${id}/maturity`,
        ),
      get: (id: number, surveyId: number) =>
        request<DeptMaturitySurvey>(
          `/departments/${id}/maturity/${surveyId}`,
        ),
      create: (id: number, period: string) =>
        request<DeptMaturitySurvey>(`/departments/${id}/maturity`, {
          method: 'POST',
          body: JSON.stringify({ period }),
        }),
      update: (
        id: number,
        surveyId: number,
        data: {
          info?: Record<string, string>
          answers?: Record<string, DeptMaturityCellValue>
          status?: DeptMaturityStatus
        },
      ) =>
        request<DeptMaturitySurvey>(
          `/departments/${id}/maturity/${surveyId}`,
          { method: 'PATCH', body: JSON.stringify(data) },
        ),
      delete: (id: number, surveyId: number) =>
        request<void>(`/departments/${id}/maturity/${surveyId}`, {
          method: 'DELETE',
        }),
    },
    overview: (period?: string) => {
      const qs = period ? `?period=${encodeURIComponent(period)}` : ''
      return request<DeptMaturityOverviewItem[]>(`/dept-maturity/overview${qs}`)
    },
  },

  selfReviews: {
    listAll: (opts?: { year?: number; status?: SelfReviewStatus }) => {
      const qs = new URLSearchParams()
      if (opts?.year !== undefined) qs.set('year', String(opts.year))
      if (opts?.status) qs.set('status', opts.status)
      const suffix = qs.toString() ? `?${qs}` : ''
      return request<SelfReviewListItem[]>(`/self-reviews${suffix}`)
    },
    listForEmployee: (empId: number) =>
      request<SelfReviewListItem[]>(`/employees/${empId}/self-reviews`),
    get: (empId: number, id: number) =>
      request<SelfReview>(`/employees/${empId}/self-reviews/${id}`),
    create: (empId: number, data: SelfReviewCreate) =>
      request<SelfReview>(`/employees/${empId}/self-reviews`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (empId: number, id: number, data: SelfReviewUpdate) =>
      request<SelfReview>(`/employees/${empId}/self-reviews/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    delete: (empId: number, id: number) =>
      request<void>(`/employees/${empId}/self-reviews/${id}`, { method: 'DELETE' }),
    uploadSource: async (empId: number, id: number, file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(
        `${BASE}/employees/${empId}/self-reviews/${id}/source`,
        {
          method: 'POST',
          headers: { ...authHeaders() },
          body: fd,
        },
      )
      if (res.status === 401) {
        clearToken()
        window.location.href = '/login'
        throw new Error('unauthorized')
      }
      if (!res.ok) {
        const detail = await res
          .json()
          .catch(() => ({ detail: res.statusText }))
        throw new Error(detail.detail || `HTTP ${res.status}`)
      }
      return res.json() as Promise<SelfReview>
    },
    deleteSource: (empId: number, id: number) =>
      request<SelfReview>(`/employees/${empId}/self-reviews/${id}/source`, {
        method: 'DELETE',
      }),
    downloadSource: (empId: number, id: number, filename: string) =>
      downloadBlob(
        `/employees/${empId}/self-reviews/${id}/source`,
        filename,
      ),
    fetchViewerHtml: async (empId: number, id: number): Promise<string> => {
      const res = await fetchAuthed(
        `/employees/${empId}/self-reviews/${id}/viewer`,
      )
      return res.text()
    },
    enqueueAi: (empId: number, id: number, kind: SelfReviewAiKind) =>
      request<AIJob>(`/employees/${empId}/self-reviews/${id}/ai/${kind}`, {
        method: 'POST',
      }),
    downloadSummaryDocx: (empId: number, id: number, filename: string) =>
      downloadBlob(
        `/employees/${empId}/self-reviews/${id}/summary.docx`,
        filename,
      ),
    openSummaryPrint: (empId: number, id: number) =>
      openPrintView(`/employees/${empId}/self-reviews/${id}/summary/print`),
  },

  candidates: {
    list: (stage?: CandidateStage) => {
      const qs = stage ? `?stage=${stage}` : ''
      return request<CandidateListItem[]>(`/candidates${qs}`)
    },
    get: (id: number) => request<Candidate>(`/candidates/${id}`),
    create: (data: CandidateCreate) =>
      request<Candidate>('/candidates', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: number, data: CandidateUpdate) =>
      request<Candidate>(`/candidates/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    delete: (id: number) =>
      request<void>(`/candidates/${id}`, { method: 'DELETE' }),
    uploadResume: async (id: number, file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`${BASE}/candidates/${id}/resume`, {
        method: 'POST',
        headers: { ...authHeaders() },
        body: fd,
      })
      if (res.status === 401) {
        clearToken()
        window.location.href = '/login'
        throw new Error('unauthorized')
      }
      if (!res.ok) {
        const detail = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(detail.detail || `HTTP ${res.status}`)
      }
      return res.json() as Promise<Candidate>
    },
    deleteResume: (id: number) =>
      request<Candidate>(`/candidates/${id}/resume`, { method: 'DELETE' }),
    downloadResume: (id: number, filename: string) =>
      downloadBlob(`/candidates/${id}/resume`, filename),
    fetchResumeHtml: async (id: number): Promise<string> => {
      const res = await fetchAuthed(`/candidates/${id}/resume/viewer`)
      return res.text()
    },
    fetchResumeBytes: async (id: number): Promise<ArrayBuffer> => {
      const res = await fetchAuthed(`/candidates/${id}/resume`)
      return res.arrayBuffer()
    },
    hire: (id: number) =>
      request<Candidate>(`/candidates/${id}/hire`, { method: 'POST' }),
    reject: (id: number, reason: string | null) =>
      request<Candidate>(`/candidates/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason_md: reason }),
      }),
    enqueueAi: (id: number, kind: CandidateAiKind) =>
      request<AIJob>(`/candidates/${id}/ai/${kind}`, { method: 'POST' }),
    updateDecision: (
      id: number,
      data: {
        feedback_decision?: 'positive' | 'negative' | null
        rejection_reason_md?: string | null
      },
    ) =>
      request<Candidate>(`/candidates/${id}/decision`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
  },

  vacancies: {
    list: (opts?: {
      status?: VacancyStatus
      project_id?: number
      department_id?: number
    }) => {
      const qs = new URLSearchParams()
      if (opts?.status) qs.set('status', opts.status)
      if (opts?.project_id !== undefined)
        qs.set('project_id', String(opts.project_id))
      if (opts?.department_id !== undefined)
        qs.set('department_id', String(opts.department_id))
      const suffix = qs.toString() ? `?${qs}` : ''
      return request<VacancyListItem[]>(`/vacancies${suffix}`)
    },
    get: (id: number) => request<Vacancy>(`/vacancies/${id}`),
    create: (data: VacancyCreate) =>
      request<Vacancy>('/vacancies', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: number, data: VacancyUpdate) =>
      request<Vacancy>(`/vacancies/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    delete: (id: number) =>
      request<void>(`/vacancies/${id}`, { method: 'DELETE' }),
    requirementsTemplate: (data: {
      role_id?: number | null
      grade_id?: number | null
      project_id?: number | null
    }) =>
      request<{ requirements_md: string }>(
        '/vacancies/requirements-template',
        { method: 'POST', body: JSON.stringify(data) },
      ),
  },

  admin: {
    whoami: () => request<{ id: number; email: string; is_admin: boolean }>('/admin/whoami'),
    technologyCatalog: () =>
      request<TechnologyCatalogEntry[]>('/admin/technology-catalog'),
    navVisibility: {
      get: () => request<NavVisibilityResponse>('/admin/nav-visibility'),
      put: (items: Record<string, Record<string, boolean>>) =>
        request<NavVisibilityResponse>('/admin/nav-visibility', {
          method: 'PUT',
          body: JSON.stringify({ items }),
        }),
    },
    notificationKinds: {
      get: () => request<NotificationKindsResponse>('/admin/notifications/kinds'),
      put: (enabled: Record<string, boolean>) =>
        request<NotificationKindsResponse>('/admin/notifications/kinds', {
          method: 'PUT',
          body: JSON.stringify({ enabled }),
        }),
    },
    notifications: {
      list: (opts?: { user_id?: number; kind?: string; limit?: number }) => {
        const qs = new URLSearchParams()
        if (opts?.user_id) qs.set('user_id', String(opts.user_id))
        if (opts?.kind) qs.set('kind', opts.kind)
        if (opts?.limit) qs.set('limit', String(opts.limit))
        const suffix = qs.toString() ? `?${qs}` : ''
        return request<NotificationAdminPublic[]>(
          `/admin/notifications${suffix}`,
        )
      },
      broadcast: (data: NotificationBroadcastRequest) =>
        request<{ delivered: number }>('/admin/notifications/broadcast', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      cleanup: (older_than_days: number) =>
        request<{ deleted: number }>('/admin/notifications/cleanup', {
          method: 'POST',
          body: JSON.stringify({ older_than_days }),
        }),
    },
    externalLinks: {
      get: () => request<{ links: ExternalLink[] }>('/admin/external-links'),
      put: (links: ExternalLink[]) =>
        request<{ links: ExternalLink[] }>('/admin/external-links', {
          method: 'PUT',
          body: JSON.stringify({ links }),
        }),
    },
    cron: {
      list: () => request<CronJobMeta[]>('/admin/cron'),
      runs: (name: string, limit: number = 50) =>
        request<CronRunPublic[]>(
          `/admin/cron/${encodeURIComponent(name)}/runs?limit=${limit}`,
        ),
      pause: (name: string, paused: boolean) =>
        request<{ name: string; paused: boolean }>(
          `/admin/cron/${encodeURIComponent(name)}/pause`,
          { method: 'PUT', body: JSON.stringify({ paused }) },
        ),
      runNow: (name: string) =>
        request<{ name: string; status: string }>(
          `/admin/cron/${encodeURIComponent(name)}/run`,
          { method: 'POST' },
        ),
    },
    integrations: {
      get: () => request<IntegrationsResponse>('/admin/integrations'),
      put: (data: IntegrationsResponse) =>
        request<IntegrationsResponse>('/admin/integrations', {
          method: 'PUT',
          body: JSON.stringify(data),
        }),
    },
    gitlab: {
      get: () => request<GitLabConfigResponse>('/admin/gitlab'),
      put: (data: GitLabConfigUpdate) =>
        request<GitLabConfigResponse>('/admin/gitlab', {
          method: 'PUT',
          body: JSON.stringify(data),
        }),
    },
    llm: {
      get: () => request<LLMConfigResponse>('/admin/llm'),
      put: (data: LLMConfigUpdate) =>
        request<LLMConfigResponse>('/admin/llm', {
          method: 'PUT',
          body: JSON.stringify(data),
        }),
      test: () =>
        request<LLMTestResponse>('/admin/llm/test', { method: 'POST' }),
    },
    codebuddy: {
      healthcheck: () =>
        request<CodeBuddyHealthResponse>('/admin/codebuddy/healthcheck'),
      invalidateCache: () =>
        request<{ deleted: number }>('/admin/codebuddy/cache', {
          method: 'DELETE',
        }),
      developers: (limit: number = 200) =>
        request<{ items: CodeBuddyDeveloperListItem[] }>(
          `/admin/codebuddy/developers?limit=${limit}`,
        ),
      syncProjectsFull: () =>
        request<{ enqueued: number; team_size: number }>(
          '/admin/codebuddy/sync-projects-full',
          { method: 'POST' },
        ),
    },
  },

  rotations: {
    candidates: () => request<GlobalRotationCandidate[]>('/rotations/candidates'),
    locked: () => request<LockedMember[]>('/rotations/locked'),
    list: (opts?: {
      status?: RotationStatus
      employee_id?: number
      project_id?: number
    }) => {
      const qs = new URLSearchParams()
      if (opts?.status) qs.set('status', opts.status)
      if (opts?.employee_id) qs.set('employee_id', String(opts.employee_id))
      if (opts?.project_id) qs.set('project_id', String(opts.project_id))
      const suffix = qs.toString() ? `?${qs}` : ''
      return request<RotationListItem[]>(`/rotations${suffix}`)
    },
    get: (id: number) => request<RotationFull>(`/rotations/${id}`),
    approversPreview: (
      employeeId: number,
      fromProductId: number,
      toProductId: number,
    ) =>
      request<RotationApproverPreview[]>(
        `/rotations/approvers-preview?employee_id=${employeeId}` +
          `&from_product_id=${fromProductId}&to_product_id=${toProductId}`,
      ),
    propose: (data: RotationCreate) =>
      request<RotationFull>('/rotations', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    approve: (id: number, comment: string | null) =>
      request<RotationFull>(`/rotations/${id}/approvals`, {
        method: 'POST',
        body: JSON.stringify({ decision: 'approve', comment }),
      }),
    reject: (id: number, comment: string | null) =>
      request<RotationFull>(`/rotations/${id}/approvals`, {
        method: 'POST',
        body: JSON.stringify({ decision: 'reject', comment }),
      }),
    cancel: (id: number) =>
      request<RotationFull>(`/rotations/${id}/cancel`, { method: 'POST' }),
    complete: (id: number) =>
      request<RotationFull>(`/rotations/${id}/complete`, { method: 'POST' }),
    revert: (id: number) =>
      request<RotationFull>(`/rotations/${id}/revert`, { method: 'POST' }),
  },

  employeesSearch: (q: string, limit = 20) =>
    request<EmployeeSearchItem[]>(
      `/employees-search?q=${encodeURIComponent(q)}&limit=${limit}`,
    ),

  employeePublic: (id: number) =>
    request<PublicProfile>(`/employees/${id}/public-profile`),

  aiJobs: {
    get: (empId: number, jobId: number) =>
      request<AIJob>(`/employees/${empId}/ai-jobs/${jobId}`),
    cancel: (empId: number, jobId: number) =>
      request<AIJob>(`/employees/${empId}/ai-jobs/${jobId}/cancel`, {
        method: 'POST',
      }),
    list: (
      empId: number,
      opts?: {
        status?: string
        kind?: string
        target_kind?: string
        target_id?: number
        limit?: number
      },
    ) => {
      const qs = new URLSearchParams()
      if (opts?.status) qs.set('status', opts.status)
      if (opts?.kind) qs.set('kind', opts.kind)
      if (opts?.target_kind) qs.set('target_kind', opts.target_kind)
      if (opts?.target_id !== undefined)
        qs.set('target_id', String(opts.target_id))
      if (opts?.limit !== undefined) qs.set('limit', String(opts.limit))
      const suffix = qs.toString() ? `?${qs}` : ''
      return request<AIJob[]>(`/employees/${empId}/ai-jobs${suffix}`)
    },
  },

  mpk: {
    competencies: () => request<Competency[]>('/mpk/competencies'),
    levels: () => request<Level[]>('/mpk/levels'),
    roles: () => request<Role[]>('/mpk/roles'),
    grades: () => request<Grade[]>('/mpk/grades'),
    roleProfile: (roleId: number) =>
      request<RoleProfileDetail>(`/mpk/roles/${roleId}/profile`),
    patchCell: (
      roleId: number,
      payload: { competency_id: number; grade_id: number; required_level: number },
    ) =>
      request<void>(`/mpk/roles/${roleId}/profile-cell`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    patchKey: (roleId: number, competency_id: number, is_key: boolean) =>
      request<void>(`/mpk/roles/${roleId}/key-competency`, {
        method: 'PATCH',
        body: JSON.stringify({ competency_id, is_key }),
      }),
  },

  assignments: {
    list: (
      scope: AssignmentScope = 'assigned',
      statusFilter?: AssignmentStatus,
    ) => {
      const qs = new URLSearchParams({ scope })
      if (statusFilter) qs.set('status', statusFilter)
      return request<AssignmentListItem[]>(`/assignments?${qs}`)
    },
    get: (id: number) => request<Assignment>(`/assignments/${id}`),
    create: (data: AssignmentCreatePayload) =>
      request<Assignment>('/assignments', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: number, data: AssignmentUpdatePayload) =>
      request<Assignment>(`/assignments/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    delete: (id: number) =>
      request<void>(`/assignments/${id}`, { method: 'DELETE' }),
    uploadAttachment: async (id: number, file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      const t = getToken()
      const res = await fetch(`/api/assignments/${id}/attachment`, {
        method: 'POST',
        headers: t ? { Authorization: `Bearer ${t}` } : {},
        body: fd,
      })
      if (res.status === 401) {
        clearToken()
        location.assign('/login')
        throw new Error('unauthorized')
      }
      if (!res.ok) {
        const txt = await res.text()
        throw new Error(txt || 'Не удалось загрузить файл')
      }
      return res.json() as Promise<Assignment>
    },
    deleteAttachment: (id: number) =>
      request<Assignment>(`/assignments/${id}/attachment`, {
        method: 'DELETE',
      }),
    downloadAttachment: async (id: number, filename: string) => {
      const t = getToken()
      const res = await fetch(`/api/assignments/${id}/attachment`, {
        headers: t ? { Authorization: `Bearer ${t}` } : {},
      })
      if (!res.ok) throw new Error('Не удалось скачать вложение')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename || 'attachment'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    },
  },

  notifications: {
    list: (opts?: { unread_only?: boolean; limit?: number }) => {
      const qs = new URLSearchParams()
      if (opts?.unread_only) qs.set('unread_only', 'true')
      if (opts?.limit !== undefined) qs.set('limit', String(opts.limit))
      const suffix = qs.toString() ? `?${qs}` : ''
      return request<NotificationItem[]>(`/notifications${suffix}`)
    },
    unreadCount: () => request<UnreadCount>('/notifications/unread-count'),
    markRead: (id: number) =>
      request<NotificationItem>(`/notifications/${id}/read`, {
        method: 'POST',
      }),
    markAllRead: () =>
      request<UnreadCount>('/notifications/mark-all-read', { method: 'POST' }),
    remove: (id: number) =>
      request<void>(`/notifications/${id}`, { method: 'DELETE' }),
  },
}

export interface RoleProfileCompetency {
  competency_id: number
  competency_name: string
  sort_order: number
  is_key: boolean
  levels: Record<number, number>
}

export interface RoleProfileDetail {
  role: Role
  grades: Grade[]
  competencies: RoleProfileCompetency[]
}

export interface TeamGradeBucket {
  grade_code: string
  sort_order: number
  count: number
}

export interface TeamRoleBucket {
  role_id: number
  role_name: string
  count: number
}

export interface TeamRecentEvent {
  employee_id: number
  full_name: string
  role_name: string | null
  grade_code: string | null
  at: string
}

export interface TeamMetrics {
  total_active: number
  total_all_time: number
  interns: number
  without_role: number
  without_grade: number
  without_hire_date: number
  avg_tenure_months: number | null
  hired_year: number
  hired_count_year: number
  left_count_year: number
  net_change_year: number
  grades: TeamGradeBucket[]
  roles: TeamRoleBucket[]
  recent_hires: TeamRecentEvent[]
  recent_leaves: TeamRecentEvent[]
}

export interface DashboardEmployeeRef {
  id: number
  full_name: string
  last_assessed_at: string | null
  role_name: string | null
  grade_code: string | null
}

export interface DashboardGapCompetency {
  competency_id: number
  competency_name: string
  affected_count: number
  avg_gap: number
  total_with_role: number
}

export type ProjectStatus = 'active' | 'on_hold' | 'completed'

export interface ProjectListItem {
  id: number
  code: string | null
  name: string
  status: ProjectStatus
  started_at: string | null
  finished_at: string | null
  members_count: number
  competencies_count: number
  created_by: number
  gitlab_group: string | null
  gitlab_project_id: number | null
}

// ---------- Products (логическая единица из 1+ репо) ----------

export type ProductStatus = ProjectStatus

export interface ProductListItem {
  id: number
  name: string
  status: ProductStatus
  started_at: string | null
  finished_at: string | null
  gitlab_group: string | null
  created_by: number
  members_count: number
  competencies_count: number
  repos_count: number
}

export interface ProductRepoRef {
  id: number
  name: string
  gitlab_project_id: number | null
  gitlab_group: string | null
}

export interface ProductMember {
  id: number
  employee_id: number
  full_name: string
  role_name: string | null
  grade_code: string | null
  owner_id: number
  owner_name: string | null
  role_in_project: string | null
  joined_at: string | null
  left_at: string | null
  rotation_locked: boolean
  rotation_lock_note: string | null
  is_yours: boolean
}

export interface ProductStackItem {
  competency_id: number
  competency_name: string
  target_level: number
}

export interface Product {
  id: number
  name: string
  description: string | null
  status: ProductStatus
  started_at: string | null
  finished_at: string | null
  gitlab_group: string | null
  created_by: number
  created_at: string
  members: ProductMember[]
  competencies: ProductStackItem[]
  repos: ProductRepoRef[]
}

export interface ProductCreate {
  name: string
  description?: string | null
  status?: ProductStatus
  started_at?: string | null
  finished_at?: string | null
  gitlab_group?: string | null
}

export interface ProductUpdate {
  name?: string
  description?: string | null
  status?: ProductStatus
  started_at?: string | null
  finished_at?: string | null
  gitlab_group?: string | null
}

export interface ProjectMember {
  id: number
  employee_id: number
  full_name: string
  role_name: string | null
  grade_code: string | null
  owner_id: number
  owner_name: string | null
  role_in_project: string | null
  joined_at: string | null
  left_at: string | null
  rotation_locked: boolean
  rotation_lock_note: string | null
  is_yours: boolean
}

// Rotations
export type RotationStatus =
  | 'proposed'
  | 'accepted'
  | 'completed'
  | 'cancelled'
  | 'reverted'

export interface ReplacementCandidate {
  employee_id: number
  full_name: string
  role_name: string | null
  grade_code: string | null
  owner_id: number
  current_project_id: number | null
  current_project_name: string | null
  tenure_months: number
  overlap_competencies: { competency_id: number; competency_name: string }[]
  fit_score: number
  readiness_score: number
  total_score: number
  status: 'ready' | 'approachable' | 'early' | 'free'
  blocker: 'locked' | 'pending' | null
}

export interface RotationCandidate {
  employee_id: number
  member_id: number
  full_name: string
  role_id: number | null
  role_name: string | null
  grade_id: number | null
  grade_code: string | null
  owner_id: number
  owner_name: string | null
  joined_at: string | null
  tenure_months: number
  rotation_locked: boolean
  rotation_lock_note: string | null
  pending_rotation_id: number | null
  tenure_score: number
  bus_factor_score: number
  score: number
  bus_factor_competencies: { competency_id: number; competency_name: string }[]
  rationale_md: string | null
  target_projects: { project_id: number; project_name: string; code: string | null }[]
  suggestion_generated_at: string | null
  suggestion_running: boolean
  replacement_needed: boolean
  replacement_project_name: string
  replacement_role_keys_in_stack: { competency_id: number; competency_name: string }[]
}

export interface ReplacementsResponse {
  needed: boolean
  viable: ReplacementCandidate[]
  blocked: ReplacementCandidate[]
  empty_reason: string | null
}

export interface GlobalRotationCandidate extends RotationCandidate {
  from_project_id: number
  from_project_code: string | null
  from_project_name: string
}

// Self-Review
export type SelfReviewStatus = 'draft' | 'submitted' | 'closed'
export type SelfReviewAiKind =
  | 'topics'
  | 'compare'
  | 'burnout'
  | 'calibration'
  | 'draft'

export interface SelfReviewListItem {
  id: number
  employee_id: number
  employee_name: string | null
  owner_id: number | null
  owner_name: string | null
  year: number
  status: SelfReviewStatus
  has_source: boolean
  project_score: number | null
  company_score: number | null
  submitted_at: string | null
  closed_at: string | null
  scheduled_1on1_at: string | null
  created_at: string
}

export interface SelfReview {
  id: number
  employee_id: number
  employee_name: string
  year: number
  status: SelfReviewStatus
  has_source: boolean
  source_filename: string | null
  source_size_bytes: number | null
  source_uploaded_at: string | null
  project_score: number | null
  company_score: number | null
  manager_notes_md: string | null
  ai_topics_md: string | null
  ai_comparison_md: string | null
  ai_burnout_md: string | null
  ai_calibration_md: string | null
  ai_drafting_md: string | null
  submitted_at: string | null
  closed_at: string | null
  scheduled_1on1_at: string | null
  created_by: number
  created_at: string
}

export interface SelfReviewCreate {
  year: number
  project_score?: number | null
  company_score?: number | null
  manager_notes_md?: string | null
}

export interface SelfReviewUpdate {
  project_score?: number | null
  company_score?: number | null
  manager_notes_md?: string | null
  status?: SelfReviewStatus
  scheduled_1on1_at?: string | null
}

// Departments + Tech Maturity для отдела
export type DeptMaturityStatus = 'draft' | 'done'

export interface Department {
  id: number
  name: string
  description: string | null
  owner_id: number
  owner_name: string | null
  is_owner: boolean
  created_at: string
}

export interface DepartmentCreate {
  name: string
  description?: string | null
}

export interface DepartmentUpdate {
  name?: string
  description?: string | null
}

export interface DeptMaturityProcess {
  code: string
  name: string
}

export interface DeptMaturityDirection {
  code: string
  name: string
  processes: DeptMaturityProcess[]
}

export interface DeptMaturityCriterion {
  level: number
  idx: number
  what: string
  how: string | null
}

export interface DeptMaturityTemplate {
  version: string
  period_default: string
  directions: DeptMaturityDirection[]
  level_names: string[]
  criteria: DeptMaturityCriterion[]
}

export type DeptMaturityCellValue = 'yes' | 'no' | 'na'

export interface DeptDirectionMarks {
  name: string
  level_marks: Record<string, number | null>
  level: number
  rating: number
  processes: string[]
}

export interface DeptMaturityMarks {
  by_direction: Record<string, DeptDirectionMarks>
  total_rating: number
  overall_level: number
}

export interface DeptMaturitySurvey {
  id: number
  department_id: number
  period: string
  status: DeptMaturityStatus
  template_version: string
  info: Record<string, string>
  // ключ "{processCode}-{level}-{critIdx}" → "yes" | "no" | "na"
  answers: Record<string, DeptMaturityCellValue>
  completed_at: string | null
  created_by: number
  created_by_name: string | null
  created_at: string
  marks: DeptMaturityMarks
}

export interface DeptMaturitySurveyListItem {
  id: number
  department_id: number
  period: string
  status: DeptMaturityStatus
  completed_at: string | null
  created_at: string
  created_by: number
  created_by_name: string | null
  overall_level: number
  total_rating: number
  rating_by_direction: Record<string, number>
}

export interface DeptMaturityOverviewItem {
  department_id: number
  department_name: string
  owner_name: string | null
  period: string
  overall_level: number
  total_rating: number
  rating_by_direction: Record<string, number>
}

// Tech Maturity
export type TechMaturityStatus = 'draft' | 'done'

export interface TechMaturityTemplate {
  version: string
  period_default: string
  process: Record<
    string,
    { title: string; dKey: string; key: string }
  >
  direction: Record<string, string>
  levels: string[]
  data: {
    paramCode: string
    paramName: string
    criteria: string
    directionCode: string
    direction: string
    processCode: string
    processName: string
    level: string
  }[]
}

export interface TechMaturityDirectionMarks {
  name: string
  level_marks: Record<string, number | null>
  level: number
  rating: number
}

export interface TechMaturityMarks {
  by_direction: Record<string, TechMaturityDirectionMarks>
  total_rating: number
  overall_level: number
}

export interface TechMaturitySurvey {
  id: number
  project_id: number
  period: string
  status: TechMaturityStatus
  template_version: string
  info: Record<string, string>
  answers: Record<string, string | number | boolean>
  completed_at: string | null
  created_by: number
  created_by_name: string | null
  created_at: string
  marks: TechMaturityMarks
}

export interface TechMaturitySurveyListItem {
  id: number
  project_id: number
  period: string
  status: TechMaturityStatus
  completed_at: string | null
  created_at: string
  created_by: number
  created_by_name: string | null
  overall_level: number
  total_rating: number
  rating_by_direction: Record<string, number>
}

export interface UpcomingMeeting {
  kind: 'mpk' | 'hiring' | 'self_review'
  when: string
  employee_id: number
  employee_name: string
  employee_kind: 'employee' | 'candidate'
  title: string
  meeting_id: number | null
  self_review_id: number | null
}

// Candidates / Hiring
export type CandidateStage =
  | 'new'
  | 'screening'
  | 'interview'
  | 'offer'
  | 'hired'
  | 'rejected'
export type FeedbackDecision = 'positive' | 'negative'
export type CandidateAiKind = 'screening'

export type VacancyStatus = 'open' | 'closed'

export interface VacancyListItem {
  id: number
  title: string
  project_id: number | null
  project_name: string | null
  department_id: number | null
  department_name: string | null
  role_name: string | null
  grade_code: string | null
  status: VacancyStatus
  created_at: string
  candidates_count: number
}

export interface Vacancy {
  id: number
  title: string
  project_id: number | null
  project_name: string | null
  department_id: number | null
  department_name: string | null
  role_id: number | null
  role_name: string | null
  grade_id: number | null
  grade_code: string | null
  requirements_md: string | null
  status: VacancyStatus
  created_by_id: number
  created_by_name: string | null
  created_at: string
  updated_at: string
  closed_at: string | null
  candidates_count: number
}

export interface VacancyCreate {
  title: string
  project_id?: number | null
  department_id?: number | null
  role_id?: number | null
  grade_id?: number | null
  requirements_md?: string | null
}

export interface VacancyUpdate {
  title?: string
  project_id?: number | null
  department_id?: number | null
  role_id?: number | null
  grade_id?: number | null
  requirements_md?: string | null
  status?: VacancyStatus
}

export interface VacancyRef {
  id: number
  title: string
  status: VacancyStatus
  project_id: number | null
  project_name: string | null
}

export interface CandidateListItem {
  id: number
  full_name: string
  email: string | null
  position: string | null
  stage: CandidateStage
  source: string | null
  vacancy_id: number | null
  vacancy_title: string | null
  expected_role_name: string | null
  expected_grade_code: string | null
  has_resume: boolean
  ai_screening_recommended: boolean | null
  feedback_decision: FeedbackDecision | null
  created_at: string
}

export interface Candidate {
  id: number
  employee_id: number
  full_name: string
  email: string | null
  position: string | null
  owner_id: number
  stage: CandidateStage
  source: string | null
  vacancy: VacancyRef | null
  expected_role: Role | null
  expected_grade: Grade | null
  has_resume: boolean
  resume_filename: string | null
  resume_size_bytes: number | null
  resume_uploaded_at: string | null
  ai_screening_recommended: boolean | null
  ai_screening_reasoning_md: string | null
  ai_screening_at: string | null
  feedback_decision: FeedbackDecision | null
  rejection_reason_md: string | null
  hired_at: string | null
  created_at: string
}

export interface CandidateCreate {
  full_name: string
  email?: string | null
  position?: string | null
  source?: string | null
  vacancy_id?: number | null
  expected_role_id?: number | null
  expected_grade_id?: number | null
}

export interface CandidateUpdate {
  full_name?: string
  email?: string | null
  position?: string | null
  stage?: CandidateStage
  source?: string | null
  vacancy_id?: number | null
  expected_role_id?: number | null
  expected_grade_id?: number | null
}

export interface LockedMember {
  employee_id: number
  member_id: number
  full_name: string
  role_name: string | null
  grade_code: string | null
  owner_id: number
  owner_name: string | null
  project_id: number
  project_name: string
  project_code: string | null
  joined_at: string | null
  tenure_months: number
  rotation_lock_note: string | null
}

export interface RotationsPanel {
  candidates: RotationCandidate[]
  no_candidates: boolean
}

export interface RotationApprovalPublic {
  user_id: number
  user_name: string | null
  decision: 'approve' | 'reject' | null
  decided_at: string | null
  comment: string | null
}

export interface RotationFull {
  id: number
  employee_id: number
  employee_name: string
  from_project_id: number
  from_project_name: string
  from_project_code: string | null
  to_project_id: number | null
  to_project_name: string | null
  to_project_code: string | null
  status: RotationStatus
  reason_md: string | null
  initiated_by_id: number
  initiated_by_name: string | null
  proposed_at: string
  planned_start_at: string | null
  accepted_at: string | null
  completed_at: string | null
  cancelled_at: string | null
  reverted_at: string | null
  reverted_by_id: number | null
  replacement_employee_id: number | null
  replacement_full_name: string | null
  approvals: RotationApprovalPublic[]
}

export interface RotationListItem {
  id: number
  employee_id: number
  employee_name: string
  from_project_id: number | null
  from_project_name: string | null
  to_project_id: number | null
  to_project_name: string | null
  from_product_id: number | null
  from_product_name: string | null
  to_product_id: number | null
  to_product_name: string | null
  status: RotationStatus
  proposed_at: string
  completed_at: string | null
}

export interface RotationApproverPreview {
  user_id: number
  full_name: string | null
  reasons: string[]
  is_initiator: boolean
}

export interface RotationCreate {
  employee_id: number
  // Новый формат: указываем продукты (рекомендуется).
  from_product_id?: number | null
  to_product_id?: number | null
  // Старый (deprecated) — для отдельной страницы Rotations.
  from_project_id?: number | null
  to_project_id?: number | null
  reason_md?: string | null
  planned_start_at?: string | null
  extra_approver_ids?: number[]
  replacement_employee_id?: number | null
}

export interface ProjectStackItem {
  competency_id: number
  competency_name: string
  target_level: number
}

export interface Project {
  id: number
  code: string | null
  name: string
  description: string | null
  status: ProjectStatus
  started_at: string | null
  finished_at: string | null
  created_by: number
  created_at: string
  members: ProjectMember[]
  competencies: ProjectStackItem[]
  gitlab_group: string | null
  gitlab_project_id: number | null
  product_id: number | null
}

export interface ProjectCreate {
  code?: string | null
  name: string
  description?: string | null
  status?: ProjectStatus
  started_at?: string | null
  finished_at?: string | null
}

export interface ProjectUpdate {
  code?: string | null
  name?: string
  description?: string | null
  status?: ProjectStatus
  started_at?: string | null
  finished_at?: string | null
  gitlab_group?: string | null
}

export interface MatrixCell {
  employee_id: number
  competency_id: number
  level: number | null
}

export interface MatrixCompetencyRef {
  competency_id: number
  competency_name: string
  target_level: number | null
}

export interface MatrixEmployeeRef {
  employee_id: number
  full_name: string
  role_name: string | null
  grade_code: string | null
}

export interface ProjectMatrix {
  employees: MatrixEmployeeRef[]
  competencies: MatrixCompetencyRef[]
  cells: MatrixCell[]
}

export interface CoverageItem {
  competency_id: number
  competency_name: string
  target_level: number
  members_total: number
  members_assessed: number
  members_meeting: number
  members_below: number
  avg_level: number | null
}

export interface ProjectCoverage {
  items: CoverageItem[]
  risk_score: number
}

export interface ProjectGradeDistribution {
  items: { grade_code: string; sort_order: number; count: number }[]
  no_grade: number
}

export interface EmployeeSearchItem {
  id: number
  full_name: string
  role_name: string | null
  grade_code: string | null
  owner_id: number
  owner_name: string | null
  is_yours: boolean
}

export interface PublicProfile {
  id: number
  full_name: string
  position: string | null
  role: Role | null
  grade: Grade | null
  owner_id: number
  owner_name: string | null
  is_owner: boolean
  items: ProfileItem[]
  last_assessment_at: string | null
}

export interface DashboardRotationCandidate {
  employee_id: number
  full_name: string
  role_name: string | null
  grade_code: string | null
  from_project_id: number
  from_project_name: string
  tenure_months: number
  score: number
  bus_factor_score: number
}

export interface DashboardMetrics {
  employees_total: number
  assessed_last_12m: number
  not_assessed_last_12m: number
  not_assessed_employees: DashboardEmployeeRef[]
  procedures_planned: number
  procedures_open: number
  procedures_closed_last_12m: number
  employees_with_role_grade: number
  avg_gap_score: number | null
  top_gap_competencies: DashboardGapCompetency[]
  assessments_last_30d: number
  meetings_done_last_30d: number
  ai_jobs_done_last_30d: number
  rotations_completed_last_30d: number
  rotations_completed_last_12m: number
  rotations_in_progress: number
  rotation_candidates_count: number
  rotation_top_candidates: DashboardRotationCandidate[]
  bus_factor_alerts: number
  locked_members_count: number
  self_review_year: number
  self_review_total: number
  self_review_drafts: number
  self_review_submitted: number
  self_review_closed: number
  self_review_pending: number
  self_review_avg_project: number | null
  self_review_avg_company: number | null
  self_review_days_to_year_end: number
  self_review_stuck_submitted: number
  self_review_stale_drafts: number
  // Найм
  vacancies_open: number
  vacancies_closed: number
  candidates_total: number
  candidates_in_pipeline: number
  candidates_added_last_30d: number
  candidates_hired_year: number
  candidates_rejected_year: number
  candidates_by_stage: HiringStageBucket[]
  top_vacancies: HiringTopVacancy[]
}

export interface HiringStageBucket {
  stage: string
  count: number
}

export interface HiringTopVacancy {
  id: number
  title: string
  status: VacancyStatus
  project_name: string | null
  department_name: string | null
  candidates_count: number
}

export interface StaleMrAlert {
  employee_id: number
  full_name: string
  stale_count: number
  oldest_age_days: number
  sample_title: string | null
  sample_url: string | null
}

export interface TeamCompetencyAggregate {
  competency_id: number
  competency_name: string
  total_signal_count: number
  employees_with: number
}

export interface DevActivitySummary {
  enabled: boolean
  period_from: string | null
  period_to: string | null
  team_size: number
  with_metrics: number
  total_mrs: number
  avg_quality_ratio: number | null
  stale_total: number
  wip_total: number
  stale_alerts: StaleMrAlert[]
  top_competencies: TeamCompetencyAggregate[]
  leaderboard: DevLeaderboardEmployee[]
}

export interface DevLeaderboardEmployee {
  employee_id: number
  full_name: string
  total_mrs: number
  avg_quality_ratio: number
  comments_given: number
  avg_time_to_merge_hours: number | null
  tests_ratio: number
  stale_count: number
}

// ---------- Assignments ----------

export type AssignmentStatus =
  | 'open'
  | 'in_progress'
  | 'pending_review'
  | 'done'
  | 'cancelled'
export type AssignmentScope = 'assigned' | 'created' | 'all'

export interface AssigneeRef {
  kind: 'user' | 'employee'
  id: number
  full_name: string
}

export interface Assignment {
  id: number
  title: string
  description_md: string | null
  due_at: string | null
  status: AssignmentStatus
  completed_at: string | null
  created_by_id: number
  created_by_name: string | null
  assignee: AssigneeRef
  has_attachment: boolean
  attachment_filename: string | null
  attachment_size_bytes: number | null
  attachment_uploaded_at: string | null
  created_at: string
  updated_at: string
}

export interface AssignmentListItem {
  id: number
  title: string
  due_at: string | null
  status: AssignmentStatus
  created_by_id: number
  created_by_name: string | null
  assignee: AssigneeRef
  has_attachment: boolean
  completed_at: string | null
  created_at: string
}

export interface AssignmentCreatePayload {
  title: string
  description_md?: string | null
  due_at?: string | null
  assignee_user_id?: number | null
  assignee_employee_id?: number | null
}

export interface AssignmentUpdatePayload {
  title?: string
  description_md?: string | null
  due_at?: string | null
  status?: AssignmentStatus
}

// ---------- Notifications ----------

export type NotificationKind =
  | 'assignment_created'
  | 'assignment_pending_review'
  | 'assignment_done'
  | 'assignment_returned'
  | 'assignment_cancelled'
  | string

export interface NotificationItem {
  id: number
  kind: NotificationKind
  title: string
  body: string | null
  link: string | null
  payload: Record<string, unknown>
  is_read: boolean
  read_at: string | null
  created_at: string
}

export interface UnreadCount {
  unread: number
}
