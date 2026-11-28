import {createContext,useContext,useState} from 'react';
import type {ReactNode} from 'react';
import type {CalendarPeriod} from '@judoju/contracts';
// macro: the 매크로 filter choice (docs/sector-news-plan.md §1), kept in memory like the sector selection.
const CatalogContext=createContext({selected:[] as string[],setSelected:(_ids:string[])=>{},macro:false,setMacro:(_macro:boolean)=>{},period:'TODAY' as CalendarPeriod,setPeriod:(_period:CalendarPeriod)=>{}});
export function CatalogProvider({children}:{children:ReactNode}){const [selected,setSelected]=useState<string[]>([]),[macro,setMacro]=useState(false),[period,setPeriod]=useState<CalendarPeriod>('TODAY');return <CatalogContext.Provider value={{selected,setSelected,macro,setMacro,period,setPeriod}}>{children}</CatalogContext.Provider>;}
export const useCatalogFilter=()=>useContext(CatalogContext);
