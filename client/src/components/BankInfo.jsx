import React from 'react';
import { CreditCard, Copy } from 'lucide-react';

export default function BankInfo({ settings }) {
  const { bank_name, bank_account, bank_holder } = settings;
  if (!bank_name && !bank_account) return null;

  const handleCopy = () => {
    if (bank_account) {
      navigator.clipboard.writeText(bank_account).catch(() => {});
    }
  };

  return (
    <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
      <div className="flex items-center gap-2 mb-2">
        <CreditCard className="w-4 h-4 text-blue-600" />
        <h3 className="font-semibold text-blue-900 text-sm">입금 계좌 안내</h3>
      </div>
      <div className="text-sm space-y-1">
        {bank_name && <p className="text-blue-800">{bank_name}</p>}
        {bank_account && (
          <div className="flex items-center gap-2">
            <p className="text-blue-900 font-bold text-lg">{bank_account}</p>
            <button onClick={handleCopy} className="p-1 text-blue-500 hover:text-blue-700">
              <Copy className="w-4 h-4" />
            </button>
          </div>
        )}
        {bank_holder && <p className="text-blue-700">예금주: {bank_holder}</p>}
      </div>
    </div>
  );
}
