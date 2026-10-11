import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp, mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Pool} from 'pg';
import {pool, assertSyntheticDatabase, withTransaction} from '../../packages/db/connection';
import {startWorker} from '../../packages/jobs/worker';
import {FileStore} from '../../packages/storage';
import {serializeRes, verifyRes} from '../../packages/integrations/res';
import {SETTINGS} from '../../packages/settings/catalog';
import {proposeSetting, validateSetting, approveSetting, activateSetting} from '../../packages/settings/service';
import {hashPassword} from '../../packages/security/password';
import type {Principal} from '../../packages/security/policy';
import {migrate} from '../migrate';
import {resInput} from '../../tests/helpers/his';

// A dedicated disposable native DB and filesystem; never enable another session's outbound settings.
const originalUrl = process.env.DATABASE_URL || '';
assertSyntheticDatabase(originalUrl);
const database = 'nipt_synthetic_outbound_' + randomUUID().replaceAll('-', '');
assert.match(database, /^nipt_synthetic_outbound_[a-f0-9]{32}$/);
const admin = new Pool({connectionString: originalUrl});
const root = await mkdtemp(path.join(os.tmpdir(), 'nipt-outbound-'));
let created = false;
let worker: Awaited<ReturnType<typeof startWorker>> | undefined;
try {
  await admin.query(`CREATE DATABASE ${database}`);
  created = true;
  const url = new URL(originalUrl);
  url.pathname = '/' + database;
  process.env.DATABASE_URL = url.toString();
  process.env.FILE_STORE_ROOT = path.join(root, 'files');
  process.env.SIMULATOR_ROOT = path.join(root, 'simulator');
  const outbound = path.join(process.env.SIMULATOR_ROOT, 'outbound');
  await mkdir(outbound, {recursive: true});
  await writeFile(path.join(process.env.SIMULATOR_ROOT, '.nipt-synthetic-root'), 'NIPT_SYNTHETIC_ONLY_V1');
  const client = await pool().connect();
  try { await migrate(client); } finally { client.release(); }
  await withTransaction(async db => {
    const users = await db.query("INSERT INTO app_user(username,display_name,password_hash) VALUES('synthetic.identity.admin','SYNTHETIC',$1),('synthetic.identity.approver','SYNTHETIC',$1) RETURNING id,username", [await hashPassword('SYNTHETIC-OUTBOUND-TEST-ONLY-2026!')]);
    const proposer: Principal = {id: users.rows.find(r => r.username.endsWith('.admin'))!.id, roles: ['APP_ADMIN'], unitIds: [], permissions: []};
    const approver: Principal = {id: users.rows.find(r => r.username.endsWith('.approver'))!.id, roles: ['CLINICAL_APPROVER'], unitIds: [], permissions: []};
    const id = await proposeSetting(db, proposer, 'his_outbound', {...SETTINGS.his_outbound.default, enabled: true}, 'SYNTHETIC identity regression only');
    await validateSetting(db, proposer, id, async () => true);
    await approveSetting(db, approver, id);
    await activateSetting(db, approver, id);
  });
  const store = new FileStore(process.env.FILE_STORE_ROOT);
  const res = serializeRes(resInput());
  const ln = resInput().ln;
  const pdfName = `1_SYNTHETIC-HN-1__${ln}.pdf`;
  const pdf = Buffer.from('%PDF-1.4 SYNTHETIC-OUTBOUND');
  const payload = {resName: res.filename, resHash: await store.put(res.bytes), pdfName, pdfHash: await store.put(pdf), ln};
  const {ln: _ln, ...legacyPayload} = payload;
  void _ln;
  const rows = verifyRes(res.bytes);
  rows[2][2] = ln + '2';
  const inconsistent = Buffer.concat([Buffer.from([255, 254]), Buffer.from(rows.map(r => r.join('|')).join('\r') + '\r', 'utf16le')]);
  const invalids = [
    [{...payload, pdfName: `1_SYNTHETIC-HN-1__${ln}2.pdf`}, 'PDF_LN_MISMATCH'],
    [{...payload, resName: ln + '125.res'}, 'RES_FILENAME_MISMATCH'],
    [{...payload, resHash: await store.put(inconsistent)}, 'RES_LN_MISMATCH'],
    [{...payload, ln: ln + '2'}, 'SOURCE_LN_MISMATCH'],
    [{...legacyPayload, pdfName: `1_SYNTHETIC-HN-1__${ln}2.pdf`}, 'PDF_LN_MISMATCH'],
  ] as const;
  worker = await startWorker();
  const enqueue = async (value: object) => {
    const result = await pool().query("INSERT INTO job_outbox(kind,payload,idempotency_key) VALUES('synthetic_export',$1,$2) RETURNING id", [value, 'synthetic-identity:' + randomUUID()]);
    await worker!.cycle();
    return result.rows[0].id as string;
  };
  const ids = await Promise.all(invalids.map(([value]) => enqueue(value)));
  for (let i = 0; i < ids.length; i++) {
    let observed = false;
    for (let attempt = 0; attempt < 150; attempt++) {
      const job = await worker.boss.getJobById('synthetic_export', ids[i]);
      if (job && job.retryCount >= 1 && JSON.stringify(job.output).includes(invalids[i][1])) { observed = true; break; }
      await new Promise(r => setTimeout(r, 200));
    }
    assert.ok(observed, 'WORKER_IDENTITY_RETRY_NOT_REJECTED:' + invalids[i][1]);
    assert.equal((await pool().query('SELECT 1 FROM integration_job_receipt WHERE outbox_id=$1', [ids[i]])).rowCount, 0);
    assert.deepEqual(await readdir(outbound), []);
    await pool().query("UPDATE job_outbox SET state='Cancelled',cancel_epoch=cancel_epoch+1 WHERE id=$1", [ids[i]]);
  }
  // Legacy jobs without a source-LN field must still traverse the same validator.
  const validId = await enqueue(legacyPayload);
  let completed = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    const receipt = await pool().query('SELECT result FROM integration_job_receipt WHERE outbox_id=$1', [validId]);
    if (receipt.rows[0]) { assert.equal(receipt.rows[0].result.state, 'SIMULATOR_DELIVERED'); completed = true; break; }
    await new Promise(r => setTimeout(r, 200));
  }
  assert.ok(completed, 'VALID_EXPORT_RECEIPT_MISSING');
  assert.deepEqual(await readFile(path.join(outbound, pdfName)), pdf);
  assert.deepEqual(await readFile(path.join(outbound, res.filename)), res.bytes);
  assert.deepEqual(await readFile(path.join(outbound, res.filename.replace('.res', '.ok'))), Buffer.from([255, 254]));
  assert.deepEqual((await readdir(outbound)).sort(), [pdfName, res.filename, res.filename.replace('.res', '.ok'), 'stage'].sort());
  console.log(JSON.stringify({code: 'NATIVE_OUTBOUND_IDENTITY_SMOKE_PASSED', rejectedAndRetried: ids.length, noArtifactsOnReject: true, sourceLnEnforced: true, legacyPayloadDelivered: true}));
} finally {
  await worker?.stop();
  if (created) { await pool().end(); await admin.query(`DROP DATABASE ${database}`); }
  await admin.end();
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('nipt-outbound-'));
  await rm(root, {recursive: true, force: true});
}
