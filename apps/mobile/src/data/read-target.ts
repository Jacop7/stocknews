export const PREVIEW_HOSTED_URL='https://52-79-247-25.sslip.io';
export type ReadMode='LOCAL_SYNTHETIC'|'PREVIEW_SYNTHETIC'|'LOCAL_REVIEW_REAL';
export type ReadTarget={url:string;mode:ReadMode};
export function resolveReadTarget(input:{base?:string;mode?:string;environment?:string}):ReadTarget{
 const mode=input.mode??'LOCAL_SYNTHETIC',url=input.base??'http://127.0.0.1:62330';
 if(mode==='LOCAL_SYNTHETIC'&&/^http:\/\/(127\.0\.0\.1|192\.168\.200\.132):62330$/.test(url))return {url,mode};
 // Preview reads go through the local preview gateway or the hosted one on AWS (HTTPS, free sslip.io name).
 if(mode==='PREVIEW_SYNTHETIC'&&['development','preview'].includes(input.environment??'')&&['http://127.0.0.1:62331',PREVIEW_HOSTED_URL].includes(url))return {url,mode};
 // Internal review of real articles (publish stage 1B): this computer's review gateway only, explicit local builds only.
 if(mode==='LOCAL_REVIEW_REAL'&&input.environment==='local'&&url==='http://127.0.0.1:62332')return {url,mode};
 throw new Error('공개 개발 API 주소와 모드를 확인해 주세요.');
}
