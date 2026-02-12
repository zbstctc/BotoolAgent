'use client';

export interface ErrorAction {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
}

export interface ErrorRecoveryProps {
  error: string;
  diagnosis?: string;
  actions: ErrorAction[];
}

export function ErrorRecovery({ error, diagnosis, actions }: ErrorRecoveryProps) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
          <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-red-800">{error}</p>
          {diagnosis && (
            <p className="text-xs text-red-600 mt-1">{diagnosis}</p>
          )}
          {actions.length > 0 && (
            <div className="flex items-center gap-2 mt-3">
              {actions.map((action, i) => (
                <button
                  key={i}
                  onClick={action.onClick}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    action.variant === 'primary'
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : 'bg-white text-red-700 border border-red-300 hover:bg-red-100'
                  }`}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
