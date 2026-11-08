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
