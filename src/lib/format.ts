/**
 * 时间显示，统一用浏览器内置的 Intl，不引入日期库。
 */

/** 时刻，如 14:32 */
const TIME = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });

/** 月日，如 10月28日 */
const MONTH_DAY = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' });

/** 年月日，如 2025/10/28 */
const FULL_DATE = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });

/** 两个时间是否在本地时区的同一天 */
function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * 紧凑的时间：今天只显示时刻，昨天显示「昨天 时刻」，今年显示月日与时刻，更早只显示日期。
 *
 * @param iso 后端返回的 ISO 8601 时间
 * @param now 当前时间，测试时可传入
 */
export function formatTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  if (isSameDay(date, now)) {
    return TIME.format(date);
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) {
    return `昨天 ${TIME.format(date)}`;
  }
  if (date.getFullYear() === now.getFullYear()) {
    return `${MONTH_DAY.format(date)} ${TIME.format(date)}`;
  }
  return FULL_DATE.format(date);
}

/** 完整时间，用于悬停提示，如 2026/10/30 14:32:05 */
export function formatFullTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('zh-CN', { hour12: false });
}
