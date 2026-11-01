import {it,expect} from 'vitest';
import {boundedMultipart} from '../../src/server/bounded-multipart';
import {unstable_doesMiddlewareMatch} from 'next/experimental/testing/server';
import {config} from '../../src/proxy';
it('rejects oversized streamed multipart even without a Content-Length',async()=>{
 const body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(1000));controller.close();}});
 await expect(boundedMultipart(new Request('http://localhost',{method:'POST',body,duplex:'half'} as RequestInit),100)).rejects.toMatchObject({code:'UPLOAD_TOO_LARGE',status:413});
});
it('preserves allowed multipart and skips proxy body buffering only for upload routes',async()=>{
 const form=new FormData();form.set('file',new File(['source'],'input.xlsx'));
 const result=await boundedMultipart(new Request('http://localhost',{method:'POST',body:form}),2048);
 expect(await (result.get('file') as File).text()).toBe('source');
 for(const url of ['/api/migration/preview','/api/migration/execute','/api/migration/pdf'])expect(unstable_doesMiddlewareMatch({config,url})).toBe(false);
 expect(unstable_doesMiddlewareMatch({config,url:'/cases/example'})).toBe(true);
});

