export const calendarPeriods=[['TODAY','오늘'],['YESTERDAY','어제'],['THIS_WEEK','이번주'],['LAST_WEEK','지난주'],['THIS_MONTH','이번달'],['LAST_MONTH','지난달']];
export function validSelection(ids,catalog){const allowed=new Set(catalog.parents.flatMap(p=>p.sectors.map(s=>s.id)));return [...new Set(ids)].filter(x=>allowed.has(x));}
export function toggleSector(ids,id){return ids.includes(id)?ids.filter(x=>x!==id):[...ids,id];}
export function toggleParent(ids,parent){const children=parent.sectors.map(x=>x.id),all=children.length>0&&children.every(id=>ids.includes(id));return all?ids.filter(id=>!children.includes(id)):[...new Set([...ids,...children])];}
export function selectionLabels(ids,catalog){return catalog.parents.flatMap(parent=>{const selected=parent.sectors.filter(s=>ids.includes(s.id));return selected.length>0&&selected.length===parent.sectors.length?[{id:parent.id,name:parent.name+' 전체',ids:selected.map(s=>s.id)}]:selected.map(s=>({id:s.id,name:s.name,ids:[s.id]}));});}
export function periodRange(period,now=new Date()){
 const local=new Date(now.getTime()+9*3600000);local.setUTCHours(0,0,0,0);let start=new Date(local),end=new Date(local);const day=86400000;
 if(period==='YESTERDAY')start=new Date(start.getTime()-day);
 else if(period==='THIS_WEEK'||period==='LAST_WEEK'){start=new Date(start.getTime()-((start.getUTCDay()+6)%7+(period==='LAST_WEEK'?7:0))*day);end=new Date(start.getTime()+6*day);}
 else if(period==='THIS_MONTH'||period==='LAST_MONTH'){start=new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth()-(period==='LAST_MONTH'?1:0),1));end=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0));}
 else if(period!=='TODAY')throw new Error('INVALID_PERIOD');
 if(period==='YESTERDAY')end=start;
 const format=d=>d.toISOString().slice(0,10).replaceAll('-','.');return start.getTime()===end.getTime()?format(start):format(start)+'~'+format(end).slice(5);
}
