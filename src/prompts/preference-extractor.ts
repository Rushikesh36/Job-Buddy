import type { ChatMessage } from '../lib/types';

function formatConversation(messages: ChatMessage[]): string {
  return messages
    .map((message) => {
      const role = message.role === 'assistant' ? 'Assistant' : 'User';
      return `${role}: ${message.content}`;
    })
    .join('\n\n');
}

export function buildPreferenceExtractionPrompt(messages: ChatMessage[]): string {
  return `Based on this conversation, extract any user preferences about how they like content generated. Return as JSON array:
[
  {"key": "email_tone", "value": "concise, under 150 words"},
  {"key": "highlight_project", "value": "MedPod for healthcare roles"}
]
If no clear preferences, return empty array [].
Return only JSON.

Conversation:
${formatConversation(messages)}`;
}
