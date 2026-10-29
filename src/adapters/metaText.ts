// Meta exports (Facebook and Instagram) write UTF-8 text as Latin-1 escapes, so
// "Let’s" arrives as "Letâ\u0080\u0099s". This restores the original text.
export function fixMetaEncoding<T>(value: T): T {
  if (typeof value === 'string') {
    if (!/[\u0080-ÿ]/.test(value) || /[^\u0000-ÿ]/.test(value)) return value;
    const decoded = Buffer.from(value, 'latin1').toString('utf8');
    return (decoded.includes('�') ? value : decoded) as T;
  }
  if (Array.isArray(value)) return value.map(fixMetaEncoding) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fixMetaEncoding(item)])) as T;
  }
  return value;
}
