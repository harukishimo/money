import assert from "node:assert/strict";
import test from "node:test";
import { isWishlistUrl, parseWishlistItems, summarizeWishlist } from "../app/lib/wishlist.ts";

const items = [
  { id: "desk", name: "デスク", category: "家具", amount: 50000, url: "https://example.com/desk" },
  { id: "chair", name: "チェア", category: "家具", amount: 30000, url: "" },
  { id: "trip", name: "旅行", category: "旅行", amount: 120000, url: "https://example.com/trip" },
];

test("wishlist items validate and normalize text fields", () => {
  assert.deepEqual(parseWishlistItems([
    { ...items[0], name: " デスク ", category: " 家具 ", url: " https://example.com/desk " },
  ]), [{ ...items[0] }]);
  assert.equal(parseWishlistItems([{ ...items[0], url: "javascript:alert(1)" }]), null);
  assert.equal(isWishlistUrl("https://example.com/item"), true);
  assert.equal(isWishlistUrl("http://example.com/item"), true);
  assert.equal(isWishlistUrl("javascript:alert(1)"), false);
  assert.equal(isWishlistUrl(""), true);
});

test("wishlist summary totals all items by category", () => {
  assert.deepEqual(summarizeWishlist(items), {
    total: 200000,
    categories: [
      { category: "旅行", amount: 120000, count: 1 },
      { category: "家具", amount: 80000, count: 2 },
    ],
  });
});
