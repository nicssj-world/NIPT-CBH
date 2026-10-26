/** Line icons for LAB screens (OWNER-LAB-041/049/050). Same 24px grid and 1.6 stroke as the sidebar icons. */
const PATHS={
 dna:"M2 15c6.7-6 13.3 0 20-6M9 22c1.8-2 2.5-4 2.8-6M15 2c-1.8 2-2.5 4-2.8 6M17 6l-2.5-2.5M14 8l-1-1M7 18l2.5 2.5M3.5 14.5l.5.5M20 9l.5.5M6.5 12.5l1 1M16.5 10.5l1 1M10 16l1.5 1.5",
 clipboard:"M9 4h6v3H9zM7 5H5v16h14V5h-2M8 11h8M8 15h6",
 flask:"M9 3h6M10 3v6l-5.5 9.5A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-2.5L14 9V3M7.5 15h9",
 cpu:"M6 6h12v12H6zM9 9h6v6H9zM9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4",
 activity:"M3 12h4l3-8 4 16 3-8h4",
 printer:"M7 8V3h10v5M7 17H4v-7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7h-3M7 14h10v7H7z",
 save:"M5 3h11l3 3v15H5zM8 3v5h7V3M8 21v-7h8v7",
 upload:"M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6",
 download:"M12 3v13m-5-5 5 5 5-5M4 15v6h16v-6",
 layers:"M12 3 2 8l10 5 10-5zM2 13l10 5 10-5M2 18l10 5 10-5",
 file:"M6 2h9l5 5v15H6zM14 2v6h6M9 13h7M9 17h7",
 check:"m5 12 4 4 10-10",
 trash:"M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3",
 eye:"M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z",
 pencil:"M4 20h4L19 9l-4-4L4 16zM13 7l4 4",
 refresh:"M20 11a8 8 0 0 0-14.6-4.5L3 9M4 13a8 8 0 0 0 14.6 4.5L21 15M3 4v5h5M21 20v-5h-5",
 alert:"M12 3 2 20h20zM12 10v4M12 17h.01",
 info:"M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7h.01",
 server:"M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01",
 database:"M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
 shield:"M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z",
 inbox:"M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6z",
 send:"M22 2 11 13M22 2l-7 20-4-9-9-4z",
 archive:"M3 4h18v4H3zM5 8v12h14V8M10 12h4",
 bell:"M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4",
 clock:"M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 3",
 search:"M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3",
 x:"M6 6l12 12M18 6 6 18",
 chevronRight:"m9 6 6 6-6 6",
} as const;
export type LabIconName=keyof typeof PATHS;
export function LabIcon({name,size=20,className}:{name:LabIconName;size?:number;className?:string}){
 return <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={PATHS[name]}/></svg>;
}
