export type Environment = 'local' | 'preview' | 'production';
export type SelectionMarketBasis = 'KR' | 'FOREIGN_US';
export type AnalysisPerspective = 'KR_EQUITY';
export type ImpactDirection = 'BENEFIT' | 'DAMAGE' | 'RELATED';
export interface Company { id:string; name:string; stockCode:string; market:'KRX'; description:string; }
export interface Sector { id:string; name:string; description:string; parentId:string|null; order:number; }
export interface SectorImpact {sectorId:string; direction:ImpactDirection; pathId:string; conditions:string[]; companyIds:string[]; evidenceIds:string[];}
export type DetailSection = 'KEY_ISSUES' | 'ISSUE_ANALYSIS' | 'SCENARIOS' | 'BENEFIT_SECTORS' | 'DAMAGE_SECTORS' | 'RELATED_SECTORS' | 'RISKS' | 'SCHEDULE' | 'SOURCES';
export type ImpactProfile = 'POSITIVE_ONLY' | 'POSITIVE_NEGATIVE' | 'DAMAGE_ONLY' | 'RELATED_CONDITIONAL';
export interface Story {id:string; canonicalEventKey:string;}
export type PublicationState = 'DRAFT' | 'PUBLISHED' | 'CORRECTION_PENDING' | 'WITHDRAWN' | 'HIDDEN';
export interface Issue {id:string; storyId:string; publication_state:PublicationState; scheduled_publish_at:string|null; first_published_at:string|null; material_change_at:string|null; currentVersionId:string|null;}
export interface ArticleVersion {id:string; issueId:string; title:string; summary:string; source_market:string; selection_market_basis:SelectionMarketBasis; analysis_perspective:AnalysisPerspective; evidence_as_of:string; impact_profile:ImpactProfile; visibility_policy_version:string; impacts:SectorImpact[]; visible_sections:DetailSection[]; sourceIds:string[];}
export interface Article {issue:Issue; version:ArticleVersion;}
export type EffectiveSort = 'MIXED' | 'RETURN_DESC' | 'VIEWS_DESC';
export interface RankingContext {snapshot_context_id:string; market_basis:SelectionMarketBasis; target_D:string; candidate_window_start:string; cutoff:string; effective_sort:EffectiveSort; rank_epoch:string; ranking_policy_version:string; catalog_version:string; benchmark_version:string; price_session_id:string;}
export interface RankingSnapshot {id:string; context:RankingContext; as_of:string; issueIds:string[];}
export interface ApiCompatibilityPolicy {policy_version:string; api_contract_version:number; min_supported_app_version:{android:string;ios:string};}
export interface ApiCompatibilityResponse {policy:ApiCompatibilityPolicy; platform:'android'|'ios'; client_app_version:string; action:'NONE'|'UPDATE_REQUIRED'; store_url:string|null;}
export interface PriceSnapshot {companyId:string; price:number|null; percentChange:number|null; as_of:string; quality:'VERIFIED'|'MISSING'|'STALE'|'UNAVAILABLE';}
export type SourceStatus = 'CANDIDATE' | 'RIGHTS_HOLD' | 'TECH_TEST' | 'SHADOW' | 'ACTIVE' | 'PAUSED_RATE_LIMIT' | 'PAUSED_ACCESS' | 'PAUSED_ERROR' | 'DISABLED';
export interface NewsSource {id:string; canonicalUrl:string; originId:string; status:SourceStatus; permissionProfileId:string; permissionProfileVersion:string;}
export interface JobEnvelope {id:string; job_schema_version:number; effect_key:string; environment:Environment; payload:unknown;}
export type SupplySampleKind = 'SYNTHETIC' | 'PERMITTED_REAL';
export interface PublicSector {id:string;name:string;description:string;}
export interface CatalogLeaf {id:string;name:string;parent_id:string;order:number;}
export interface CatalogParent {id:string;name:string;order:number;sectors:CatalogLeaf[];}
export interface PublicCatalog {catalog_version:string;metadata_kind:'USER_REFERENCE_UNVERIFIED';parents:CatalogParent[];}
export interface ReferenceCompany {membership_id:string;source_company_ref:string;name:string;description:string;stock_identity_state:'UNRESOLVED';stock_code:null;price:null;change_percent:null;stock_url:null;}
export type PublicReferenceSector={state:'NOT_FOUND';catalog_version:string}|{state:'AVAILABLE';catalog_version:string;id:string;name:string;description:string;parent_id:string;metadata_kind:'USER_REFERENCE_UNVERIFIED';groups:Array<{id:string;name:string;order:number;members:ReferenceCompany[]}>;ungrouped_members:ReferenceCompany[];offset:number;total_memberships:number;next_offset:number|null};
export type CalendarPeriod='TODAY'|'YESTERDAY'|'THIS_WEEK'|'LAST_WEEK'|'THIS_MONTH'|'LAST_MONTH';
export interface CatalogNewsPage {catalog_version:string;as_of:string;period:CalendarPeriod;range_start:string;range_end:string;items:Array<PublicNewsSummary&{sector_id:string|null;legacy_sector:boolean}>;next_cursor:string|null;}
export interface PublicNewsSummary {issue_id:string;version_id:string;title:string;summary:string;first_published_at:string;material_change_at:string;sample_kind:'SYNTHETIC';article_kind:'SECTOR'|'MACRO';sector_name:string|null;}
export interface SearchNewsPage {catalog_version:string;as_of:string;items:Array<PublicNewsSummary&{sector_id:string|null;legacy_sector:boolean}>;next_cursor:string|null;}
export interface CompanySectorLink {id:string;name:string;display_order:number;}
export interface SearchCompany {source_company_ref:string;name:string;search_description:string;metadata_kind:'USER_REFERENCE_UNVERIFIED';stock_identity_state:'UNRESOLVED';stock_code:null;price:null;change_percent:null;stock_url:null;related_sectors:CompanySectorLink[];has_more_sectors:boolean;}
export interface SearchCompanyPage {catalog_version:string;items:SearchCompany[];next_cursor:string|null;}
export interface CompanySectorPage {catalog_version:string;state:'AVAILABLE'|'NOT_FOUND';items:CompanySectorLink[];next_offset:number|null;}
export type SavedResolution={requested_issue_id:string;state:'PUBLISHED';canonical_issue_id:string;card:SearchNewsPage['items'][number]}|{requested_issue_id:string;state:'NOT_FOUND'|'HIDDEN'|'WITHDRAWN'|'CORRECTION_PENDING';canonical_issue_id?:string;message:string};
export interface SavedPage {catalog_version:string;items:SavedResolution[];}
export interface PublicImpact {sector_id:string;sector_name:string;path_id:string;direction:ImpactDirection;conditional_direction:'NONE'|'POSITIVE'|'NEGATIVE';description:string;conditions:string[];}
export interface PublicScenario {direction:'POSITIVE'|'NEGATIVE';title:string;expected_result:string;checks:string[];path_ids:string[];}
export interface PublicSchedule {kind:'EXACT'|'PERIOD';title:string;timezone:string;event_at?:string;period_label?:string;date_note?:string;}
export interface PublicArticleBody {key_issues:string[];issue_analysis:string;sources:Array<{name:string;url:string}>;visible_sections:DetailSection[];source_market:string;selection_market_basis:SelectionMarketBasis;analysis_perspective:'KR_EQUITY';impact_profile:ImpactProfile;article_kind:'SECTOR'|'MACRO';impacts:PublicImpact[];scenarios?:PublicScenario[];risks?:string[];schedule?:PublicSchedule[];}
export type PublicArticleDetail = {state:'PUBLISHED';issue_id:string;version_id:string;title:string;summary:string;body:PublicArticleBody;first_published_at:string;material_change_at:string;sample_kind:'SYNTHETIC'}|{state:'NOT_FOUND'|'HIDDEN'|'WITHDRAWN'|'CORRECTION_PENDING';message:string;canonical_issue_id?:string};
export type PermissionPurpose = 'DISCOVERY' | 'LINK_EXTRACTION' | 'QUERY_TERMS' | 'ORIGINAL_ACCESS' | 'STORAGE' | 'ANALYSIS' | 'DISPLAY' | 'MACHINE_ACCESS';
export interface ProviderPermission {id:string; version:string; endpoint_id:string; status:'UNVERIFIED'|'VERIFIED'|'DENIED'; purposes:Record<PermissionPurpose,'UNKNOWN'|'ALLOW'|'DENY'>; subject:string|null; evidence:string[]; verified_at:string|null; expires_at:string|null; revoked_at:string|null; allowed_hosts:string[]; methods:string[]; max_requests:number; max_bytes:number; timeout_ms:number; retention_days:number|null; contract_id:string|null; credential_status:string;}
export interface VerifiedQuote {instrumentId:string; venue:'KRX'|'NYSE'|'NASDAQ'; currency:'KRW'|'USD'; sessionId:string; priceType:'LAST'|'CLOSE'; adjustment:'RAW'|'SPLIT'|'TOTAL_RETURN'; price:number|null; referencePrice:number|null; asOf:string; receivedAt:string; sampleKind:SupplySampleKind; permissionVerified:boolean;}
export interface CalendarSupply {market:'KRX'|'NYSE'|'NASDAQ'; timezone:'Asia/Seoul'|'America/New_York'; coverageStart:string; coverageEnd:string; version:string; validUntil:string; evidenceId:string; sampleKind:SupplySampleKind; permissionVerified:boolean; days:Array<{date:string;closed:boolean;session:{tradingDayId:string;opensAt:string;closesAt:string}|null}>;}
