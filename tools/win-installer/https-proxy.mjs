// TLS front for the Windows installation (replaces the Caddy container). Terminates HTTPS with the installer-generated certificate and
// forwards to the loopback web process with X-Forwarded-Proto/Host (the app sets Secure cookies from APP_ORIGIN). Node built-ins only.
// Listens on 127.0.0.1 unless NIPT_HTTPS_HOST says otherwise (LAN publication is a hospital IT decision, not an installer default).
import https from 'node:https';
import http from 'node:http';
import {readFileSync} from 'node:fs';
const port=Number(process.env.NIPT_HTTPS_PORT),upstreamPort=Number(process.env.NIPT_UPSTREAM_PORT),host=process.env.NIPT_HTTPS_HOST??'127.0.0.1';
if(!Number.isInteger(port)||!Number.isInteger(upstreamPort)||!process.env.NIPT_TLS_PFX||!process.env.NIPT_TLS_PASSPHRASE_FILE){process.stderr.write('HTTPS_PROXY_CONFIG_REQUIRED\n');process.exit(2);}
const server=https.createServer({pfx:readFileSync(process.env.NIPT_TLS_PFX),passphrase:readFileSync(process.env.NIPT_TLS_PASSPHRASE_FILE,'utf8').trim(),minVersion:'TLSv1.2'},(request,response)=>{
 const upstream=http.request({hostname:'127.0.0.1',port:upstreamPort,path:request.url,method:request.method,headers:{...request.headers,'x-forwarded-proto':'https','x-forwarded-host':request.headers.host}},reply=>{
  response.writeHead(reply.statusCode??502,reply.headers);reply.pipe(response);
 });
 upstream.on('error',()=>{if(!response.headersSent)response.writeHead(502);response.end();});
 request.pipe(upstream);
});
server.listen(port,host,()=>process.stdout.write(`HTTPS_PROXY_LISTENING ${host}:${port}\n`));
for(const s of ['SIGINT','SIGTERM'])process.once(s,()=>server.close(()=>process.exit(0)));
