import type { ArticleVersion,Issue,RankingContext,ApiCompatibilityPolicy,PublicationState } from '../src/index.js';
type Assert<T extends true>=T;
export type NoSnapshotFieldsInArticle=Assert<Extract<keyof ArticleVersion,'as_of'|'cutoff'|'snapshot_context_id'> extends never?true:false>;
export type VersionBelongsToIssue=Assert<'issueId' extends keyof ArticleVersion?true:false>;
export type IssueIdentityAndPublication=Assert<Exclude<'storyId'|'first_published_at'|'material_change_at'|'scheduled_publish_at'|'publication_state',keyof Issue> extends never?true:false>;
export type SnapshotIdentity=Assert<Exclude<'market_basis'|'target_D'|'candidate_window_start'|'cutoff'|'effective_sort'|'rank_epoch'|'snapshot_context_id',keyof RankingContext> extends never?true:false>;
// This is a policy draft fixture, not an enforced backend rule or store release.
export const apiPolicyDraft:ApiCompatibilityPolicy={policy_version:'api-compatibility-draft-1',api_contract_version:1,min_supported_app_version:{android:'0.1.0',ios:'0.1.0'}};
// Scheduling is a DRAFT field; it must not silently become a sixth public state.
// @ts-expect-error SCHEDULED is not a publication state in the common contract.
const invalidPublicationState:PublicationState='SCHEDULED';
void invalidPublicationState;
