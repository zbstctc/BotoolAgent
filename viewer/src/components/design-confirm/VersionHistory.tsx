'use client';

export interface Version {
  id: string;
  number: number;
  createdAt: string;
  description?: string;
}

interface VersionHistoryProps {
  versions: Version[];
  currentVersion: string;
  onVersionClick: (versionId: string) => void;
}

export function VersionHistory({
  versions,
  currentVersion,
  onVersionClick,
}: VersionHistoryProps) {
  if (versions.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 p-4 bg-neutral-50 border-b border-neutral-200">
      <span className="text-xs font-medium text-neutral-600">版本历史：</span>
      <div className="flex items-center gap-1">
        {versions.map((version, index) => (
          <div key={version.id} className="flex items-center">
            {index > 0 && (
              <div className="w-4 h-px bg-neutral-300 mx-1" />
            )}
            <button
              onClick={() => onVersionClick(version.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                version.id === currentVersion
                  ? 'bg-blue-600 text-white'
                  : 'bg-white border border-neutral-300 text-neutral-600 hover:border-blue-300 hover:bg-blue-50'
              }`}
              title={version.description || `版本 ${version.number}`}
            >
              v{version.number}
            </button>
          </div>
        ))}
      </div>
      {currentVersion && (
        <span className="ml-auto text-xs text-neutral-500">
          当前查看：v{versions.find(v => v.id === currentVersion)?.number || '?'}
        </span>
      )}
    </div>
  );
}
