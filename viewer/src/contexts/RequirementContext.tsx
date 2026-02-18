'use client';

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from 'react';
import type { Requirement } from '@/lib/requirement-types';

const LOCAL_STORAGE_KEY = 'botool-requirements-v1';

/**
 * Context value interface for RequirementContext
 */
interface RequirementContextValue {
  /** All requirements (merged: API + local drafts) */
  requirements: Requirement[];
  /** Currently selected requirement ID */
  selectedId: string | null;
  /** Set the selected requirement */
  setSelectedId: (id: string | null) => void;
  /** Create a new local requirement (Stage 0 draft) */
  createRequirement: (req: Omit<Requirement, 'id' | 'createdAt' | 'updatedAt'>) => Requirement;
  /** Update an existing requirement */
  updateRequirement: (id: string, data: Partial<Requirement>) => void;
  /** Delete a requirement */
  deleteRequirement: (id: string) => void;
  /** Archive a requirement */
  archiveRequirement: (id: string) => void;
  /** Re-fetch requirements from the API and merge with local */
  refreshRequirements: () => Promise<void>;
  /** Loading state */
  isLoading: boolean;
}

const RequirementContext = createContext<RequirementContextValue | null>(null);

/**
 * Read local requirements from localStorage.
 * Returns an empty Record if localStorage is not available or data is invalid.
 */
function readLocalStorage(): Record<string, Requirement> {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Requirement>;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

/**
 * Write local requirements map to localStorage.
 */
function writeLocalStorage(data: Record<string, Requirement>): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Silently fail (e.g. private browsing storage quota exceeded)
  }
}

/**
 * Fetch requirements from the API.
 * Returns an empty array on failure.
 */
async function fetchApiRequirements(): Promise<Requirement[]> {
  try {
    const res = await fetch('/api/requirements');
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: Requirement[] };
    return Array.isArray(json.data) ? json.data : [];
  } catch {
    return [];
  }
}

/**
 * Merge local and API requirements.
 * API data takes priority: if a requirement exists in both, the API version wins.
 * Local-only requirements (Stage 0 drafts) are included as-is.
 */
function mergeRequirements(
  local: Record<string, Requirement>,
  apiData: Requirement[]
): Requirement[] {
  // Build merged map: start with local, then overwrite with API
  const merged: Record<string, Requirement> = { ...local };
  for (const req of apiData) {
    merged[req.id] = req;
  }
  return Object.values(merged).sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * RequirementProvider — wraps the app and provides requirement CRUD + API sync.
 */
export function RequirementProvider({ children }: { children: React.ReactNode }) {
  // Local requirements map (Stage 0 drafts created in the browser)
  const [localRequirements, setLocalRequirements] = useState<Record<string, Requirement>>({});
  // Requirements fetched from the API
  const [apiRequirements, setApiRequirements] = useState<Requirement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  /**
   * Fetch from API and update apiRequirements state.
   */
  const refreshRequirements = useCallback(async () => {
    const data = await fetchApiRequirements();
    setApiRequirements(data);
  }, []);

  // On mount: load localStorage (SSR-safe) and fetch from API
  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;
      // Load local drafts from localStorage
      const local = readLocalStorage();
      setLocalRequirements(local);
    });

    // Fetch API requirements
    fetchApiRequirements().then((data) => {
      if (!cancelled) {
        setApiRequirements(data);
        setIsLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Persist local requirements to localStorage whenever they change
  useEffect(() => {
    if (isLoading) return;
    writeLocalStorage(localRequirements);
  }, [localRequirements, isLoading]);

  // Merged requirements list (memoized for performance)
  const requirements = useMemo(
    () => mergeRequirements(localRequirements, apiRequirements),
    [localRequirements, apiRequirements]
  );

  /**
   * Create a new local requirement (Stage 0 draft).
   */
  const createRequirement = useCallback(
    (req: Omit<Requirement, 'id' | 'createdAt' | 'updatedAt'>): Requirement => {
      const now = Date.now();
      const newReq: Requirement = {
        ...req,
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
      };
      setLocalRequirements((prev) => ({ ...prev, [newReq.id]: newReq }));
      return newReq;
    },
    []
  );

  /**
   * Update an existing requirement.
   * If it exists in local storage, update there; otherwise store an override locally.
   */
  const updateRequirement = useCallback(
    (id: string, data: Partial<Requirement>) => {
      setLocalRequirements((prev) => {
        // Find existing entry: prefer local, fall back to API data merged in
        const existing: Requirement | undefined =
          prev[id] ?? apiRequirements.find((r) => r.id === id);

        if (!existing) {
          console.warn(`[RequirementContext] updateRequirement: id "${id}" not found`);
          return prev;
        }

        const updated: Requirement = {
          ...existing,
          ...data,
          id, // id is immutable
          createdAt: existing.createdAt,
          updatedAt: Date.now(),
        };

        return { ...prev, [id]: updated };
      });
    },
    [apiRequirements]
  );

  /**
   * Delete a requirement from local storage.
   * Note: API-sourced requirements will reappear on next refresh unless deleted server-side.
   */
  const deleteRequirement = useCallback((id: string) => {
    setLocalRequirements((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

    setSelectedId((prev) => (prev === id ? null : prev));
  }, []);

  /**
   * Archive a requirement by setting its status to 'archived'.
   */
  const archiveRequirement = useCallback(
    (id: string) => {
      updateRequirement(id, { status: 'archived' });
      setSelectedId((prev) => (prev === id ? null : prev));
    },
    [updateRequirement]
  );

  const value: RequirementContextValue = useMemo(
    () => ({
      requirements,
      selectedId,
      setSelectedId,
      createRequirement,
      updateRequirement,
      deleteRequirement,
      archiveRequirement,
      refreshRequirements,
      isLoading,
    }),
    [
      requirements,
      selectedId,
      createRequirement,
      updateRequirement,
      deleteRequirement,
      archiveRequirement,
      refreshRequirements,
      isLoading,
    ]
  );

  return (
    <RequirementContext.Provider value={value}>
      {children}
    </RequirementContext.Provider>
  );
}

/**
 * Hook to access the RequirementContext.
 * Must be used within a RequirementProvider.
 */
export function useRequirement(): RequirementContextValue {
  const context = useContext(RequirementContext);
  if (!context) {
    throw new Error('useRequirement must be used within a RequirementProvider');
  }
  return context;
}
