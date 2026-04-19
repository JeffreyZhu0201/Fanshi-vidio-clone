const mentionPattern = /([@#])([\p{L}\p{N}_-]+)/gu;

const tokenizePrompt = (value = '') => {
  const tokens = [];
  let cursor = 0;

  for (const match of value.matchAll(mentionPattern)) {
    const matchIndex = match.index ?? 0;

    if (matchIndex > cursor) {
      tokens.push({
        type: 'text',
        value: value.slice(cursor, matchIndex)
      });
    }

    const marker = match[1];

    tokens.push({
      type: marker === '#' ? 'scene-mention' : 'character-mention',
      value: match[0],
      marker,
      name: match[2]
    });

    cursor = matchIndex + match[0].length;
  }

  if (cursor < value.length) {
    tokens.push({
      type: 'text',
      value: value.slice(cursor)
    });
  }

  if (!tokens.length) {
    return [
      {
        type: 'text',
        value
      }
    ];
  }

  return tokens;
};

const extractMentionNames = (value = '') => {
  return tokenizePrompt(value)
    .filter((token) => token.type === 'character-mention' || token.type === 'scene-mention')
    .map((token) => token.name);
};

const countPromptCharacters = (value = '') => {
  return value.replace(/\s+/g, ' ').trim().length;
};

export { tokenizePrompt, extractMentionNames, countPromptCharacters };
