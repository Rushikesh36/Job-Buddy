import type { ChatMessage } from '../lib/types';

function formatConversation(messages: ChatMessage[]): string {
  return messages
    .map((message) => {
      const role = message.role === 'assistant' ? 'Assistant' : 'User';
      return `${role}: ${message.content}`;
    })
    .join('\n\n');
}

export function buildConversationSummaryPrompt(messages: ChatMessage[]): string {
  return `Summarize this conversation in 2-3 sentences. Focus on:
- What job/company was discussed
- What content was generated (email, cover letter, analysis)
- Any preferences the user expressed (tone, style, projects to highlight)
- Key decisions or outcomes

Conversation:
${formatConversation(messages)}`;
}
