import { REACT_APP_SERVER_BASE_URL } from '~/config';

describe('frontend local configuration', () => {
  it('uses the migrated backend origin by default', () => {
    expect(REACT_APP_SERVER_BASE_URL).toBe('http://localhost:2000');
  });
});
