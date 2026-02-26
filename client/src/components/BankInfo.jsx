import React, { useState } from 'react';
import { CreditCard, Copy, Check } from 'lucide-react';

export default function BankInfo({ settings }) {
  const { bank_name, bank_account, bank_holder } = settings;
  const [copied, setCopied] = useState(false);

  if (!bank_name && !bank_account) return null;

  const handleCopy = async () => {
    if (!bank_account) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(bank_account);
      } else {
        const ta = document.createElement('textarea');
        ta.value = bank_account;
        ta.style.cssText = 'position:fixed;left:-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
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
            <button
              onClick={handleCopy}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium min-h-[32px] ${
                copied
                  ? 'bg-green-100 text-green-700'
                  : 'bg-blue-100 text-blue-700 hover:bg-blue-200 active:bg-blue-300'
              }`}
            >
              {copied ? <><Check className="w-3 h-3" /> 복사됨</> : <><Copy className="w-3 h-3" /> 복사</>}
            </button>
          </div>
        )}
        {bank_holder && <p className="text-blue-700">예금주: {bank_holder}</p>}
      </div>
    </div>
  );
}
