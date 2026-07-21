import { renderSequenceTemplate } from 'src/modules/sequence/utils/render-sequence-template.util';

describe('renderSequenceTemplate', () => {
  it('replaces repeated macros and accepts whitespace around variable names', () => {
    expect(
      renderSequenceTemplate(
        'Hi {{ firstName }}, {{firstName}} from {{ companyName }}',
        { firstName: 'Ada', companyName: 'Analytical Engines' },
        { escapeValues: false },
      ),
    ).toBe('Hi Ada, Ada from Analytical Engines');
  });

  it('escapes HTML-sensitive values for message bodies', () => {
    expect(
      renderSequenceTemplate(
        '<p>{{value}}</p>',
        { value: `<Tom & Jerry's \"team\">` },
        { escapeValues: true },
      ),
    ).toBe('<p>&lt;Tom &amp; Jerry&#39;s &quot;team&quot;&gt;</p>');
  });

  it('preserves raw values when escaping is disabled', () => {
    expect(
      renderSequenceTemplate(
        '{{value}}',
        { value: '<strong>Ada</strong>' },
        {
          escapeValues: false,
        },
      ),
    ).toBe('<strong>Ada</strong>');
  });

  it('replaces unknown valid macros with an empty string', () => {
    expect(
      renderSequenceTemplate(
        'Hello {{known}} {{unknown}}',
        { known: 'Ada' },
        { escapeValues: false },
      ),
    ).toBe('Hello Ada ');
  });

  it('leaves malformed or unsupported macro names unchanged', () => {
    expect(
      renderSequenceTemplate(
        '{{123name}} {{first-name}} {{}}',
        {},
        { escapeValues: false },
      ),
    ).toBe('{{123name}} {{first-name}} {{}}');
  });
});
