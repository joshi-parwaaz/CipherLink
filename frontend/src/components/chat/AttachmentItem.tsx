interface AttachmentItemProps {
  filename: string;
  sizeBytes: number;
  mimeType: string;
  onDownload?: () => void;
  isUploading?: boolean;
}

export default function AttachmentItem({
  filename,
  sizeBytes,
  mimeType,
  onDownload,
  isUploading = false,
}: AttachmentItemProps) {
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileIcon = (mime: string): string => {
    if (mime.startsWith('image/')) return '🖼️';
    if (mime.startsWith('video/')) return '🎥';
    if (mime.startsWith('audio/')) return '🎵';
    if (mime.includes('pdf')) return '📄';
    return '📎';
  };

  return (
    <div className="flex items-center space-x-3 p-3 bg-gray-700 rounded-lg">
      <span className="text-2xl">{getFileIcon(mimeType)}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate">{filename}</p>
        <p className="text-xs text-gray-400">{formatSize(sizeBytes)}</p>
      </div>
      {isUploading ? (
        <div className="text-xs text-gray-400">Uploading...</div>
      ) : (
        onDownload && (
          <button
            onClick={onDownload}
            className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Download
          </button>
        )
      )}
    </div>
  );
}
