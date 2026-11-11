/**
 * A small iCalendar (RFC 5545) reader for holiday calendars: only all-day VEVENTs are read (DTSTART;VALUE=DATE, optional exclusive DTEND).
 * Google's public holiday calendars mark each event "Public holiday" or "Observance" in DESCRIPTION (Thai calendars use วันหยุด / วันสำคัญ);
 * observances are not days off, so they are left out. An event without a DESCRIPTION (a hospital's own calendar) counts as a day off.
 * No dependency, no network: the caller supplies the text.
 */
export type IcsHoliday={day:string;name:string};

const MAX_EVENT_DAYS=31;
const unfold=(text:string)=>text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').replace(/\n[ \t]/g,'');
const unescape=(v:string)=>v.replace(/\\n/gi,' ').replace(/\\([,;\\])/g,'$1').trim();
const dateOf=(v:string)=>{const m=/^(\d{4})(\d{2})(\d{2})/.exec(v.trim());if(!m)return null;const day=`${m[1]}-${m[2]}-${m[3]}`;const t=Date.parse(day+'T00:00:00Z');return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===day?day:null;};
const nextDay=(day:string)=>new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString().slice(0,10);

/** True when DESCRIPTION says the event is a day off (or says nothing). */
export function isDayOff(description:string|undefined){
 if(!description)return true;
 const d=description.toLowerCase();
 if(/observance|วันสำคัญ/.test(d))return false;
 return true;
}

/** Every day off in the calendar text, one entry per day (multi-day events are expanded), sorted, without duplicates. */
export function parseHolidayIcs(text:string):IcsHoliday[]{
 if(!/BEGIN:VCALENDAR/i.test(text))throw Error('ICS_NOT_CALENDAR');
 const out=new Map<string,string>();
 for(const block of unfold(text).split(/BEGIN:VEVENT/i).slice(1)){
  const body=block.split(/END:VEVENT/i)[0];
  const props=new Map<string,{params:string;value:string}>();
  for(const line of body.split('\n')){
   const m=/^([A-Za-z-]+)((?:;[^:]*)?):(.*)$/.exec(line);
   if(m&&!props.has(m[1].toUpperCase()))props.set(m[1].toUpperCase(),{params:m[2].toUpperCase(),value:m[3]});
  }
  const start=props.get('DTSTART');if(!start)continue;
  // Only all-day entries are holidays; a timed meeting never removes a working day.
  if(!/VALUE=DATE(?!-)/.test(start.params)&&/T\d/.test(start.value))continue;
  const first=dateOf(start.value);if(!first)continue;
  if(!isDayOff(props.get('DESCRIPTION')?unescape(props.get('DESCRIPTION')!.value):undefined))continue;
  if(/CANCELLED/i.test(props.get('STATUS')?.value??''))continue;
  const name=(unescape(props.get('SUMMARY')?.value??'')||'วันหยุด').slice(0,200);
  const endRaw=props.get('DTEND')?.value,end=endRaw?dateOf(endRaw):null;
  let day=first;
  for(let i=0;i<MAX_EVENT_DAYS;i++){
   if(!out.has(day))out.set(day,name);
   const next=nextDay(day);
   if(!end||next>=end)break;
   day=next;
  }
 }
 return [...out].sort(([a],[b])=>a.localeCompare(b)).map(([day,name])=>({day,name}));
}
