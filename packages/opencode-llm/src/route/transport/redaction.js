const REDACTED = '<redacted>';
const SENSITIVE_QUERY_NAME =
  /(?:authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|token|secret|credential|signature|x-amz-signature)|^(?:key|sig)$/i;
const URL_TOKEN = /(?:https?|wss?):\/\/[^\s"'<>]+/gi;

const splitTrailingPunctuation = (value) => {
  const match = /[),.;]+$/.exec(value);
  if (!match) return [value, ''];
  return [value.slice(0, -match[0].length), match[0]];
};

export const redactTransportUrl = (value) => {
  if (!URL.canParse(value)) return REDACTED;
  const url = new URL(value);
  url.searchParams.forEach((_queryValue, key) => {
    if (SENSITIVE_QUERY_NAME.test(key)) url.searchParams.set(key, REDACTED);
  });
  return url.toString();
};

export const redactTransportText = (value, sourceUrl) => {
  const redactedUrls = value.replace(URL_TOKEN, (candidate) => {
    const [url, trailingPunctuation] = splitTrailingPunctuation(candidate);
    return `${redactTransportUrl(url)}${trailingPunctuation}`;
  });

  if (sourceUrl === undefined || !URL.canParse(sourceUrl)) return redactedUrls;
  const source = new URL(sourceUrl);
  return Array.from(source.searchParams.entries()).reduce((text, [key, queryValue]) => {
    if (!SENSITIVE_QUERY_NAME.test(key) || queryValue.length === 0) return text;
    return [queryValue, encodeURIComponent(queryValue)].reduce(
      (next, secret) => next.split(secret).join(REDACTED),
      text,
    );
  }, redactedUrls);
};
