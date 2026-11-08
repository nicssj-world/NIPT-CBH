// Fits a signer's picture into the picture frame of the Owner's Word master. The frame (size and anchor position) is the master's;
// the picture keeps its own aspect ratio, is centred in the frame and is never larger than it. Image bytes are never touched.
export type Frame={cx:number;cy:number};
export type ImageSize={width:number;height:number};
export type Fit={cx:number;cy:number;offsetX:number;offsetY:number};

export function fitSignature(frame:Frame,image:ImageSize):Fit{
 if(!(frame.cx>0&&frame.cy>0&&image.width>0&&image.height>0))throw new Error('SIGNATURE_FIT_INVALID_SIZE');
 const scale=Math.min(frame.cx/image.width,frame.cy/image.height);
 const cx=Math.min(frame.cx,Math.round(image.width*scale)),cy=Math.min(frame.cy,Math.round(image.height*scale));
 return {cx,cy,offsetX:Math.round((frame.cx-cx)/2),offsetY:Math.round((frame.cy-cy)/2)};
}

const setSize=(tag:string,cx:number,cy:number)=>tag.replace(/\bcx="\d+"/,`cx="${cx}"`).replace(/\bcy="\d+"/,`cy="${cy}"`);
/** Adds `delta` to the `wp:posOffset` inside the named position element; an aligned (`wp:align`) position is left as the master has it. */
function shift(xml:string,element:'wp:positionH'|'wp:positionV',delta:number){
 if(!delta)return xml;
 return xml.replace(new RegExp(`(<${element}\\b[^>]*>\\s*<wp:posOffset>)(-?\\d+)(</wp:posOffset>)`),(_,a:string,v:string,c:string)=>`${a}${Number(v)+delta}${c}`);
}
/**
 * Resizes the picture of one `w:drawing`. `wp:extent` (the frame) and the picture's own `a:ext` change to the fitted size. An
 * anchored drawing moves by the centring offset so the picture stays centred in the master's frame; an inline one needs no move.
 * Everything else in the drawing is returned unchanged.
 */
export function fitDrawingXml(drawingXml:string,image:ImageSize):string{
 const extent=/<wp:extent\b[^>]*\/>/.exec(drawingXml);if(!extent)return drawingXml;
 const cx=/\bcx="(\d+)"/.exec(extent[0]),cy=/\bcy="(\d+)"/.exec(extent[0]);if(!cx||!cy)return drawingXml;
 const fit=fitSignature({cx:Number(cx[1]),cy:Number(cy[1])},image);
 let out=drawingXml.replace(extent[0],setSize(extent[0],fit.cx,fit.cy));
 out=out.replace(/(<a:xfrm\b[^>]*>[\s\S]*?)(<a:ext\b[^>]*\bcx="\d+"[^>]*\/>)/,(_,head:string,ext:string)=>head+setSize(ext,fit.cx,fit.cy));
 if(/<wp:anchor\b/.test(out)){out=shift(out,'wp:positionH',fit.offsetX);out=shift(out,'wp:positionV',fit.offsetY);}
 return out;
}

/** Why a drawing cannot be fitted safely, or null when it is a plain, unrotated, single-picture drawing with a usable frame. */
export function unfittableReason(drawingXml:string):string|null{
 if(/<(?:wpg|wps|wpc):|<mc:AlternateContent\b/.test(drawingXml))return 'GROUP_OR_SHAPE';
 if(/<w:t[\s>]/.test(drawingXml))return 'TEXT_IN_DRAWING';
 if((drawingXml.match(/<pic:pic[\s>]/g)??[]).length!==1)return 'NOT_ONE_PICTURE';
 if(!/<a:graphicData\b[^>]*\buri="[^"]*\/drawingml\/2006\/picture"[^>]*>\s*<pic:pic[\s>]/.test(drawingXml))return 'NOT_PICTURE_GRAPHIC';
 if(!/<wp:(?:inline|anchor)\b/.test(drawingXml))return 'NOT_INLINE_OR_ANCHOR';
 const rot=/<a:xfrm\b[^>]*\brot="(-?\d+)"/.exec(drawingXml);if(rot&&Number(rot[1])!==0)return 'ROTATED';
 if(/<wp:anchor\b[^>]*\bsimplePos="(?:1|true)"/.test(drawingXml))return 'SIMPLE_POS';
 if(/<wp:align>/.test(drawingXml))return 'ALIGNED_POSITION';
 const extent=/<wp:extent\b[^>]*\/>/.exec(drawingXml);if(!extent)return 'NO_EXTENT';
 const cx=/\bcx="(\d+)"/.exec(extent[0]),cy=/\bcy="(\d+)"/.exec(extent[0]);if(!cx||!cy||!(Number(cx[1])>0)||!(Number(cy[1])>0))return 'FRAME_SIZE_INVALID';
 if(!/<a:xfrm\b[^>]*>[\s\S]*?<a:ext\b[^>]*\bcx="\d+"/.test(drawingXml))return 'NO_PICTURE_EXTENT';
 return null;
}
export type FitOutcome={xml:string;status:'FITTED'|`SKIPPED:${string}`;frame:Frame|null;fitted:Frame|null};
/** Never throws: anything that cannot be proven safe leaves the drawing exactly as the master has it, with the reason as evidence. */
export function fitDrawingSafely(drawingXml:string,image:ImageSize):FitOutcome{
 const m=/<wp:extent\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/.exec(drawingXml),frame=m?{cx:Number(m[1]),cy:Number(m[2])}:null;
 const skip=(why:string):FitOutcome=>({xml:drawingXml,status:`SKIPPED:${why}`,frame,fitted:frame});
 try{
  const why=unfittableReason(drawingXml);if(why)return skip(why);
  const fit=fitSignature(frame!,image);
  return {xml:fitDrawingXml(drawingXml,image),status:'FITTED',frame,fitted:{cx:fit.cx,cy:fit.cy}};
 }catch{return skip('FIT_ERROR');}
}
