// URL の著者 ID と記事の各パス部分に共通する規則
export const validIdentifier = (value: string) => /^[A-Za-z0-9-]+$/.test(value);

export const duplicateOf = (seen: Map<string, string>, value: string, original = value) => {
  const identity = value.toLowerCase();
  const previous = seen.get(identity);
  if (previous === undefined) seen.set(identity, original);
  return previous;
};
