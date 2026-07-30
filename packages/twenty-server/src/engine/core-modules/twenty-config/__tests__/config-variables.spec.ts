import { ConfigVariables } from 'src/engine/core-modules/twenty-config/config-variables';

describe('ConfigVariables local defaults', () => {
  it('uses the migrated backend port and public URL', () => {
    const configVariables = new ConfigVariables();

    expect(configVariables.NODE_PORT).toBe(2000);
    expect(configVariables.SERVER_URL).toBe('http://localhost:2000');
  });
});
