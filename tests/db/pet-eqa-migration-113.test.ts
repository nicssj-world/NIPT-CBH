import {it,expect} from 'vitest';
import {testDatabase} from '../helpers/database';
it('migration 161 loads against all existing migrations',async()=>{const db=await testDatabase();try{const table=(await db.query<{name:string}>("SELECT to_regclass('public.eqa_case')::text name")).rows[0]?.name;expect(table).toBe('eqa_case');const exists=(await db.query<{n:boolean}>("SELECT EXISTS(SELECT 1 FROM pg_proc WHERE proname='nipt_round_pet_or_eqa_ok') n")).rows[0].n;expect(exists).toBe(true);}finally{await db.close();}});
it('inspect actual round/attempt constraints after migration 161',async()=>{
 const db=await testDatabase();
 try{
 const rows=(await db.query<{conname:string;definition:string}>("SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='specimen_round'::regclass AND contype='c' ORDER BY conname")).rows;
 console.log('ROUND_CHECKS_V113',JSON.stringify(rows));
 }finally{await db.close();}
});