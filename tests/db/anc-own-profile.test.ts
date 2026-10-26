import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {migrate} from '../../tools/migrate';
import {readOwnProfile,saveOwnProfile} from '../../packages/profile/service';
import type {Staff} from '../../packages/p2/service';
let db:PGlite,one:Staff,two:string;
beforeAll(async()=>{db=new PGlite();await migrate(db);for(const username of ['anc-one','anc-two']){const {rows}=await db.query<{id:string}>("INSERT INTO app_user(username,display_name,password_hash) VALUES($1,$1,'$argon2id$unused') RETURNING id",[username]);if(username==='anc-one')one={id:rows[0].id,roles:['ANC_NURSE'],unitIds:[],permissions:[]};else two=rows[0].id;}});
afterAll(async()=>db?.close());
it('updates own contact fields without changing another user or authorization',async()=>{await saveOwnProfile(db,one,{displayName:'พยาบาลทดสอบ',phone:'038-123456',jobPosition:'พยาบาล',version:1});const p=await readOwnProfile(db,one);expect(p.displayName).toBe('พยาบาลทดสอบ');expect(p.phone).toBe('038-123456');expect((await db.query<{display_name:string}>('SELECT display_name FROM app_user WHERE id=$1',[two])).rows[0].display_name).toBe('anc-two');await expect(saveOwnProfile(db,one,{id:two,displayName:'bad',phone:'',jobPosition:'',version:2})).rejects.toThrow();await expect(saveOwnProfile(db,one,{roles:['APP_ADMIN'],displayName:'bad',phone:'',jobPosition:'',version:2})).rejects.toThrow();});
it('rejects stale updates, invalid image/phone, and revoked sessions',async()=>{await expect(saveOwnProfile(db,one,{displayName:'x',phone:'',jobPosition:'',version:1})).rejects.toThrow('STALE_VERSION');await expect(saveOwnProfile(db,one,{displayName:'x',phone:'script',jobPosition:'',version:2})).rejects.toThrow();await expect(saveOwnProfile(db,one,{displayName:'x',phone:'',jobPosition:'',version:2,image:{mime:'image/png',data:'aGVsbG8='}})).rejects.toThrow();await expect(saveOwnProfile(db,{...one,sessionId:'00000000-0000-4000-8000-000000000001'},{displayName:'x',phone:'',jobPosition:'',version:2})).rejects.toThrow('UNAUTHENTICATED');});


