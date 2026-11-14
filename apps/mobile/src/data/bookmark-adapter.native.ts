import AsyncStorage from '@react-native-async-storage/async-storage';
import {bookmarkNamespace,parseBookmarks} from './bookmarks.mjs';
let tail:Promise<unknown>=Promise.resolve();
export const bookmarkAdapter={read:()=>AsyncStorage.getItem(bookmarkNamespace),update(transform:(value:any)=>any){
 const job=tail.then(async()=>{const next=transform(parseBookmarks(await AsyncStorage.getItem(bookmarkNamespace)));await AsyncStorage.setItem(bookmarkNamespace,JSON.stringify(next));return next;});
 tail=job.catch(()=>{});return job;
},subscribe:(_fn:()=>void)=>()=>{}};
