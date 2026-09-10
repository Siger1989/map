import { useEffect, useRef, useState } from 'react';
import type { Coordinate } from '../navigation/types';
import type { SectionObject } from './sectionObjects';
import type { SectionObjectsState } from './useSavedSection';
import type { SectionSettings } from './types';
import {
  addSurveyStation,
  moveSurveyStation,
  newSurveyLine,
  surveyKey,
  surveySettings,
  type SurveyFollow,
} from './surveyLine';
import { sampleSurveyTerrain } from './surveyTerrain';
import { addSurveyMarker, commitSurveySettings } from './surveyStore';

export function useSurveySection(
  sections: SectionObjectsState,
  onMarker: (id: string) => void,
) {
  const [active, setActive] = useState(false),
    [first, setFirst] = useState<Coordinate | null>(null),
    [picking, setPicking] = useState<string | null>(null);
  const [selected, setSelected] = useState('A'),
    [mode, setMode] = useState<'direction' | 'slide'>('direction');
  const [follow, setFollow] = useState<SurveyFollow>('chainage'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0);
  const [preview, setPreview] = useState<SectionSettings | null>(null);
  const [pointMenu, setPointMenu] = useState(true),
    [dragging, setDragging] = useState(false);
  const refreshRequested = useRef(false);
  const current = sections.items.find(
      (s) => s.id === sections.selectedId && s.settings.survey,
    ),
    latest = useRef(current);
  latest.current = current;
  const currentKey =
    current?.settings.survey && surveyKey(current.settings.survey);
  useEffect(() => {
    if (
      !active ||
      !current?.settings.survey ||
      (current.settings.surveyTerrain && !refreshRequested.current)
    ) {
      setBusy(false);
      return;
    }
    refreshRequested.current = false;
    const request = new AbortController(),
      id = current.id,
      line = current.settings.survey;
    setBusy(true);
    void sampleSurveyTerrain(line, request.signal)
      .then((terrain) => {
        const live = latest.current;
        if (
          request.signal.aborted ||
          live?.id !== id ||
          !live.settings.survey ||
          surveyKey(live.settings.survey) !== terrain.key
        )
          return;
        commitSurveySettings(id, live.settings, {
          ...live.settings,
          surveyTerrain: terrain,
        });
        setError('');
      })
      .catch((e) => {
        if (!request.signal.aborted)
          setError(e instanceof Error ? e.message : '地形读取失败');
      })
      .finally(() => {
        if (!request.signal.aborted) setBusy(false);
      });
    return () => request.abort();
  }, [active, current?.id, currentKey, retry]);
  const commit = (settings: SectionSettings) => {
    if (!current) return false;
    try {
      commitSurveySettings(current.id, current.settings, settings);
      setPreview(null);
      setError('');
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '剖面未保存');
      setPreview(null);
      return false;
    }
  };
  const editPoint = (id: string, point: Coordinate, commitNow: boolean) => {
    if (!current?.settings.survey) return false;
    try {
      const next = surveySettings(
        moveSurveyStation(current.settings.survey, id, point, mode, follow),
        current.settings,
      );
      if (commitNow) return commit(next);
      setPreview(next);
      setError('');
      return true;
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : '点位无效');
      return false;
    }
  };
  const pick = (point: Coordinate) => {
    if (!active || !picking) return false;
    setPointMenu(true);
    setError('');
    try {
      if (picking === 'first') {
        setFirst(point);
        setPicking('second');
      } else if (picking === 'second') {
        if (!first) return true;
        const line = newSurveyLine(first, point);
        if (!sections.create(surveySettings(line))) {
          setError('剖面未保存，请检查存储');
          return true;
        }
        setFirst(null);
        setPicking(null);
        setSelected('B');
      } else if (picking === 'marker' && current) {
        const marker = addSurveyMarker(current.id, point);
        setPicking(null);
        setSelected(marker.id);
        onMarker(marker.id);
      } else if (picking === 'point' && current?.settings.survey) {
        const line = addSurveyStation(
          current.settings.survey,
          point,
          crypto.randomUUID(),
        );
        if (commit(surveySettings(line, current.settings))) {
          setPicking(null);
          setSelected(line.stations.at(-1)!.id);
        }
      } else if (editPoint(picking, point, true)) setPicking(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法设置勘探线');
    }
    return true;
  };
  const start = () => {
    sections.select(null);
    setActive(true);
    setFirst(null);
    setPicking('first');
    setPreview(null);
    setError('');
    setMode('direction');
    setPointMenu(true);
    setDragging(false);
  };
  const open = (object: SectionObject) => {
    setSelected('A');
    setPointMenu(true);
    setDragging(false);
    sections.select(object.id);
    setActive(true);
    setFirst(null);
    setPicking(null);
    setPreview(null);
    setError('');
  };
  return {
    active,
    first,
    picking,
    setPicking,
    selected,
    select: (id: string, showMenu = true) => {
      setSelected(id);
      if (showMenu) setPointMenu(true);
    },
    beginMove: (id: string, nextMode: 'direction' | 'slide') => {
      setSelected(id);
      setMode(nextMode);
      setPicking(id);
      setPointMenu(true);
      setError('');
    },
    pointMenu,
    hidePointMenu: () => setPointMenu(false),
    dragging,
    setDragging,
    mode,
    setMode,
    follow,
    setFollow,
    error,
    busy,
    object: current && { ...current, settings: preview ?? current.settings },
    start,
    open,
    pick,
    editPoint,
    cancelPreview: () => setPreview(null),
    interruptDrag: () => {
      setDragging(false);
      setPreview(null);
      setError('拖动已中断，位置未保存。请重新拖点，或点击地图落位。');
    },
    commit,
    close: () => {
      setActive(false);
      setPicking(null);
      setFirst(null);
      setPreview(null);
      setDragging(false);
    },
    retry: () => {
      refreshRequested.current = true;
      setError('');
      setRetry((n) => n + 1);
    },
  };
}
export type SurveySectionState = ReturnType<typeof useSurveySection>;
