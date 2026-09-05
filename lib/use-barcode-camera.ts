"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType, NotFoundException } from "@zxing/library";

// The browser-native BarcodeDetector API (Shape Detection API) is NOT
// implemented by Safari/WebKit, which means it does not exist on ANY iOS
// browser (Chrome, Firefox, etc. on iOS are all required by Apple to use
// WebKit under the hood). Since staff scan with iPhones and Android phones
// -- no dedicated hardware scanner -- camera scanning must work without
// that API. ZXing decodes frames itself via canvas image data, so it works
// identically across iOS Safari, Android Chrome, and everywhere else.

type Status = "idle" | "starting" | "scanning" | "error";

type UseBarcodeCameraOptions = {
  onDetect: (text: string) => void;
  /** Ignore a repeat of the same code within this many ms (holding a code
   * steady in frame would otherwise fire the callback every scan attempt). */
  cooldownMs?: number;
};

export function useBarcodeCamera({ onDetect, cooldownMs = 1200 }: UseBarcodeCameraOptions) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const lastCodeRef = useRef<{ text: string; at: number } | null>(null);
  const onDetectRef = useRef(onDetect);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    onDetectRef.current = onDetect;
  }, [onDetect]);

  const stop = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setStatus((current) => (current === "error" ? current : "idle"));
  }, []);

  const start = useCallback(async () => {
    if (!videoRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("error");
      setErrorMessage("This browser doesn't support camera access. Use manual entry below.");
      return;
    }
    setStatus("starting");
    setErrorMessage("");
    try {
      const hints = new Map<DecodeHintType, unknown>();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.CODE_128,
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
      ]);
      hints.set(DecodeHintType.TRY_HARDER, true);
      const reader = new BrowserMultiFormatReader(hints, {
        delayBetweenScanAttempts: 100,
        delayBetweenScanSuccess: cooldownMs,
      });
      const controls = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } }, audio: false },
        videoRef.current,
        (result) => {
          if (!result) return;
          const text = result.getText();
          const now = Date.now();
          const last = lastCodeRef.current;
          if (last && last.text === text && now - last.at < cooldownMs) return;
          lastCodeRef.current = { text, at: now };
          onDetectRef.current(text);
        },
      );
      controlsRef.current = controls;
      setStatus("scanning");
    } catch (error) {
      setStatus("error");
      if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "PermissionDeniedError")) {
        setErrorMessage("Camera permission was not granted. Allow camera access in your browser/phone settings, then try again.");
      } else if (error instanceof DOMException && error.name === "NotFoundError") {
        setErrorMessage("No camera was found on this device. Use manual entry below.");
      } else if (!(error instanceof NotFoundException)) {
        setErrorMessage("Camera could not be started. Use manual entry below.");
      }
    }
  }, [cooldownMs]);

  useEffect(() => stop, [stop]);

  return { videoRef, start, stop, status, errorMessage };
}
