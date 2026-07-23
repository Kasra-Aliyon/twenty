import {
  formatToolError,
  formatToolResult,
  formatToolResultTesting,
} from '../format-tool-result.js';

describe('tool result formatting', () => {
  it('renders compact record labels in markdown', () => {
    const markdown = formatToolResultTesting.toMarkdown([
      {
        id: 'person-1',
        name: { firstName: 'Ada', lastName: 'Lovelace' },
        city: 'London',
      },
    ]);

    expect(markdown).toContain('- Ada Lovelace (person-1)');
    expect(markdown).toContain('city: London');
  });

  it('returns structured content and an explicit truncation hint', () => {
    const result = formatToolResult({ records: ['a'.repeat(100)] }, 'json', 30);

    expect(result.content[0]).toMatchObject({ type: 'text' });
    expect(
      result.content[0]?.type === 'text' && result.content[0].text,
    ).toContain('Truncated at 30 characters');
    expect(result.structuredContent).toMatchObject({ truncated: true });
  });

  it('marks failures as MCP tool errors', () => {
    const result = formatToolError(new Error('boom'));

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      result: { error: 'boom' },
    });
  });
});
