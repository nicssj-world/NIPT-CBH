import {it,expect} from 'vitest';
import {testDatabase} from '../helpers/database';
import {labUsers} from '../helpers/lab';
import {listLabOperators,firstNameOf,splitOperators,joinOperators} from '../../packages/lab/operators';

// Owner 2026-11-11: the Lab operator fields offer active Lab people by first name only and keep their Initial Names joined by " / ".
it('names a person by first name only, without a title or surname',()=>{
 expect(firstNameOf('นางสาว สมใจ ใจดี')).toBe('สมใจ');
 expect(firstNameOf('น.ส.สมใจ ใจดี')).toBe('สมใจ');
 expect(firstNameOf('นาย  สมชาย   รักงาน')).toBe('สมชาย');
 expect(firstNameOf('Dr. Siriwat J.')).toBe('Siriwat');
 expect(firstNameOf('ทนพญ. กมล')).toBe('กมล');
 expect(firstNameOf('สมศรี')).toBe('สมศรี');
});
it('splits and joins the operator text as "SJ / SC", keeping an old free-text value',()=>{
 expect(splitOperators('SJ / SC')).toEqual(['SJ','SC']);
 expect(splitOperators('SJ/SC/')).toEqual(['SJ','SC']);
 expect(splitOperators('สมชาย ใจดี')).toEqual(['สมชาย ใจดี']);
 expect(splitOperators(null)).toEqual([]);
 expect(joinOperators(['SJ','SC','SJ'])).toBe('SJ / SC');
});
it('lists only active LAB_STAFF / LAB_CERTIFIER / APP_ADMIN people with their Initial Name, and only to Lab users',async()=>{
 const db=await testDatabase();
 try{
  const u=await labUsers(db);
  await db.query("UPDATE app_user SET display_name='นางสาว สมใจ ใจดี',initial_name='SJ' WHERE id=$1",[u.staff.id]);
  await db.query("UPDATE app_user SET enabled=false WHERE id=$1",[u.staff2.id]);
  const list=await listLabOperators(db,u.staff);
  const ids=list.map(o=>o.id);
  expect(ids).toContain(u.staff.id);expect(ids).toContain(u.certifier.id);
  for(const other of [u.staff2,u.approver,u.auditor,u.anc])expect(ids).not.toContain(other.id); // disabled, or not a Lab role
  expect(list.find(o=>o.id===u.staff.id)).toEqual({id:u.staff.id,firstName:'สมใจ',initialName:'SJ'});
  expect(list.find(o=>o.id===u.certifier.id)?.initialName).toBeNull();
  await expect(listLabOperators(db,u.anc)).rejects.toThrow();
  // an administrator with only APP_ADMIN is choosable too, but a disabled one is not
  const admin=(await db.query<{id:string}>("INSERT INTO app_user(username,display_name,initial_name,password_hash) VALUES('synthetic.admin.op','ศิริวัฒน์ จำปีรัตน์','SJA','$argon2id$v=19$synthetic') RETURNING id")).rows[0].id;
  await db.query("INSERT INTO role_assignment(user_id,role) VALUES($1,'APP_ADMIN')",[admin]);
  expect((await listLabOperators(db,u.staff)).find(o=>o.id===admin)).toEqual({id:admin,firstName:'ศิริวัฒน์',initialName:'SJA'});
  await db.query('UPDATE app_user SET enabled=false WHERE id=$1',[admin]);
  expect((await listLabOperators(db,u.staff)).map(o=>o.id)).not.toContain(admin);
 }finally{await db.close();}
});
