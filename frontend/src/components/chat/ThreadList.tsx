import { Conversation } from '../../types/message';

interface ThreadListProps {
  conversations: Conversation[];
  activeConversationId?: string;
  onSelectConversation: (conversationId: string) => void;
}

export default function ThreadList({
  conversations,
  activeConversationId,
  onSelectConversation,
}: ThreadListProps) {
  if (conversations.length === 0) {
    return (
      <div className="p-4 text-center text-gray-400">
        No conversations yet. Search for a user to start chatting!
      </div>
    );
  }

  return (
    <div className="overflow-y-auto">
      {conversations.map((conversation) => {
        const isActive = conversation.id === activeConversationId;
        const participant = conversation.participants[0]; // For direct messages

        return (
          <button
            key={conversation.id}
            onClick={() => onSelectConversation(conversation.id)}
            className={`w-full p-4 border-b border-gray-700 text-left hover:bg-gray-750 transition-colors ${
              isActive ? 'bg-gray-750' : ''
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-semibold text-white">
                {conversation.type === 'direct'
                  ? participant.displayName
                  : 'Group Chat'}
              </h3>
              {conversation.unreadCount > 0 && (
                <span className="bg-blue-600 text-white text-xs px-2 py-1 rounded-full">
                  {conversation.unreadCount}
                </span>
              )}
            </div>
            {conversation.lastMessage && (
              <p className="text-sm text-gray-400 truncate">
                {conversation.lastMessage.plaintext}
              </p>
            )}
            <p className="text-xs text-gray-500 mt-1">
              {new Date(conversation.lastMessageAt).toLocaleString()}
            </p>
          </button>
        );
      })}
    </div>
  );
}
