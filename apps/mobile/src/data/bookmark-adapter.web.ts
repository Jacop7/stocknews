import {bookmarkNamespace,parseBookmarks} from './bookmarks.mjs';
export const bookmarkAdapter={
 async read(){if(typeof window==='undefined')return null;return window.localStorage.getItem(bookmarkNamespace);},
 async update(transform:(value:any)=>any){
  if(typeof navigator==='undefined'||!navigator.locks)throw new Error('이 브라우저에서는 안전하게 저장할 수 없습니다. 지원되는 브라우저에서 다시 시도해 주세요.');
  return navigator.locks.request(bookmarkNamespace,async()=>{const next=transform(parseBookmarks(window.localStorage.getItem(bookmarkNamespace)));window.localStorage.setItem(bookmarkNamespace,JSON.stringify(next));return next;});
 },
 subscribe(fn:()=>void){const listener=(e:StorageEvent)=>{if(e.key===bookmarkNamespace||e.key===null)fn();};window.addEventListener('storage',listener);return()=>window.removeEventListener('storage',listener);}
};
