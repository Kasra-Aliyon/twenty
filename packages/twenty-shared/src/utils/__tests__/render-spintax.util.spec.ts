import { renderSpintax, validateSpintax } from '../spintax/render-spintax.util';

describe('spintax utilities', () => {
  it('renders the same variation for the same seed', () => {
    const template = '{Hi|Hello|Hey} {{ firstName }}, {quick|short} question';

    expect(renderSpintax(template, 'contact-1:step-1')).toBe(
      renderSpintax(template, 'contact-1:step-1'),
    );
    expect(renderSpintax(template, 'contact-1:step-1')).not.toContain('|');
    expect(renderSpintax(template, 'contact-1:step-1')).toContain(
      '{{ firstName }}',
    );
  });

  it('varies the selected alternative across recipient seeds', () => {
    const renderedGreetings = new Set(
      Array.from({ length: 50 }, (_, index) =>
        renderSpintax('{Hi|Hello}', `contact-${index}`),
      ),
    );

    expect(renderedGreetings).toEqual(new Set(['Hi', 'Hello']));
  });

  it('supports nested groups and escaped spintax characters', () => {
    const rendered = renderSpintax(
      String.raw`\{literal\} {Hello|{Hi|Hey}} \|`,
      'contact-2:step-1',
    );

    expect(rendered).toMatch(/^\{literal\} (Hello|Hi|Hey) \|$/);
  });

  it('leaves ordinary braces and template variables intact', () => {
    expect(
      renderSpintax('JSON { value: 1 } and {{ companyName }}', 'seed'),
    ).toBe('JSON { value: 1 } and {{ companyName }}');
  });

  it('reports an unclosed group that contains alternatives', () => {
    expect(validateSpintax('Hello {there|friend')).toEqual({
      isValid: false,
      error: 'Spintax group at character 7 is missing a closing brace.',
    });
  });

  it('reports an unexpected closing brace in a spintax template', () => {
    expect(validateSpintax('{Hi|Hello}}')).toEqual({
      isValid: false,
      error:
        'Unexpected closing brace at character 11. Escape it as \\} if it is literal.',
    });
  });

  it.each([
    [
      '{{Hi|Hello}',
      'Opening brace at character 1 is missing a closing brace. Escape it as \\{ if it is literal.',
    ],
    [
      '{Hi}|Hello}',
      'Unexpected closing brace at character 11. Escape it as \\} if it is literal.',
    ],
  ])('reports mismatched braces in %s', (template, error) => {
    expect(validateSpintax(template)).toEqual({ isValid: false, error });
  });

  it('accepts nested groups, variables, and escaped separators', () => {
    expect(
      validateSpintax(
        String.raw`{Hi {{ firstName }}|Hello {there|friend}|literal \| pipe}`,
      ),
    ).toEqual({ isValid: true });
  });
});
