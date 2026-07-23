import { getInitialAdvancedTextEditorContent } from '@/workflow/workflow-variables/utils/getInitialAdvancedTextEditorContent';

describe('getInitialAdvancedTextEditorContent', () => {
  it('should return raw HTML when content type is HTML', () => {
    const content = '<p>Hi {{firstName}}</p>';

    expect(getInitialAdvancedTextEditorContent(content, 'html')).toBe(content);
  });

  it('should parse serialized editor JSON when content type is JSON', () => {
    const content = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [] }],
    };

    expect(
      getInitialAdvancedTextEditorContent(JSON.stringify(content), 'json'),
    ).toEqual(content);
  });
});
