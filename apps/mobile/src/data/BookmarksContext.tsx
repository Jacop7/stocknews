import {createContext,useContext,useEffect,useSyncExternalStore} from 'react';
import type {ReactNode} from 'react';
import {bookmarkAdapter} from './bookmark-adapter';
import {createBookmarkStore} from './bookmarks.mjs';
type Entry={issue_id:string;saved_at:string};
const store=createBookmarkStore(bookmarkAdapter),Context=createContext(store);
export function BookmarksProvider({children}:{children:ReactNode}){
 useEffect(()=>bookmarkAdapter.subscribe(()=>{void store.reload().catch(()=>{});}),[]);
 return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useBookmarks(){const current=useContext(Context),state=useSyncExternalStore(current.subscribe,current.getSnapshot,current.getSnapshot);return {...state,entries:state.entries as Entry[],set:current.set,aliases:current.aliases,reload:current.reload};}
