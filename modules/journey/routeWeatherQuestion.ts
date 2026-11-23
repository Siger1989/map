import { journeyInstant, localMinute } from '../sky/journeyClock.ts';

const DAY = 86_400_000;
const DEFAULT_HOURS = [7, 9, 11];

const chineseDigits = '零一二三四五六七八九';
const number = '[0-9零〇一二两三四五六七八九十]+';
const relativeDays: Record<string, number> = {
  今晚: 0, 今早: 0, 今晨: 0, 今日: 0, 今天: 0,
  明早: 1, 明晚: 1, 明晨: 1, 明日: 1, 明天: 1,
  后天: 2, 大后天: 3,
};

const datePattern = `(?<relative>${Object.keys(relativeDays).sort((a, b) => b.length - a.length).join('|')})`
  + '|(?:(?<year>\\d{4})年\\s*)?(?<month>\\d{1,2})月\\s*(?<day>\\d{1,2})[日号]'
  + '|(?<isoYear>\\d{4})[-/](?<isoMonth>\\d{1,2})[-/](?<isoDay>\\d{1,2})';
const periodPattern = '凌晨|早上|早晨|清晨|上午|中午|下午|傍晚|晚上|夜里|夜间';
const timePattern = `(?:(?<period>${periodPattern})\\s*)?(?<hour>${number})\\s*`
  + `(?::(?<colonMinute>\\d+)|[点时](?:(?<fraction>半|一刻|三刻)|(?<namedMinute>${number})分?)?)`;
const unsupportedDate = /周末|下周|上周|下个?月|下个?星期|下个?礼拜|[周星期礼拜][一二三四五六日天末]|昨天|昨晚|前天|[0-9零〇一二两三四五六七八九十]+\s*天[之以]?[后前]|\d+\s*[月日号]|\d+[/-]\d+|月底|月初|下旬|上旬|中旬|大大后天|明年|后年/;
const unsupportedTime = /\d+\s*[:点时]|[零〇一二两三四五六七八九十]+\s*[点时]|过一会|等会|小时[后内]|现在出发|马上出发/;

function readNumber(value: string) {
  if (/^\d+$/.test(value)) return Number(value);
  const digits = (text: string) => Number([...text].map((char) =>
    char === '两' ? 2 : char === '〇' ? 0 : chineseDigits.indexOf(char),
  ).join(''));
  if (!value.includes('十')) return digits(value);
  if (value.indexOf('十') !== value.lastIndexOf('十')) return NaN;
  const [tens, ones] = value.split('十');
  return (tens ? digits(tens) : 1) * 10 + (ones ? digits(ones) : 0);
}

function readCalendarDay(groups: Record<string, string | undefined>, today: number) {
  const year = Number(groups.year ?? groups.isoYear ?? new Date(today).getUTCFullYear());
  const month = Number(groups.month ?? groups.isoMonth);
  const day = Number(groups.day ?? groups.isoDay);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.getTime()
    : NaN;
}

function to24Hour(hour: number, period: string) {
  if (!period || hour > 12) return hour;
  if (/下午|傍晚|晚上|夜里|夜间/.test(period)) return hour < 12 && hour !== 0 ? hour + 12 : hour;
  if (period === '中午' && hour <= 2) return hour + 12;
  if (/凌晨|早上|早晨|清晨|上午/.test(period) && hour === 12) return 0;
  return hour;
}

export function parseRouteWeatherQuestion(
  message: string,
  referenceTime = Date.now(),
  contextDeparture?: number,
  zone = 'Asia/Shanghai',
): { departures: number[]; error?: string } {
  const input = message.normalize('NFKC').trim();
  const tokenPattern = new RegExp(`${datePattern}|${timePattern}`, 'g');
  const tokens = [...input.matchAll(tokenPattern)];
  const rest = input.replace(tokenPattern, '');
  if (unsupportedDate.test(rest) || /大大后天/.test(input)) {
    return { departures: [], error: '请用今天、明天、后天或具体日期，例如 11月26日。' };
  }
  if (unsupportedTime.test(rest) || /[0-9]:[0-9]+:/.test(input)) {
    return { departures: [], error: '请填写具体出发时间，例如明早7点半。' };
  }

  let today: number;
  let date: number;
  try {
    today = Date.parse(localMinute(referenceTime, zone).slice(0, 10));
    date = contextDeparture === undefined ? today : Date.parse(localMinute(contextDeparture, zone).slice(0, 10));
  } catch {
    return { departures: [], error: '无法确定出发地的日期或时区。' };
  }
  let period = '';
  let explicitDate = false;
  let timeOnDate = false;
  const departures: number[] = [];

  const toInstant = (hour: number, minute: number) => {
    const day = new Date(date).toISOString().slice(0, 10);
    return journeyInstant(`${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, zone);
  };

  const addDefaultHours = (textAfterDate: string) => {
    const hours = /晚|夜/.test(period) || /傍晚|晚上|夜间|夜里/.test(textAfterDate) ? [18, 20, 22]
      : /下午/.test(textAfterDate) ? [13, 15, 17]
      : /中午/.test(textAfterDate) ? [11, 12, 13]
      : /凌晨/.test(textAfterDate) ? [1, 3, 5]
      : DEFAULT_HOURS;
    for (const hour of hours) {
      const departure = toInstant(hour, 0);
      if (departure !== null && departure >= referenceTime) departures.push(departure);
    }
  };

  let dateEnd = 0;
  for (const token of tokens) {
    const groups = token.groups ?? {};
    const { relative, month, isoMonth } = groups;
    if (relative || month || isoMonth) {
      if (explicitDate && !timeOnDate) addDefaultHours(input.slice(dateEnd, token.index));
      date = relative ? today + relativeDays[relative] * DAY : readCalendarDay(groups, today);
      if (!Number.isFinite(date)) return { departures: [], error: '请检查出发日期。' };
      if (date < today) return { departures: [], error: '指定的出发日期已过，请选择稍后的日期。' };
      dateEnd = token.index + token[0].length;
      period = relative?.endsWith('晚') ? '晚上' : relative?.endsWith('晨') || relative?.endsWith('早') ? '早上' : '';
      explicitDate = true;
      timeOnDate = false;
      continue;
    }

    timeOnDate = true;
    period = groups.period ?? period;
    const hour = to24Hour(readNumber(groups.hour), period);
    const minuteText = groups.colonMinute ?? groups.namedMinute;
    const minute = groups.fraction === '半' ? 30
      : groups.fraction === '一刻' ? 15
      : groups.fraction === '三刻' ? 45
      : minuteText ? readNumber(minuteText) : 0;
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
      return { departures: [], error: '请检查出发时间，小时应为 0–23，分钟应为 0–59。' };
    }

    const departure = toInstant(hour, minute);
    if (departure === null) return { departures: [], error: '出发地在该日期没有这个时刻，请换个时间。' };
    if (departure < referenceTime) return { departures: [], error: '指定的出发时间已过，请选择稍后的时间。' };
    departures.push(departure);
  }

  if (explicitDate && !timeOnDate) {
    const before = departures.length;
    addDefaultHours(input.slice(dateEnd));
    if (departures.length === before) {
      return { departures: [], error: '当天的推荐时段已过，请指定稍后的出发时间。' };
    }
  }

  return { departures: [...new Set(departures)].sort((a, b) => a - b) };
}
