import type { PublicScenario,PublicSchedule,PublicArticleBody } from '@judoju/contracts';
export interface EditorImpact {sector_id:string;path_id:string;direction:'BENEFIT'|'DAMAGE'|'RELATED';conditional_direction:'NONE'|'POSITIVE'|'NEGATIVE';description:string;conditions:string[];evidence_ids:string[];}
export interface EditorSchedule extends PublicSchedule {status:'VERIFIED'|'CANCELLED'|'UNVERIFIED'|'SUPERSEDED';evidence_ids:string[];evidence_as_of:string;period_start?:string;period_end?:string;precision?:string;}
export interface EditorContent {title:string;summary:string;article_kind:'SECTOR'|'MACRO';primary_sector_id:string|null;source_market:string;selection_market_basis:'KR'|'FOREIGN_US';analysis_perspective:'KR_EQUITY';key_issues:string[];issue_analysis:string;sources:Array<{name:string;url:string}>;impacts:EditorImpact[];scenarios:PublicScenario[];risks:string[];schedule:EditorSchedule[];}
export interface Draft {issue_id:string;issue_revision:number;draft_revision:number;state:string;claim_id:string;policy_version:number;catalog_version:number;content:EditorContent;}
export interface Preview {title:string;summary:string;body:PublicArticleBody;sample_kind:'SYNTHETIC';}
