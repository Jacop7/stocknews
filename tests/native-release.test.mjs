import test from 'node:test';
import assert from 'node:assert/strict';
import { comparisonCommits,verifyNativeHistory,introductionBase,allowedHostedPullRef } from '../scripts/native-release-policy.mjs';
import { assertBuildProfileAllowed } from '../scripts/build-profile-policy.mjs';
const old='1'.repeat(40),head='2'.repeat(40);
const previous={digest:'old',runtimeVersions:{android:'android-native-0004',ios:'ios-native-0004'}};
const changed={...previous,digest:'changed',introducedAfterCommit:introductionBase};
const hosted={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'Jacop7/stocknews',GITHUB_SHA:head};
test('main push compares event before even when local main points to HEAD',()=>{
  const commits=comparisonCommits({env:{...hosted,GITHUB_EVENT_NAME:'push',JUDOJU_NATIVE_BASE_SHA:old},branch:'main',resolve:ref=>ref==='HEAD'?head:ref});
  assert.deepEqual(commits,[head,old]);
  assert.throws(()=>verifyNativeHistory(changed,commits,ref=>ref===head?changed:previous),/without new android/);
});
test('PR detached checkout compares explicit base without any local main',()=>{
  const commits=comparisonCommits({env:{...hosted,GITHUB_EVENT_NAME:'pull_request',JUDOJU_NATIVE_BASE_SHA:old},branch:'',resolve:ref=>{assert.notEqual(ref,'main');return ref==='HEAD'?head:ref;}});
  assert.throws(()=>verifyNativeHistory(changed,commits,ref=>ref===head?changed:previous),/without new android/);
});
test('initial introduction is restricted to the verified stage1 commit',()=>{
  verifyNativeHistory(changed,[introductionBase],()=>null);
  assert.throws(()=>verifyNativeHistory(changed,[old],()=>null),/outside verified first introduction/);
});
test('unknown CI event baseline cannot become a bootstrap exemption',()=>{
  assert.throws(()=>comparisonCommits({env:{...hosted,GITHUB_EVENT_NAME:'pull_request'},branch:'',resolve:()=>head}),/baseline SHA/);
  assert.throws(()=>comparisonCommits({env:{},branch:'feature',resolve:ref=>ref==='HEAD'?head:null}),/Unresolvable/);
});
test('fresh feature clone uses verified origin/main when local main is absent',()=>{
  const commits=comparisonCommits({env:{},branch:'feature',resolve:ref=>ref==='refs/heads/main'?null:ref==='HEAD'?head:ref==='refs/remotes/origin/main'?old:ref});
  assert.deepEqual(commits,[head,old]);
  assert.throws(()=>verifyNativeHistory(changed,commits,ref=>ref===head?changed:previous),/without new/);
});
test('first remote push uses HEAD parent and still checks history',()=>{
  const commits=comparisonCommits({env:{...hosted,GITHUB_EVENT_NAME:'push',JUDOJU_NATIVE_BASE_SHA:'0'.repeat(40)},branch:'main',resolve:ref=>ref==='HEAD'?head:old});
  assert.deepEqual(commits,[head,old]);assert.throws(()=>verifyNativeHistory(changed,commits,()=>previous),/without new/);
});
test('uncommitted main input change is compared with HEAD',()=>{
  const commits=comparisonCommits({env:{},branch:'main',resolve:ref=>ref==='HEAD'?head:old});
  assert.throws(()=>verifyNativeHistory(changed,commits,()=>previous),/without new/);
});
test('changing both native runtime IDs satisfies a changed digest',()=>verifyNativeHistory({...changed,runtimeVersions:{android:'android-native-0005',ios:'ios-native-0005'}},[old],()=>previous));
test('hosted PR permits only exact event merge ref at exact checked-out SHA',()=>{
  const env={...hosted,GITHUB_EVENT_NAME:'pull_request',GITHUB_REF:'refs/pull/17/merge'};
  assert.equal(allowedHostedPullRef(env,head,()=>head),'refs/remotes/pull/17/merge');
  assert.equal(allowedHostedPullRef(env,head,()=>old),null);
  assert.equal(allowedHostedPullRef({...env,GITHUB_EVENT_NAME:'push'},head,()=>head),null);
  assert.equal(allowedHostedPullRef(env,old,()=>head),null);
  assert.equal(allowedHostedPullRef({...env,GITHUB_REPOSITORY:'other/repo'},head,()=>head),null);
});
const testAds={plugins:[['react-native-google-mobile-ads',{androidAppId:'ca-app-pub-3940256099942544~3347511713',iosAppId:'ca-app-pub-3940256099942544~1458002511'}]]};
test('production and default build reject sample ads before CLI/account access',()=>{
  for(const args of [['build'],['build','--profile','production'],['build','--profile=production'],['build','-e','production']])assert.throws(()=>assertBuildProfileAllowed(args,testAds),/Production build blocked/);
});
test('explicit development and preview may compile with official test IDs',()=>{
  for(const profile of ['development','preview'])assert.doesNotThrow(()=>assertBuildProfileAllowed(['build','--profile',profile],testAds));
});
test('ambiguous/missing/unknown profiles cannot select a different CLI interpretation',()=>{
  for(const args of [['build','--profile'],['build','--profile','development','--profile','production'],['build','--profile','unknown']])assert.throws(()=>assertBuildProfileAllowed(args,testAds));
});
