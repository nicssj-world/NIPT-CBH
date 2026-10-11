import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { testDatabase, addUser, TEST_PASSWORD } from "../helpers/database";
import { authenticate, readSession, revokeSession, IDLE_MS, ABSOLUTE_MS, validateCsrf, digest, token, throttleLogin } from "../../packages/security/session";
import { hashPassword, validatePassword, verifyPassword } from "../../packages/security/password";
import { sealSecret, openSecret, identityLookup, encryptIdentifier } from "../../packages/security/envelope";
import { assertSynthetic, assertNoClinicalRelease } from "../../packages/security/runtime";
import type { PGlite } from "@electric-sql/pglite";
let db: PGlite;
describe("local authentication and security", () => {
  beforeAll(async () => { db = await testDatabase(); await addUser(db); });
  afterAll(async () => { await db.close(); });
  it("enforces offline password policy and Argon2id", async () => {
    expect(() => validatePassword("1234567890")).toThrow();
    const hash = await hashPassword(TEST_PASSWORD);
    expect(hash.split("$").slice(0,3)).toEqual(["", "argon2id", "v=19"]);
    expect(new Set(hash.split("$")[3].split(","))).toEqual(new Set(["m=65536","t=3","p=1"]));
    expect(await verifyPassword(hash, TEST_PASSWORD)).toBe(true);
    expect(await verifyPassword(hash, "incorrect")).toBe(false);
  });
  it("locks at five failures, refuses a correct password until lock expires", async () => {
    const now = new Date("2026-10-11T00:00:00Z");
    for (let i = 0; i < 5; i++) expect(await authenticate(db, "synthetic.admin", "wrong", now)).toBeNull();
    expect(await authenticate(db, "synthetic.admin", TEST_PASSWORD, now)).toBeNull();
    expect(await authenticate(db, "synthetic.admin", TEST_PASSWORD, new Date(now.getTime()+16*60_000))).not.toBeNull();
  });
  it("stores hash only, idle expiry, absolute expiry and revocation", async () => {
    const now = new Date("2026-10-11T02:00:00Z");
    const login = (await authenticate(db, "synthetic.admin", TEST_PASSWORD, now))!;
    expect(JSON.stringify((await db.query("SELECT * FROM app_session")).rows)).not.toContain(login.token);
    expect(await readSession(db, login.token, new Date(now.getTime()+IDLE_MS))).toBeNull();
    const next = (await authenticate(db, "synthetic.admin", TEST_PASSWORD, now))!;
    expect(await readSession(db, next.token, now)).not.toBeNull();
    expect(await readSession(db, next.token, new Date(now.getTime()+ABSOLUTE_MS))).toBeNull();
    await revokeSession(db,next.token); expect(await readSession(db,next.token,now)).toBeNull();
  });
  it("rejects CSRF missing/wrong origin, accepts correct binding", () => {
    const csrf=token(), hash=digest(csrf), origin="http://127.0.0.1:3000";
    expect(() => validateCsrf(null,origin,csrf,hash)).toThrow();
    expect(() => validateCsrf("http://evil.invalid",origin,csrf,hash)).toThrow();
    expect(() => validateCsrf(origin,origin,token(),hash)).toThrow();
    expect(() => validateCsrf(origin,origin,csrf,hash)).not.toThrow();
  });
  it("limits unknown-account brute force independently of usernames",async()=>{
    for(let i=0;i<20;i++) expect(await throttleLogin(db,"synthetic-client")).toBe(true);
    expect(await throttleLogin(db,"synthetic-client")).toBe(false);
  });
  it("denies non-synthetic mode and every clinical release flag",()=>{
    const prior=process.env.NIPT_MODE; process.env.NIPT_MODE="production";
    expect(assertSynthetic).toThrow(); process.env.NIPT_MODE=prior;
    expect(assertNoClinicalRelease).toThrow();
  });
});
describe("write-only envelope and identifier encryption",()=>{
  it("roundtrips only with worker private key, rejects tampering/purpose/key",()=>{
    const {publicKey,privateKey}=generateKeyPairSync("rsa",{modulusLength:2048,publicKeyEncoding:{type:"spki",format:"pem"},privateKeyEncoding:{type:"pkcs8",format:"pem"}});
    const value="SYNTHETIC_SECRET_VALUE", e=sealSecret(value,publicKey,"key-v1","his-inbound");
    expect(JSON.stringify(e)).not.toContain(value);
    expect(openSecret(e,privateKey,"his-inbound")).toBe(value);
    expect(()=>openSecret(e,privateKey,"his-outbound")).toThrow();
    expect(()=>openSecret({...e,tag:randomBytes(16).toString("base64")},privateKey,"his-inbound")).toThrow();
    expect(()=>openSecret(e,publicKey,"his-inbound")).toThrow();
  });
  it("identity lookup is keyed and encryption randomized",()=>{
    const key=randomBytes(32), lookup=randomBytes(32), id="SYNTHETIC-IDENTITY";
    expect(identityLookup(id,lookup)).toBe(identityLookup(id,lookup));
    expect(identityLookup(id,key)).not.toBe(identityLookup(id,lookup));
    expect(encryptIdentifier(id,key).ciphertext).not.toBe(encryptIdentifier(id,key).ciphertext);
  });
});
