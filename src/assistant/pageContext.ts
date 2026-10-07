import {
  createAssistantContextItem,
  providePageContext,
  provideQuestions,
  type ChatContextItem,
  type Question,
} from '@grafana/assistant';

import type { AssistantDigest } from './digest';

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `/d/<uid>` and nothing else. Not `/\/d\//`: leaving for a dashboard on
 * another datasource fires no engine event, and the datasets must not follow
 * the user there. Unanchored, so it matches a pathname or a full URL alike.
 */
export function dashboardPattern(uid: string): RegExp {
  return new RegExp(`/d/${escapeRegExp(uid)}(?:[/?#]|$)`);
}

export function buildContextItems(digest: AssistantDigest): ChatContextItem[] {
  return [
    createAssistantContextItem('structured', {
      title: 'Chaski datasets (live)',
      bypassLimits: false,
      data: digest as unknown as Record<string, unknown>,
    }),
  ];
}

export function assistantQuestions(): Question[] {
  return [
    { title: 'What data is loaded?', prompt: 'What data does this dashboard load into Chaski, and how fresh is it?' },
    {
      title: 'Write a panel query',
      prompt: 'Write a Chaski panel query over one of the datasets on this dashboard, using its real columns.',
    },
  ];
}

/** Registers the digest and the starter questions for its dashboard; returns the unregister fn. */
export function registerAssistant(digest: AssistantDigest): () => void {
  const pattern = dashboardPattern(digest.dashboard);
  const context = providePageContext(pattern, buildContextItems(digest));
  const questions = provideQuestions(pattern, assistantQuestions());
  return () => {
    context.unregister();
    questions.unregister();
  };
}
