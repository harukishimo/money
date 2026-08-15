import assert from "node:assert/strict";
import test from "node:test";
import {
  createPasswordHash,
  createSessionToken,
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
