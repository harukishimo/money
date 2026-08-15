export interface WishlistItem {
  id: string;
  name: string;
  category: string;
  amount: number;
  url: string;
}

export interface WishlistCategorySummary {
  category: string;
  amount: number;
  count: number;
}

export interface WishlistSummary {
  total: number;
  categories: WishlistCategorySummary[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidUrl(value: string) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isWishlistUrl(value: unknown): value is string {
  return typeof value === "string" && isValidUrl(value.trim());
}

function isWishlistItem(value: unknown): value is WishlistItem {
  if (!isRecord(value)) return false;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const category = typeof value.category === "string" ? value.category.trim() : "";
  const url = typeof value.url === "string" ? value.url.trim() : "";
  return typeof value.id === "string"
    && value.id.length > 0
    && value.id.length <= 120
    && name.length > 0
    && name.length <= 255
    && category.length > 0
    && category.length <= 100
    && typeof value.amount === "number"
    && Number.isFinite(value.amount)
    && value.amount >= 0
    && value.amount <= Number.MAX_SAFE_INTEGER
    && isValidUrl(url);
}

export function parseWishlistItems(value: unknown): WishlistItem[] | null {
  if (!Array.isArray(value) || value.length > 500 || !value.every(isWishlistItem)) return null;
  return value.map((item) => ({
    id: item.id,
    name: item.name.trim(),
    category: item.category.trim(),
    amount: item.amount,
    url: item.url.trim(),
  }));
}

export function summarizeWishlist(items: WishlistItem[]): WishlistSummary {
  const categoryMap = new Map<string, WishlistCategorySummary>();
  let total = 0;
  for (const item of items) {
    total += item.amount;
    const current = categoryMap.get(item.category) ?? { category: item.category, amount: 0, count: 0 };
    current.amount += item.amount;
    current.count += 1;
    categoryMap.set(item.category, current);
  }
  return {
    total,
    categories: [...categoryMap.values()].sort((left, right) => right.amount - left.amount || left.category.localeCompare(right.category, "ja")),
  };
}
