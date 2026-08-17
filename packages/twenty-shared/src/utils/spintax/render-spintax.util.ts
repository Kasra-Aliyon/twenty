type SpintaxGroup = {
  start: number;
  end: number;
  alternatives: string[];
};

export type SpintaxValidationResult =
  | { isValid: true }
  | { isValid: false; error: string };

const isEscaped = (value: string, index: number): boolean => {
  let precedingBackslashCount = 0;

  for (
    let characterIndex = index - 1;
    characterIndex >= 0 && value[characterIndex] === '\\';
    characterIndex -= 1
  ) {
    precedingBackslashCount += 1;
  }

  return precedingBackslashCount % 2 === 1;
};

const findTemplateVariableEnd = (
  value: string,
  start: number,
): number | null => {
  for (let index = start + 2; index < value.length - 1; index += 1) {
    if (
      value[index] === '}' &&
      value[index + 1] === '}' &&
      !isEscaped(value, index)
    ) {
      return index + 1;
    }
  }

  return null;
};

const splitAlternatives = (value: string): string[] => {
  const alternatives: string[] = [];
  let segmentStart = 0;
  let braceDepth = 0;

  for (let index = 0; index < value.length; index += 1) {
    if (isEscaped(value, index)) {
      continue;
    }

    if (value[index] === '{' && value[index + 1] === '{') {
      const variableEnd = findTemplateVariableEnd(value, index);

      if (variableEnd !== null) {
        index = variableEnd;
        continue;
      }
    }

    if (value[index] === '{') {
      braceDepth += 1;
      continue;
    }

    if (value[index] === '}' && braceDepth > 0) {
      braceDepth -= 1;
      continue;
    }

    if (value[index] === '|' && braceDepth === 0) {
      alternatives.push(value.slice(segmentStart, index));
      segmentStart = index + 1;
    }
  }

  if (alternatives.length === 0) {
    return [value];
  }

  alternatives.push(value.slice(segmentStart));

  return alternatives;
};

const findInnermostSpintaxGroup = (value: string): SpintaxGroup | null => {
  const openingBraceIndexes: number[] = [];

  for (let index = 0; index < value.length; index += 1) {
    if (isEscaped(value, index)) {
      continue;
    }

    if (value[index] === '{' && value[index + 1] === '{') {
      const variableEnd = findTemplateVariableEnd(value, index);

      if (variableEnd !== null) {
        index = variableEnd;
        continue;
      }
    }

    if (value[index] === '{') {
      openingBraceIndexes.push(index);
      continue;
    }

    if (value[index] !== '}' || openingBraceIndexes.length === 0) {
      continue;
    }

    const start = openingBraceIndexes.pop();

    if (start === undefined) {
      continue;
    }

    const alternatives = splitAlternatives(value.slice(start + 1, index));

    if (alternatives.length > 1) {
      return { start, end: index, alternatives };
    }
  }

  return null;
};

const hashString = (value: string): number => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
};

const unescapeSpintaxCharacters = (value: string): string => {
  let result = '';

  for (let index = 0; index < value.length; index += 1) {
    if (
      value[index] === '\\' &&
      index + 1 < value.length &&
      ['\\', '{', '}', '|'].includes(value[index + 1])
    ) {
      result += value[index + 1];
      index += 1;
      continue;
    }

    result += value[index];
  }

  return result;
};

export const validateSpintax = (template: string): SpintaxValidationResult => {
  const openingGroups: Array<{
    index: number;
    hasAlternativeSeparator: boolean;
  }> = [];
  const unexpectedClosingBraceIndexes: number[] = [];
  const unexpectedAlternativeSeparatorIndexes: number[] = [];
  let hasCompletedSpintaxGroup = false;

  for (let index = 0; index < template.length; index += 1) {
    if (isEscaped(template, index)) {
      continue;
    }

    if (template[index] === '{' && template[index + 1] === '{') {
      const variableEnd = findTemplateVariableEnd(template, index);

      if (variableEnd !== null) {
        index = variableEnd;
        continue;
      }
    }

    if (template[index] === '{') {
      openingGroups.push({ index, hasAlternativeSeparator: false });
      continue;
    }

    if (template[index] === '|') {
      if (openingGroups.length > 0) {
        openingGroups[openingGroups.length - 1].hasAlternativeSeparator = true;
      } else {
        unexpectedAlternativeSeparatorIndexes.push(index);
      }

      continue;
    }

    if (template[index] === '}') {
      const completedGroup = openingGroups.pop();

      if (completedGroup === undefined) {
        unexpectedClosingBraceIndexes.push(index);
      } else if (completedGroup.hasAlternativeSeparator) {
        hasCompletedSpintaxGroup = true;
      }
    }
  }

  const unclosedSpintaxGroup = openingGroups.find(
    ({ hasAlternativeSeparator }) => hasAlternativeSeparator,
  );

  if (unclosedSpintaxGroup !== undefined) {
    return {
      isValid: false,
      error: `Spintax group at character ${unclosedSpintaxGroup.index + 1} is missing a closing brace.`,
    };
  }

  const hasAttemptedSpintax =
    hasCompletedSpintaxGroup ||
    (unexpectedAlternativeSeparatorIndexes.length > 0 &&
      (openingGroups.length > 0 || unexpectedClosingBraceIndexes.length > 0));
  const unclosedOpeningBrace = openingGroups[0];

  if (hasAttemptedSpintax && unclosedOpeningBrace !== undefined) {
    return {
      isValid: false,
      error: `Opening brace at character ${unclosedOpeningBrace.index + 1} is missing a closing brace. Escape it as \\{ if it is literal.`,
    };
  }

  const unexpectedClosingBraceIndex = unexpectedClosingBraceIndexes[0];

  if (hasAttemptedSpintax && unexpectedClosingBraceIndex !== undefined) {
    return {
      isValid: false,
      error: `Unexpected closing brace at character ${unexpectedClosingBraceIndex + 1}. Escape it as \\} if it is literal.`,
    };
  }

  return { isValid: true };
};

export const renderSpintax = (template: string, seed: string): string => {
  let rendered = template;
  let groupIndex = 0;

  for (;;) {
    const group = findInnermostSpintaxGroup(rendered);

    if (group === null) {
      return unescapeSpintaxCharacters(rendered);
    }

    const selectedAlternativeIndex =
      hashString(
        `${seed}:${groupIndex}:${rendered.slice(group.start, group.end + 1)}`,
      ) % group.alternatives.length;

    rendered =
      rendered.slice(0, group.start) +
      group.alternatives[selectedAlternativeIndex] +
      rendered.slice(group.end + 1);
    groupIndex += 1;
  }
};
