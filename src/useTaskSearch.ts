import { useEffect, useState } from "react";
import { searchTasks } from "./api";
import type { Task, StatusFilter } from "./types";

export interface TaskSearchState {
  tasks: Task[];
  loading: boolean;
  error: string;
  /**
   * tasks 是否已经是「当前 q/status」的最新成功结果。
   * 用于结果钳制：只有它为 true 时才允许按结果页数纠正越界页码，
   * 从而避免用「加载前的空列表」或「上一次查询结果」提前把页码改成 1。
   */
  isCurrent: boolean;
}

interface InternalState {
  tasks: Task[];
  loading: boolean;
  error: string;
  /** 最近一次成功结果对应的查询键；null 表示还没有任何一次查询成功。 */
  resultKey: string | null;
}

function queryKey(q: string, status: StatusFilter): string {
  return `${q}\u0000${status}`;
}

/**
 * 任务查询 Hook。
 *
 * T1 竞态修复：每次查询都新建 AbortController，并在 effect 清理时中止它；
 * 同时用 active 有效性标志兜底（即使底层实现忽略 signal 也不会提交过期结果）。
 * 于是只有「当前有效查询」能够提交结果、错误与结束状态：
 * - 较早的成功不会覆盖新结果；
 * - 较早的失败不会污染新错误；
 * - 较早的结束不会提前关闭新查询的 loading；
 * - 组件卸载后不会再提交任何状态。
 */
export function useTaskSearch(
  q: string,
  status: StatusFilter,
): TaskSearchState {
  const [state, setState] = useState<InternalState>({
    tasks: [],
    // 首次即为加载中，避免把「加载前的空列表」当成一次已完成的查询结果。
    loading: true,
    error: "",
    resultKey: null,
  });

  const key = queryKey(q, status);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setState((prev) => ({ ...prev, loading: true, error: "" }));

    searchTasks(q, status, controller.signal)
      .then((list) => {
        if (!active || controller.signal.aborted) return;
        setState({ tasks: list, loading: false, error: "", resultKey: key });
      })
      .catch((e: unknown) => {
        // 被中止/已过期：直接丢弃，不提交错误，也不关闭新查询的 loading。
        if (!active || controller.signal.aborted) return;
        if (e instanceof DOMException && e.name === "AbortError") return;
        setState((prev) => ({
          tasks: prev.tasks,
          loading: false,
          error: e instanceof Error ? e.message : String(e),
          resultKey: prev.resultKey,
        }));
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [q, status]);

  return {
    tasks: state.tasks,
    loading: state.loading,
    error: state.error,
    isCurrent: !state.loading && state.error === "" && state.resultKey === key,
  };
}
