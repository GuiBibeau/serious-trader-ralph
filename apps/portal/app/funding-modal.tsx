"use client";

import { useFundWallet } from "@privy-io/react-auth/solana";
import { AnimatePresence, motion } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useRef, useState } from "react";
import { BTN_PRIMARY, BTN_SECONDARY } from "./lib";

type FundingModalProps = {
  walletAddress: string;
  open: boolean;
  onClose: () => void;
};

export function FundingModal({
  walletAddress,
  open,
  onClose,
}: FundingModalProps) {
  const { fundWallet } = useFundWallet();
  const [copied, setCopied] = useState(false);
  const [fundFailed, setFundFailed] = useState(false);
  const [funding, setFunding] = useState(false);

  // Stable ref for onClose — avoids listener churn in the keydown effect (Rule 5.6)
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Escape key closes modal
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCloseRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(walletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  }, [walletAddress]);

  async function handleBuyWithCard() {
    setFunding(true);
    try {
      await fundWallet({ address: walletAddress });
    } catch {
      // If Privy rejects the address (e.g. non-embedded wallet),
      // hide the button permanently for this session.
      setFundFailed(true);
    } finally {
      setFunding(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[6px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
        >
          <motion.div
            className="w-[min(440px,92vw)] max-h-[90vh] overflow-y-auto card"
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-5 border-b border-border">
              <p className="label">Fund your bot</p>
              <button
                className="flex items-center justify-center w-9 h-9 rounded-md border border-border bg-surface text-xl cursor-pointer hover:bg-paper transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
                onClick={onClose}
                type="button"
                aria-label="Close"
              >
                &times;
              </button>
            </div>

            <div className="p-6">
              {!fundFailed && (
                <button
                  className={`${BTN_PRIMARY} w-full`}
                  onClick={() => void handleBuyWithCard()}
                  disabled={funding}
                  type="button"
                >
                  {funding ? "Loading…" : "Buy with card"}
                </button>
              )}

              <p className="text-muted text-[0.85rem] text-center mt-5 mb-1.5">
                {fundFailed ? "Send directly" : "— or send directly —"}
              </p>

              <div className="flex items-center gap-2.5 px-4 py-3 rounded-md border border-border bg-paper">
                <code className="flex-1 break-all text-[0.85rem]">
                  {walletAddress}
                </code>
                <button
                  className={`${BTN_SECONDARY} !px-4 !py-2 whitespace-nowrap`}
                  onClick={() => void handleCopy()}
                  type="button"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>

              <div className="flex justify-center mt-5">
                <QRCodeSVG
                  value={walletAddress}
                  size={160}
                  level="M"
                  bgColor="transparent"
                  fgColor="var(--color-ink)"
                />
              </div>

              <p className="text-muted text-[0.85rem] text-center mt-4">
                SOL for fees &middot; USDC for trading
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
