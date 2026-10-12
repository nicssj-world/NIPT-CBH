import {describe,it,expect} from "vitest";
import {browserFixtureDatabaseUrl} from "../helpers/browser-database";
const ci="postgresql://nipt_ci@127.0.0.1:5432/nipt_synthetic_ci";
const local="postgresql://nipt_dev@127.0.0.1:55432/nipt_synthetic_p2_browser_closed2";
const environment=(fixture=ci,app=fixture)=>({NIPT_MODE:"synthetic",NIPT_E2E_AUDIT_DATABASE_URL:fixture,DATABASE_URL:app});
describe("explicit browser fixture database target",()=>{
 it.each([ci,local,"postgresql://nipt_dev@localhost/nipt_synthetic_p2_browser_reviewed","postgresql://nipt_dev@[::1]:55432/nipt_synthetic_p2_browser"])("accepts reserved synthetic app target %s",url=>{expect(browserFixtureDatabaseUrl(environment(url))).toBe(url);});
 it("allows the fixture owner role to differ from the matching app runtime role",()=>{expect(browserFixtureDatabaseUrl(environment(local,local.replace("nipt_dev","nipt_web")))).toBe(local);});
 it("treats an omitted PostgreSQL port as 5432",()=>{expect(browserFixtureDatabaseUrl(environment(ci,ci.replace(":5432/","/")))).toBe(ci);});
 it.each([{}, {NIPT_MODE:"synthetic",DATABASE_URL:ci}, {NIPT_MODE:"synthetic",NIPT_E2E_AUDIT_DATABASE_URL:ci}, {...environment(),NIPT_MODE:"production"}])("rejects missing explicit configuration or nonsynthetic mode",env=>{expect(()=>browserFixtureDatabaseUrl(env)).toThrow();});
 it.each(["invalid",ci.replace("postgresql:","https:"),ci.replace("127.0.0.1","production.example"),ci.replace("nipt_synthetic_ci","nipt_production"),ci.replace("nipt_synthetic_ci","nipt_synthetic_test_ci"),ci.replace("nipt_synthetic_ci","nipt_synthetic_ci_production"),ci+"?host=production.example",ci+"#unsafe"])("rejects unsafe/unreserved fixture target %s",url=>{expect(()=>browserFixtureDatabaseUrl(environment(url))).toThrow();});
 it.each([ci.replace("127.0.0.1","localhost"),ci.replace(":5432/",":55432/"),local])("rejects a safe fixture aimed at a different app endpoint",app=>{expect(()=>browserFixtureDatabaseUrl(environment(ci,app))).toThrow("E2E_BROWSER_DATABASE_APP_TARGET_MISMATCH");});
 it("rejects unsafe app configuration even when the fixture itself is safe",()=>{expect(()=>browserFixtureDatabaseUrl(environment(ci,ci+"?host=production.example"))).toThrow("E2E_BROWSER_DATABASE_TARGET_UNSAFE");});
});
