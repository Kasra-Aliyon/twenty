import { renderApolloPlayground } from '../render-apollo-playground.util';

describe('renderApolloPlayground', () => {
  it('derives the GraphQL endpoint from the current server origin', () => {
    const playground = renderApolloPlayground({ path: 'metadata' });

    expect(playground).toContain(
      'new URL("/metadata", window.location.origin).toString()',
    );
    expect(playground).not.toContain('http://localhost:');
  });
});
