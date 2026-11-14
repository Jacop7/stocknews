import assert from 'node:assert/strict';

export const introductionBase='fa928e987a792cb99536b7e0fc4461e7575ba8d6';
const sha=/^[a-f0-9]{40}$/;
export function comparisonCommits({env,branch,resolve}) {
  const refs=['HEAD']; // Also protects an uncommitted change on main.
  if(env.GITHUB_ACTIONS==='true') {
    assert.equal(env.GITHUB_REPOSITORY,'Jacop7/stocknews','Unexpected hosted repository');
    assert.ok(sha.test(env.JUDOJU_NATIVE_BASE_SHA??''),'Missing/invalid event baseline SHA');
    if(env.GITHUB_EVENT_NAME==='pull_request') {
      assert.ok(!/^0+$/.test(env.JUDOJU_NATIVE_BASE_SHA),'Missing PR base commit');
      refs.push(env.JUDOJU_NATIVE_BASE_SHA);
    } else {
      assert.equal(env.GITHUB_EVENT_NAME,'push','Unsupported CI event');
      refs.push(/^0+$/.test(env.JUDOJU_NATIVE_BASE_SHA)?'HEAD^':env.JUDOJU_NATIVE_BASE_SHA);
    }
  } else if(branch==='main')refs.push('HEAD^');
  else {
    // A fresh single-branch clone may have origin/main but no local main.
    const main=resolve('refs/heads/main')??resolve('refs/remotes/origin/main');
    assert.ok(sha.test(main??''),'Unresolvable local/origin main native baseline');
    refs.push(main);
  }
  return [...new Set(refs.map(ref=>{
    const commit=resolve(ref);
    assert.ok(sha.test(commit??''),'Unresolvable native baseline '+ref);
    return commit;
  }))];
}
export function requireRuntimeChange(current,previous) {
  if(current.digest!==previous.digest) for(const platform of ['android','ios']) {
    assert.notEqual(current.runtimeVersions[platform],previous.runtimeVersions[platform],
      'Native input changed without new '+platform+' runtime');
  }
}
export function verifyNativeHistory(current,commits,readRecord) {
  assert.equal(current.introducedAfterCommit,introductionBase);
  for(const commit of commits) {
    const previous=readRecord(commit);
    if(previous===null) assert.equal(commit,introductionBase,'Missing native history outside verified first introduction');
    else requireRuntimeChange(current,previous);
  }
}
export function allowedHostedPullRef(env,head,refCommit) {
  if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!=='Jacop7/stocknews'||env.GITHUB_EVENT_NAME!=='pull_request') return null;
  const match=/^refs\/pull\/([1-9]\d*)\/merge$/.exec(env.GITHUB_REF??'');
  if(!match||!sha.test(env.GITHUB_SHA??'')||head!==env.GITHUB_SHA) return null;
  const ref=`refs/remotes/pull/${match[1]}/merge`;
  return refCommit(ref)===head?ref:null;
}
