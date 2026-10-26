/* eslint-disable */
// @ts-nocheck -- UAT verification harness (not shipped); loosely typed by design.
// Read-only: login throttle window of the isolated UAT DB.
import {client} from './db-env';
const c=await client('migrator');
console.log(JSON.stringify((await c.query("SELECT attempts,window_started_at,now() now FROM login_throttle")).rows));
console.log(JSON.stringify((await c.query("SELECT username,failed_count,locked_until FROM app_user WHERE failed_count>0 OR locked_until IS NOT NULL")).rows));
await c.end();
