/** "14:30" today, "26/9 14:30" on another day (local time of the viewer). */
export function formatStart(ts: number, now = Date.now()) {
  const d = new Date(ts);
  const time = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const sameDay = new Date(now).toDateString() === d.toDateString();
  return sameDay ? time : `${d.getDate()}/${d.getMonth() + 1} ${time}`;
}

/** Value for <input type="datetime-local"> ↔ epoch ms, in local time. */
export const toLocalInput = (ts: number) => {
  const d = new Date(ts - new Date(ts).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};
export const fromLocalInput = (value: string) => (value ? new Date(value).getTime() : undefined);
