import assert from "node:assert/strict";
import test from "node:test";
import {
  createAdminSessionToken,
  createPasswordHash,
  createSessionToken,
  verifyAdminSessionToken,
  verifyPassword,
  verifySessionToken,
} from "../app/lib/auth.ts";

test("scrypt password hash accepts only the original password", async () => {
  const hash = await createPasswordHash("correct horse battery staple");
  assert.equal(await verifyPassword("correct horse battery staple", hash), true);
  assert.equal(await verifyPassword("wrong password", hash), false);
  assert.equal(hash.startsWith("scrypt$"), true);
  assert.equal(hash.includes("correct horse"), false);
});

test("signed session token rejects tampering", async () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-session-secret-that-is-longer-than-32-characters";
  try {
    const token = await createSessionToken();
    assert.equal(await verifySessionToken(token), true);
    assert.equal(await verifySessionToken(`${token}tampered`), false);
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});

test("admin session token is separate from the shared session token", async () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-session-secret-that-is-longer-than-32-characters";
  try {
    const adminToken = await createAdminSessionToken();
    const householdToken = await createSessionToken();
    assert.equal(await verifyAdminSessionToken(adminToken), true);
    assert.equal(await verifyAdminSessionToken(householdToken), false);
    assert.equal(await verifySessionToken(adminToken), false);
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});
