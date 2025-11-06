import { useState, KeyboardEvent } from 'react';

interface MessageComposerProps {
  onSendMessage: (text: string) => void;
  disabled?: boolean;
}

export default function MessageComposer({
  onSendMessage,
  disabled = false,
}: MessageComposerProps) {
  const [message, setMessage] = useState('');

  const handleSend = () => {
    if (message.trim() && !disabled) {
      onSendMessage(message.trim());
      setMessage('');
    }
  };

  const handleKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="p-4 border-t border-gray-700 bg-gray-800">
      <div className="flex items-center space-x-2">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder={disabled ? 'Select a conversation...' : 'Type a message...'}
          disabled={disabled}
          className="flex-1 p-3 rounded bg-gray-700 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={disabled || !message.trim()}
          className="px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Send
        </button>
      </div>
      <p className="text-xs text-gray-500 mt-2">
        🔒 End-to-end encrypted • Only you and the recipient can read these messages
      </p>
    </div>
  );
}
