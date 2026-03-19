const EMOJI_MAP: Record<string, string> = {
  ':robot_face:': '\u{1F916}',
  ':brain:': '\u{1F9E0}',
  ':chart_with_upwards_trend:': '\u{1F4C8}',
  ':mag:': '\u{1F50D}',
  ':books:': '\u{1F4DA}',
  ':hammer_and_wrench:': '\u{1F6E0}\u{FE0F}',
  ':speech_balloon:': '\u{1F4AC}',
  ':bulb:': '\u{1F4A1}',
  ':zap:': '\u{26A1}',
  ':gear:': '\u{2699}\u{FE0F}',
  ':shield:': '\u{1F6E1}\u{FE0F}',
  ':pencil:': '\u{270F}\u{FE0F}',
  ':bar_chart:': '\u{1F4CA}',
  ':rocket:': '\u{1F680}',
  ':star:': '\u{2B50}',
  ':fire:': '\u{1F525}',
  ':eyes:': '\u{1F440}',
  ':memo:': '\u{1F4DD}',
  ':lock:': '\u{1F512}',
  ':key:': '\u{1F511}',
  ':globe_with_meridians:': '\u{1F310}',
  ':package:': '\u{1F4E6}',
  ':link:': '\u{1F517}',
  ':clipboard:': '\u{1F4CB}',
  ':newspaper:': '\u{1F4F0}',
  ':microscope:': '\u{1F52C}',
  ':dart:': '\u{1F3AF}',
  ':trophy:': '\u{1F3C6}',
  ':money_with_wings:': '\u{1F4B8}',
  ':alarm_clock:': '\u{23F0}',
  ':seedling:': '\u{1F331}',
  ':handshake:': '\u{1F91D}',
  ':loudspeaker:': '\u{1F4E2}',
};

export function renderEmoji(code: string): string {
  if (!code) return '\u{1F916}';
  // Already a unicode emoji
  if (!code.startsWith(':')) return code;
  return EMOJI_MAP[code] || code.replace(/:/g, '');
}
