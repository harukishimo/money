import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("uses protected Next.js routes and Google Sheets without database bindings", async () => {
  const [packageJson, page, layout, proxy, stateRoute, loginRoute, lifePlan, lifePlanPanel, sheets] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/state/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/life-plan.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/life-plan-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/sheets.ts", import.meta.url), "utf8"),
  ]);

  assert.match(packageJson, /"next": "16\.3\.1"/);
  assert.match(packageJson, /"build": "next build"/);
  assert.doesNotMatch(packageJson, /vinext|wrangler|drizzle/);
  assert.match(page, /readSheet/);
  assert.match(page, /fetch\("\/api\/state"/);
  assert.match(page, /LifePlanPanel/);
  assert.doesNotMatch(page, /localStorage\.setItem/);
  assert.match(page, /localStorage\.getItem/);
  assert.match(proxy, /verifySessionToken/);
  assert.match(stateRoute, /readHouseholdState/);
  assert.match(loginRoute, /verifyPassword/);
  assert.match(lifePlan, /buildLifePlan/);
  assert.match(lifePlanPanel, /住宅：賃貸 vs 購入/);
  assert.match(sheets, /GOOGLE_SERVICE_ACCOUNT_EMAIL/);
  assert.match(sheets, /GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY/);
  assert.doesNotMatch(sheets, /GOOGLE_SERVICE_ACCOUNT_JSON_BASE64/);
  assert.match(layout, /og\.png/);
  await access(new URL("../public/og.png", import.meta.url));
  await assert.rejects(access(new URL("../db", import.meta.url)));
  await assert.rejects(access(new URL("../.openai/hosting.json", import.meta.url)));
});
