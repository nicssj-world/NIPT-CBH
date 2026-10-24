// Loopback-only HTTPS front end for the integrated Owner UAT (operational mode requires an https APP_ORIGIN).
// Terminates TLS with a local self-signed certificate and forwards to the native Next.js server on 127.0.0.1. No LAN binding.
import https from 'node:https';
import http from 'node:http';
import {readFileSync} from 'node:fs';
const [,,pfxFile,passFile,listenPort,targetPort]=process.argv;
if(!pfxFile||!passFile||!listenPort||!targetPort)throw Error('USAGE: tls-proxy.mjs <pfx> <passphrase-file> <listen-port> <target-port>');
const server=https.createServer({pfx:readFileSync(pfxFile),passphrase:readFileSync(passFile,'utf8').trim(),minVersion:'TLSv1.2'},(req,res)=>{
 const headers={...req.headers,'x-forwarded-proto':'https','x-forwarded-host':req.headers.host??''};
 const upstream=http.request({host:'127.0.0.1',port:Number(targetPort),method:req.method,path:req.url,headers},up=>{res.writeHead(up.statusCode??502,up.headers);up.pipe(res);});
 upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502,{'content-type':'text/plain; charset=utf-8'});res.end('UAT web server is not running');});
 req.pipe(upstream);
});
server.listen(Number(listenPort),'127.0.0.1',()=>process.stdout.write(`TLS_PROXY_READY https://127.0.0.1:${listenPort} -> http://127.0.0.1:${targetPort}\n`));
for(const s of ['SIGINT','SIGTERM'])process.once(s,()=>server.close(()=>process.exit(0)));
