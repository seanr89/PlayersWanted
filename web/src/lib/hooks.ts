import type { Area } from '@pw/shared';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  type DocumentSnapshot,
  type Query,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { useEffect, useState, type DependencyList } from 'react';
import { db } from '../firebase';

export interface Live<T> {
  data: T;
  loading: boolean;
  error: Error | null;
}

export function useLiveQuery<T>(
  make: () => Query | null,
  map: (d: QueryDocumentSnapshot) => T,
  deps: DependencyList,
): Live<T[]> {
  const [state, setState] = useState<Live<T[]>>({ data: [], loading: true, error: null });
  useEffect(() => {
    const q = make();
    if (!q) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    return onSnapshot(
      q,
      (snap) => setState({ data: snap.docs.map(map), loading: false, error: null }),
      (error) => setState({ data: [], loading: false, error }),
    );
  }, deps);
  return state;
}

export function useLiveDoc<T>(path: string | null, map: (d: DocumentSnapshot) => T | null): Live<T | null> {
  const [state, setState] = useState<Live<T | null>>({ data: null, loading: true, error: null });
  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    return onSnapshot(
      doc(db, path),
      (snap) => setState({ data: map(snap), loading: false, error: null }),
      (error) => setState({ data: null, loading: false, error }),
    );
  }, [path]);
  return state;
}

export function useAreas(): Live<Area[]> {
  return useLiveQuery(
    () => query(collection(db, 'areas'), orderBy('order')),
    (d) => ({ id: d.id, name: d.data().name as string, order: d.data().order as number }),
    [],
  );
}
