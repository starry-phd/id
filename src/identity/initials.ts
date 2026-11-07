/**
 * Two letters for a member without a photo: the first letter of the family name and of the given name.
 * "John Smith" → "JS"; "王小明" → "王小" (family name, then the first character of the given name); one character stays.
 */
export function initialsOf(name: string | null | undefined): string {
  const text = (name ?? '').trim();
  if (!text) return '星';
  const parts = text.split(/\s+/).filter(Boolean);
  const chars = (s: string) => Array.from(s);
  if (parts.length >= 2) return (chars(parts[0]!)[0]! + chars(parts[parts.length - 1]!)[0]!).toUpperCase();
  const all = chars(parts[0]!);
  return (all.length >= 2 ? all[0]! + all[1]! : all[0]!).toUpperCase();
}
