import type { Filters, StatusFilter } from "./types";

/** 每页条数（与页面原有分页保持一致）。 */
export const PAGE_SIZE = 6;

export const STATUS_FILTERS: readonly StatusFilter[] = [
  "ALL",
  "TODO",
  "DOING",
  "DONE",
];

/** 未知/缺省状态回退为 ALL；仅接受 ALL/TODO/DOING/DONE。 */
function parseStatus(raw: string | null): StatusFilter {
  return raw !== null && (STATUS_FILTERS as readonly string[]).includes(raw)
    ? (raw as StatusFilter)
    : "ALL";
}

/**
 * 页码规范化：缺省、非整数、非数值、非正安全整数一律回退为 1。
 * 直接用 /^\d+$/ 先把「-1 / 2.5 / 1e3 / +2」等非整数形态挡掉，
 * 再用 Number.isSafeInteger 排除超大数值。
 */
function parsePage(raw: string | null): number {
  if (raw === null) return 1;
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return 1;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 1) return 1;
  return value;
}

/** 从 location.search 读取查询状态；缺省值与非法值按上表回退。 */
export function readQuery(search: string): Filters {
  const params = new URLSearchParams(search);
  return {
    q: params.get("q") ?? "",
    status: parseStatus(params.get("status")),
    page: parsePage(params.get("page")),
  };
}

/**
 * 把查询状态写回 URL。
 * - 基于当前 search 构造，保留无关参数与 hash；
 * - 默认参数省略（q 为空、status 为 ALL、page 为 1）；
 * - 编码交给 URLSearchParams，中文/空格/& 不会被破坏。
 */
export function writeQuery(
  filters: Filters,
  mode: "push" | "replace",
): void {
  if (typeof window === "undefined" || !window.history) return;

  const params = new URLSearchParams(window.location.search);
  if (filters.q) params.set("q", filters.q);
  else params.delete("q");
  if (filters.status !== "ALL") params.set("status", filters.status);
  else params.delete("status");
  if (filters.page > 1) params.set("page", String(filters.page));
  else params.delete("page");

  const query = params.toString();
  const { pathname, hash } = window.location;
  const url = `${pathname}${query ? `?${query}` : ""}${hash}`;

  if (mode === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

export function pageOf<T>(items: T[], page: number, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(pages, Math.max(1, page));
  return {
    items: items.slice((current - 1) * size, current * size),
    current,
    pages,
  };
}
