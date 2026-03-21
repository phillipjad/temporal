import { useState } from "react";

const CONFIRM_PHRASE = "I understand the risks of real money trading";

interface Props {
  currentStatus: boolean;
  onToggle: (status: boolean) => void;
}

export function AutoTradingToggle({ currentStatus, onToggle }: Props) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [inputText, setInputText] = useState("");

  const handleStartEnable = () => {
    setIsConfirming(true);
    setInputText("");
  };

  const handleConfirm = () => {
    if (inputText === CONFIRM_PHRASE) {
      onToggle(true);
      setIsConfirming(false);
    }
  };

  const handleDisable = () => {
    onToggle(false);
    setIsConfirming(false);
  };

  if (currentStatus) {
    return (
      <div className="p-4 border border-red-500 rounded-md bg-red-50 dark:bg-red-900/10">
        <h3 className="font-semibold text-red-600">Auto-Trading is LIVE</h3>
        <p className="text-sm text-red-500 mb-4">
          Real orders will be executed on Kalshi.
        </p>
        <button
          onClick={handleDisable}
          className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
        >
          Disable Auto-Trading
        </button>
      </div>
    );
  }

  if (isConfirming) {
    return (
      <div className="p-4 border border-yellow-500 rounded-md bg-yellow-50 dark:bg-yellow-900/10">
        <p className="mb-2 text-sm text-yellow-800 dark:text-yellow-200">
          Type exactly <strong>"{CONFIRM_PHRASE}"</strong> to enable live
          auto-trading.
        </p>
        <input
          type="text"
          className="w-full p-2 border border-gray-300 rounded mb-2 text-black"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={CONFIRM_PHRASE}
        />
        <div className="flex gap-2">
          <button
            disabled={inputText !== CONFIRM_PHRASE}
            onClick={handleConfirm}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Confirm & Enable
          </button>
          <button
            onClick={() => setIsConfirming(false)}
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 border border-gray-200 rounded-md dark:border-gray-800">
      <h3 className="font-semibold text-gray-600 dark:text-gray-400">
        Auto-Trading is DISABLED
      </h3>
      <p className="text-sm text-gray-500 mb-4">
        You are currently in simulated paper-trading mode.
      </p>
      <button
        onClick={handleStartEnable}
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        Enable Auto-Trading
      </button>
    </div>
  );
}
