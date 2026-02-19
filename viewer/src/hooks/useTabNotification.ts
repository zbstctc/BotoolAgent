'use client';

import { useEffect, useRef } from 'react';
import { useTab } from '@/contexts/TabContext';

const RUNNING_STATUSES = new Set(['running', 'starting', 'waiting_network']);
const COMPLETE_STATUSES = new Set(['idle', 'complete', 'session_done', 'max_iterations', 'max_rounds']);
const ERROR_STATUSES = new Set(['error', 'failed', 'stopped', 'timeout']);

function playTone(type: 'attention' | 'complete' | 'error'): void {
  try {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.connect(gain);
    gain.connect(ctx.destination);

    oscillator.type = 'sine';
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);

    if (type === 'attention') {
      // Two-note chime: 660 -> 880 Hz (friendly "ding-dong")
      oscillator.frequency.setValueAtTime(660, ctx.currentTime);
      oscillator.frequency.setValueAtTime(880, ctx.currentTime + 0.15);
    } else if (type === 'complete') {
      // Rising tone: 440 -> 880 Hz
      oscillator.frequency.setValueAtTime(440, ctx.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.3);
    } else {
      // Falling tone: 440 -> 220 Hz
      oscillator.frequency.setValueAtTime(440, ctx.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.3);
    }

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.5);

    // Clean up AudioContext after sound finishes
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 1000);
  } catch {
    // Silent failure - Web Audio may not be available
  }
}

/** Headless client component that mounts the notification hook at layout level. */
export function TabNotificationMount() {
  useTabNotification();
  return null;
}

export function useTabNotification(): void {
  const { tabs, activeTabId, setNeedsAttention } = useTab();

  // Store previous statuses for comparison
  const prevStatusesRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const prevStatuses = prevStatusesRef.current;

    for (const tab of tabs) {
      if (!tab.agentStatus) continue;

      const prevStatus = prevStatuses.get(tab.id);
      const currentStatus = tab.agentStatus;

      // Skip if status hasn't changed
      if (prevStatus === currentStatus) continue;

      const isActiveTab = tab.id === activeTabId;

      // Transition to waiting_for_user: always notify (sound + flash)
      if (currentStatus === 'waiting_for_user') {
        playTone('attention');
        if (!isActiveTab) {
          setNeedsAttention(tab.id, true);
        }
        continue;
      }

      // Transition: was running -> now terminal
      if (prevStatus && RUNNING_STATUSES.has(prevStatus)) {
        if (COMPLETE_STATUSES.has(currentStatus)) {
          if (!isActiveTab) {
            playTone('complete');
            setNeedsAttention(tab.id, true);
          }
        } else if (ERROR_STATUSES.has(currentStatus)) {
          playTone('error');
          setNeedsAttention(tab.id, true);
        }
      }
    }

    // Update prevStatuses
    const newStatuses = new Map<string, string>();
    for (const tab of tabs) {
      if (tab.agentStatus) {
        newStatuses.set(tab.id, tab.agentStatus);
      }
    }
    prevStatusesRef.current = newStatuses;
  }, [tabs, activeTabId, setNeedsAttention]);
}
