import {createContext,useContext,useState} from 'react';
import type {ReactNode} from 'react';
import type {CalendarPeriod} from '@judoju/contracts';
const CatalogContext=createContext({selected:[] as string[],setSelected:(_ids:string[])=>{},period:'TODAY' as CalendarPeriod,setPeriod:(_period:CalendarPeriod)=>{}});
export function CatalogProvider({children}:{children:ReactNode}){const [selected,setSelected]=useState<string[]>([]),[period,setPeriod]=useState<CalendarPeriod>('TODAY');return <CatalogContext.Provider value={{selected,setSelected,period,setPeriod}}>{children}</CatalogContext.Provider>;}
export const useCatalogFilter=()=>useContext(CatalogContext);
