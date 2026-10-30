import type {MetadataRoute} from 'next';
/** PWA shell only: no service worker, precache or offline patient storage. */
export default function manifest():MetadataRoute.Manifest{
 return {
  id:'/',
  name:'NIPT-CBH · ระบบตรวจคัดกรองโครโมโซมทารก',
  short_name:'NIPT-CBH',
  description:'ระบบงาน NIPT โรงพยาบาลชลบุรี ภายในเครือข่ายโรงพยาบาล',
  start_url:'/login',
  scope:'/',
  display:'standalone',
  background_color:'#ffffff',
  theme_color:'#123653',
  lang:'th',
  orientation:'any',
  icons:[
   {src:'/pwa-icons/192',sizes:'192x192',type:'image/png',purpose:'any'},
   {src:'/pwa-icons/512',sizes:'512x512',type:'image/png',purpose:'any'},
   {src:'/pwa-icons/512',sizes:'512x512',type:'image/png',purpose:'maskable'}
  ]
 };
}
