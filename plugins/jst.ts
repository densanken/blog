// Date または ISO 8601 の日時や日付を日本時間の日付（YYYY-MM-DD）にする（求められなければ空文字）
export const jstDate = (value: unknown): string => {
  if (typeof value !== "string" && !(value instanceof Date)) return "";
  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value);
    if (match) {
      const calendarDay = match[0].slice(0, 10);
      const calendar = new Date(`${calendarDay}T00:00:00Z`);
      if (Number.isNaN(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== calendarDay) return "";
    }
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(date);
};

// 日本時間の今日の日付
export const today = () => jstDate(new Date());

// 記事の公開日として日付だけを受け付ける
export const postDate = (value: unknown) => {
  const date = typeof value === "string" ? value : jstDate(value);
  return /^\d{4}-\d\d-\d\d$/.test(date) && jstDate(date) ? date : "";
};
