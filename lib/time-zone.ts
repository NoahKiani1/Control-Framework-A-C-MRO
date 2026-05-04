type ZonedDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second?: number;
  millisecond?: number;
  timeZone: string;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterForTimeZone(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

function timeZoneOffsetMs(timeZone: string, instant: Date): number {
  const values = Object.fromEntries(
    formatterForTimeZone(timeZone)
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );

  const zonedAsUtcMs = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );

  return zonedAsUtcMs - instant.getTime();
}

export function zonedDateTimeToUtcIso({
  year,
  month,
  day,
  hour,
  minute,
  second = 0,
  millisecond = 0,
  timeZone,
}: ZonedDateTimeParts): string {
  const localAsUtcMs = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    second,
    millisecond,
  );
  let utcMs = localAsUtcMs - timeZoneOffsetMs(timeZone, new Date(localAsUtcMs));

  // Re-read the offset at the resolved instant so DST boundaries settle correctly.
  utcMs = localAsUtcMs - timeZoneOffsetMs(timeZone, new Date(utcMs));

  return new Date(utcMs).toISOString();
}
