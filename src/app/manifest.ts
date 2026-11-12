import type {MetadataRoute} from "next";
/** Owner 2026-11-12: lets Chrome/Edge show the Install button and put the NIPT CBH icon on the desktop. No service worker: the app is online-only and nothing is cached. */
export default function manifest():MetadataRoute.Manifest{
 return {
  name:"NIPT CBH",
  short_name:"NIPT CBH",
  description:"ระบบจัดการงานตรวจคัดกรองโครโมโซมทารก NIPT CBH",
  lang:"th",
  start_url:"/",
  scope:"/",
  display:"standalone",
  background_color:"#ffffff",
  theme_color:"#ffffff",
  icons:[
   {src:"/brand/app-icon-192.png",sizes:"192x192",type:"image/png",purpose:"any"},
   {src:"/brand/app-icon-512.png",sizes:"512x512",type:"image/png",purpose:"any"}
  ]
 };
}
