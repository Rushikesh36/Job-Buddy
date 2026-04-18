import type { GoogleAuthState } from '../../lib/types';

interface GoogleConnectButtonProps {
  authState: GoogleAuthState;
  isBusy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

export default function GoogleConnectButton({
  authState,
  isBusy,
  onConnect,
  onDisconnect,
}: GoogleConnectButtonProps) {
  if (authState.isConnected) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-3 py-2">
          <div className="text-xs text-green-800">
            <p className="font-medium">Connected to Google</p>
            <p className="text-green-700">{authState.email ?? 'Email unavailable'}</p>
          </div>
          <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">
            Active
          </span>
        </div>

        <button
          onClick={onDisconnect}
          disabled={isBusy}
          className={`w-full rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
            isBusy
              ? 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400'
              : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
          }`}
        >
          {isBusy ? 'Disconnecting...' : 'Disconnect Google Account'}
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={onConnect}
      disabled={isBusy}
      className={`w-full rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
        isBusy
          ? 'cursor-not-allowed bg-gray-100 text-gray-400'
          : 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
      }`}
    >
      {isBusy ? 'Connecting...' : 'Connect Google Account'}
    </button>
  );
}
