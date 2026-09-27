import { describe, expect, it } from 'vite-plus/test';
import { accessConfigIssues } from '../src/config';

describe('accessConfigIssues', () => {
  it('accepts OIDC and GitHub providers with each kind of rule', () => {
    expect(
      accessConfigIssues(
        {
          providers: [
            {
              id: 'pocket-id',
              name: 'Pocket ID',
              issuer: 'https://id.example.com',
              clientId: 'abc',
            },
            { id: 'github', name: 'GitHub', type: 'github', clientId: 'def' },
          ],
          operators: ['me@example.com', 'group:admins'],
          members: ['*@example.com', 'github:octo-cat'],
          audiences: { acme: { members: ['*@acme.example'], groups: ['Acme'] } },
        },
        ['Acme'],
      ),
    ).toEqual([]);
  });

  it('names each problem by its path', () => {
    expect(
      accessConfigIssues(
        {
          providers: [{ id: 'bad id', name: 'X', issuer: 'ftp://id.example.com', clientId: 'a' }],
          operators: ['everyone'],
        },
        [],
      ),
    ).toEqual([
      'access.providers.0.id: provider id must match ^[A-Za-z0-9_-]{1,32}$',
      'access.providers.0.issuer: issuer must be an http(s) URL',
      'access.operators.0: access rules are an email, *@domain, group:<name> or github:<login>',
    ]);
  });

  it('rejects two providers with the same id, whatever the case', () => {
    expect(
      accessConfigIssues(
        {
          providers: [
            { id: 'github', name: 'A', type: 'github', clientId: 'a' },
            { id: 'GitHub', name: 'B', type: 'github', clientId: 'b' },
          ],
        },
        [],
      ),
    ).toEqual(['access: provider ids must be unique']);
  });

  it('names an audience group the page does not have', () => {
    expect(
      accessConfigIssues(
        { audiences: { acme: { members: ['*@acme.example'], groups: ['Acme', 'Acne'] } } },
        ['Acme', 'APIs'],
      ),
    ).toEqual(['access.audiences.acme: no page group is named "Acne"']);
  });
});
