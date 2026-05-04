"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";

type State =
  | { kind: "unsupported" }                     // browser doesn't support web push
  | { kind: "denied" }                          // permission denied at OS / browser level
  | { kind: "checking" }                        // initial probe
  | { kind: "off" }                             // supported, not subscribed
  | { kind: "on"; endpoint: string }            // subscribed
  | { kind: "busy" }
  | { kind: "error"; message: string };

/**
 * Settings panel for Web Push.
 *
 * The UX contract:
 *   • If `Notification` / `serviceWorker` / `PushManager` aren't all
 *     available, render a polite "your browser doesn't support" card
 *     and stop.  iOS < 16.4 (or non-installed PWA on iOS) lands here.
 *   • If permission is `"denied"`, we can't even ask again — show how
 *     to flip the OS toggle and stop.
 *   • Otherwise: a single toggle that subscribes / unsubscribes via
 *     PushManager + `/api/push/subscribe`.  When subscribed, expose a
 *     "Send test" button that hits `/api/push/test`.
 *
 * VAPID public key comes from `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.  Without
 * it the toggle stays disabled with an explanation.
 */
export function PushNotifications() {
  const [state, setState] = useState<State>({ kind: "checking" });
  const [testResult, setTestResult] = useState<string | null>(null);
  const VAPID_PUB = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof window === "undefined") return;
      const support =
        "Notification" in window &&
        "serviceWorker" in navigator &&
        "PushManager" in window;
      if (!support) { if (!cancelled) setState({ kind: "unsupported" }); return; }
      if (Notification.permission === "denied") { if (!cancelled) setState({ kind: "denied" }); return; }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (cancelled) return;
        setState(sub ? { kind: "on", endpoint: sub.endpoint } : { kind: "off" });
      } catch (e) {
        if (!cancelled) setState({ kind: "error", message: e instanceof Error ? e.message : "probe failed" });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const enable = async () => {
    if (!VAPID_PUB) { setState({ kind: "error", message: "VAPID_PUBLIC_KEY не сконфигурирован на сервере" }); return; }
    setState({ kind: "busy" });
    try {
      // Permission grant happens before subscribe; iOS surfaces the
      // OS-level prompt only on a user-gesture path, which this is.
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? { kind: "denied" } : { kind: "off" });
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUB),
      });
      const json = sub.toJSON() as { endpoint: string; keys?: { p256dh?: string; auth?: string } };
      const r = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
          userAgent: navigator.userAgent.slice(0, 500),
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setState({ kind: "on", endpoint: sub.endpoint });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "subscribe failed" });
    }
  };

  const disable = async () => {
    setState({ kind: "busy" });
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      const endpoint = sub?.endpoint;
      if (sub) await sub.unsubscribe();
      if (endpoint) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        });
      }
      setState({ kind: "off" });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "unsubscribe failed" });
    }
  };

  const test = async () => {
    setTestResult(null);
    try {
      const r = await fetch("/api/push/test", { method: "POST" });
      const body = await r.json();
      setTestResult(`Отправлено: ${body.sent ?? 0} · pruned: ${body.pruned ?? 0} · ошибки: ${body.errors ?? 0}`);
    } catch (e) {
      setTestResult(e instanceof Error ? e.message : "test failed");
    }
  };

  return (
    <div className="keynote rounded-2xl p-6 mb-6">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-1">
            Мобильное · пуш-уведомления
          </div>
          <h3 className="font-display text-[22px] font-medium leading-tight">
            Уведомления
          </h3>
        </div>
        <Icon name="wifi" size={18} className="text-emerald-200" />
      </div>
      <p className="text-[13.5px] text-ivory-dim leading-snug font-light mb-4">
        Подпишись и получай нативные пуши на телефон/десктоп: бот закинул новую запись,
        cron сработал, или просто кто-то переместил entry в shared vault. Работает на
        Android Chrome, desktop Chrome/Firefox, и на iOS — после установки PWA на главный
        экран (iOS 16.4+).
      </p>

      {state.kind === "checking" && (
        <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute">Проверяю…</div>
      )}
      {state.kind === "unsupported" && (
        <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute">
          Браузер не поддерживает Web Push. На iOS — установи приложение на главный экран и попробуй снова.
        </div>
      )}
      {state.kind === "denied" && (
        <div className="font-mono text-[10px] uppercase tracking-widest text-red-300 leading-relaxed">
          Permission denied. Открой настройки сайта в браузере и разреши уведомления вручную, потом перезагрузи страницу.
        </div>
      )}
      {(state.kind === "off" || state.kind === "busy") && (
        <button
          onClick={enable}
          disabled={state.kind === "busy"}
          className="bg-ivory text-emerald-950 px-5 py-2.5 rounded-full font-medium tracking-tight text-[13px] hover:bg-emerald-100 disabled:opacity-50 transition inline-flex items-center gap-2"
        >
          <Icon name="check" size={13} /> {state.kind === "busy" ? "Подписываюсь…" : "Включить уведомления"}
        </button>
      )}
      {state.kind === "on" && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-mono text-[10px] uppercase tracking-widest text-emerald-200 flex items-center gap-1.5">
            <Icon name="check" size={11} /> Подключено
          </span>
          <button
            onClick={test}
            className="border border-gold/40 text-gold px-4 py-2 rounded-full font-medium tracking-tight text-[12px] hover:bg-gold hover:text-emerald-deep transition"
          >
            Послать тест
          </button>
          <button
            onClick={disable}
            className="border border-white/15 text-ivory-mute px-4 py-2 rounded-full font-medium tracking-tight text-[12px] hover:border-red-400 hover:text-red-300 transition"
          >
            Отключить
          </button>
        </div>
      )}
      {state.kind === "error" && (
        <div className="font-mono text-[11px] text-red-400 flex items-center gap-2">
          <Icon name="x" size={12} /> {state.message}
        </div>
      )}
      {testResult && (
        <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mt-3">
          {testResult}
        </div>
      )}
    </div>
  );
}

/**
 * Convert a base64url-encoded VAPID public key to the Uint8Array format
 * `pushManager.subscribe` expects.  Standard helper.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - base64.length % 4) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  // Build a fresh ArrayBuffer-backed Uint8Array — `applicationServerKey`
  // expects BufferSource backed by ArrayBuffer (not SharedArrayBuffer),
  // and a typed-array view from a literal byte string is sometimes
  // typed as ArrayBufferLike, which TS rejects.
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
