import { getInitialEditorContent } from '@/workflow/workflow-variables/utils/getInitialEditorContent';
import type { JSONContent } from '@tiptap/react';
import { logError } from '~/utils/logError';

// JSON-backed editor fields used to contain plain text, so parsing may fail.
// HTML-backed fields remain raw HTML and bypass that migration fallback.
export const getInitialAdvancedTextEditorContent = (
  rawContent: string,
  contentType: 'json' | 'html' = 'json',
): JSONContent | string => {
  if (contentType === 'html') {
    return rawContent;
  }

  // Handle empty or null content
  if (!rawContent || rawContent.trim() === '') {
    return {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [],
        },
      ],
    };
  }

  try {
    const json = JSON.parse(rawContent);

    // Handle BlockNote array format (wrap in doc structure for TipTap)
    if (Array.isArray(json)) {
      return {
        type: 'doc',
        content: json,
      };
    }

    return json;
  } catch (error) {
    logError(error);
    return getInitialEditorContent(rawContent);
  }
};
