# MAIN_PARALLEL_NEXT first slice

The reviewed plan manifest is `12d49813d102cb4d3e11a32aeff427e8a14b514fd1f74e84f552bc8e6f276052`. Both plan reviewers returned READY. This is an implementation candidate, not a service completion or live activation record.

## Source transition

The independent repository retains commit `9310533a550eeb1d2f500e9576378b972ca7a4d1` and its 555 files as the historical authority. Ten paths may change and seven may be added. The P4 guard and preparation are retained byte for byte. The new guard verifies their historical Git bytes rather than running the old guard against a changed stage. Its baseline SHA is fixed in the guard. The guard and baseline are both pinned by the external review manifest, avoiding a circular self-hash.

The original verification commands and normal database acceptance remain required. The 201 collector bootstrap diagnostics and 66 HOME identity diagnostics use new owned resources, separate from the normal collector CORE/FINAL and HOME acceptance resources. Missing or malformed bootstrap fields must fail before any persistent schema effect. Partial DDL failure must roll back schemas, tables, store row, roles and default ACLs. HOME records native installation-check versus RPC failure codes and restores identities and memberships after each variant.

## AI processing

`analysis-run.ts` is an in-process synthetic orchestrator. It reads only through an owned durable collector handle. Title and lead come from the canonical `SYNTHETIC ` JSON envelope containing exactly title, lead and body. K1 receives the same source identity, body hash, grant-derived permission version and provenance. The body reference is a synthetic `fixture:/collector/<stableStoreId>/<bodyId>` identifier, not file or network authority.

Every fixture-model invocation is preceded and followed by a current owned-source read. Only the clock may change during response rebinding. Original and validation request digests are retained separately. Rights, body, source, provenance, policy, story or issue changes fail closed. Unknown model outcomes are terminal within this process and cannot trigger an automatic retry. Results are proposals without publication authority. Effect deduplication is process-local, bounded to 128 entries; it does not prove durable jobs or cross-worker atomicity. Model and routing callbacks are trusted synthetic fixtures, not isolated code.

## Admin

The pure activation-proof validator requires the fixed product, project and organization, the selected owner and expected hashes, exact editor/server RPC lists and flags, and an injected current time. It rejects expired, future or longer-than-24-hour proofs and hostile object shapes. Shared conditions are compared with the existing fixture loader using the same bytes. The default admin loader stays disabled. This does not create a real user, write a secret, grant a role, start a supervisor or connect an admin session.

## Deferred work and evidence limits

No live source, external AI, production DB write, Auth change, publication, M2 capability, remote worker or phone/store activation is included. The source inventory and licensing holds remain. Instruction-bound authors do not have OS credential/profile isolation. Existing remote generation 3 and Router holds remain unchanged. Linux/GitHub CI and 24-hour operation are not certified by local checks.

The original reviewer reports retain their findings separately. P4 implementation's open union of 20 P3 findings and both NEXT plan reports' carried findings remain open unless the implementation review explicitly closes them against new evidence. In particular the existing admin C2 hosted gateway, user-password handoff, secret/session retention and revocation, public H preview supervisor/expiry, catalog-source cleanup, collector body resume and grant/core/physical-commit limitations are not resolved by this slice. Future AI persistence must bind proposals to admin drafts, CAS and the publication gate before HOME receives published versions.

## Validation status

Implementation validation and independent implementation review are pending. Test output is held outside the product tree in the owned development-stage evidence directory. Plan approval must not be reported as implementation approval.
