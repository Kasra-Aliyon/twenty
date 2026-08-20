import { readFileSync } from 'fs';
import { join } from 'path';

describe('MetadataGraphQLApiModule', () => {
  it('includes the sequence module so sequence metadata resolvers are exposed', () => {
    const moduleSource = readFileSync(
      join(__dirname, '..', 'metadata-graphql-api.module.ts'),
      'utf8',
    );

    expect(moduleSource).toContain(
      "import { SequenceModule } from 'src/modules/sequence/sequence.module';",
    );
    expect(moduleSource).toMatch(
      /imports:\s*\[[\s\S]*MetadataEngineModule,\s*SequenceModule,\s*\]/,
    );
  });
});
