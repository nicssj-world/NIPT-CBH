import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {migrate} from '../../tools/migrate';
import {readOwnProfile,saveOwnProfile} from '../../packages/profile/service';
import type {Staff} from '../../packages/p2/service';

// Owner 2026-11-11: each person sets an Initial Name in their own Profile — English capital letters, 1-5, never used by two people.
let db:PGlite,one:Staff,two:Staff;
const base={displayName:'SYNTHETIC LAB',phone:'',jobPosition:''};
const version=async(s:Staff)=>(await readOwnProfile(db,s)).version;
beforeAll(async()=>{
 db=new PGlite();await migrate(db);
 const add=async(username:string)=>({id:(await db.query<{id:string}>("INSERT INTO app_user(username,display_name,password_hash) VALUES($1,$1,'$argon2id$unused') RETURNING id",[username])).rows[0].id,roles:['LAB_STAFF'],unitIds:[],permissions:[]} as Staff);
 one=await add('lab-one');two=await add('lab-two');
});
afterAll(async()=>db?.close());

it('saves an Initial Name in capitals, reads it back, and clears it when emptied',async()=>{
 expect((await readOwnProfile(db,one)).initialName).toBe('');
 await saveOwnProfile(db,one,{...base,initialName:'sj',version:await version(one)});
 expect((await readOwnProfile(db,one)).initialName).toBe('SJ');
 // A save that does not send the field keeps it (older clients).
 await saveOwnProfile(db,one,{...base,phone:'038-1',version:await version(one)});
 expect((await readOwnProfile(db,one)).initialName).toBe('SJ');
 await saveOwnProfile(db,one,{...base,initialName:'',version:await version(one)});
 expect((await readOwnProfile(db,one)).initialName).toBe('');
});

it('refuses anything but 1-5 English letters, and a name another person already uses',async()=>{
 for(const bad of ['S1','ส','S J','ABCDEF'])await expect(saveOwnProfile(db,one,{...base,initialName:bad,version:await version(one)})).rejects.toThrow();
 await saveOwnProfile(db,one,{...base,initialName:'SC',version:await version(one)});
 await expect(saveOwnProfile(db,two,{...base,initialName:'sc',version:await version(two)})).rejects.toThrow('INITIAL_NAME_TAKEN');
 // Keeping your own letters is not a clash.
 await saveOwnProfile(db,one,{...base,initialName:'SC',version:await version(one)});
 expect((await readOwnProfile(db,one)).initialName).toBe('SC');
 // The database refuses a direct write that breaks the rule too.
 await expect(db.query("UPDATE app_user SET initial_name='sc' WHERE id=$1",[two.id])).rejects.toThrow();
 await expect(db.query("UPDATE app_user SET initial_name='SC' WHERE id=$1",[two.id])).rejects.toThrow();
});
