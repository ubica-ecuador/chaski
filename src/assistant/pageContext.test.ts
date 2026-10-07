import { providePageContext, provideQuestions } from '@grafana/assistant';

import { assistantQuestions, buildContextItems, dashboardPattern, registerAssistant } from './pageContext';

jest.mock('@grafana/assistant', () => ({
  createAssistantContextItem: (type: string, params: object) => ({ type, ...params }),
  providePageContext: jest.fn(),
  provideQuestions: jest.fn(),
}));

const digest = { dashboard: 'abc-1', datasets: [] };

describe('dashboardPattern', () => {
  it('matches only that dashboard', () => {
    const pattern = dashboardPattern('abc-1');
    expect(pattern.test('/d/abc-1/sales')).toBe(true);
    expect(pattern.test('/d/abc-1')).toBe(true);
    expect(pattern.test('/d/abc-1?orgId=1')).toBe(true);
    expect(pattern.test('/d/abc-12/other')).toBe(false);
    expect(pattern.test('/d/xyz/other')).toBe(false);
  });

  it('escapes the uid', () => {
    expect(dashboardPattern('a.b').test('/d/aXb/x')).toBe(false);
  });
});

describe('registerAssistant', () => {
  it('registers the digest and the questions on the dashboard, and unregisters both', () => {
    const unregisterContext = jest.fn();
    const unregisterQuestions = jest.fn();
    (providePageContext as jest.Mock).mockReturnValue(Object.assign(jest.fn(), { unregister: unregisterContext }));
    (provideQuestions as jest.Mock).mockReturnValue(Object.assign(jest.fn(), { unregister: unregisterQuestions }));

    const unregister = registerAssistant(digest);

    const [pattern, items] = (providePageContext as jest.Mock).mock.calls[0];
    expect(pattern.test('/d/abc-1/x')).toBe(true);
    expect(pattern.test('/d/other/x')).toBe(false);
    expect(items).toEqual(buildContextItems(digest));
    expect((provideQuestions as jest.Mock).mock.calls[0][0]).toBe(pattern);
    expect((provideQuestions as jest.Mock).mock.calls[0][1]).toEqual(assistantQuestions());
    unregister();
    expect(unregisterContext).toHaveBeenCalled();
    expect(unregisterQuestions).toHaveBeenCalled();
  });
});

it('titles the item and carries the digest as data', () => {
  expect(buildContextItems(digest)).toEqual([
    { type: 'structured', title: 'Chaski datasets (live)', bypassLimits: false, data: digest },
  ]);
});
