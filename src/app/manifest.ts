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
   {src:"/brand/ui-logo.png",sizes:"1254x1254",type:"image/png",purpose:"any"},
   {src:"/brand/desktop-compact.ico",sizes:"any",type:"image/x-icon"}
  ]
 };
}
