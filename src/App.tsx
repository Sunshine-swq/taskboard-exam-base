import { useEffect, useState } from "react";
import type { StatusFilter } from "./types";
import { useTaskSearch } from "./useTaskSearch";
import { pageOf, readQuery, writeQuery } from "./query";

export default function App() {
  // 首次挂载时从 URL 恢复（lazy 初始化，只读一次 location.search）。
  const [initial] = useState(() => readQuery(window.location.search));
  const [draft, setDraft] = useState(initial.q);
  const [q, setQ] = useState(initial.q);
  const [status, setStatus] = useState<StatusFilter>(initial.status);
  const [page, setPage] = useState(initial.page);
  const { tasks, loading, error, isCurrent } = useTaskSearch(q, status);
  const view = pageOf(tasks, page);

  function search(e: React.FormEvent) {
    e.preventDefault();
    const next = draft.trim();
    setQ(next);
    setPage(1);
    // 提交查询：页码回 1，并 replace 当前历史项。
    writeQuery({ q: next, status, page: 1 }, "replace");
  }

  function changeStatus(next: StatusFilter) {
    setStatus(next);
    setPage(1);
    // 筛选变化：页码回 1，push 一个新的历史项。
    writeQuery({ q, status: next, page: 1 }, "push");
  }

  function goToPage(next: number) {
    setPage(next);
    // 翻页：push 一个新的历史项。
    writeQuery({ q, status, page: next }, "push");
  }

  // 浏览器前进/后退：从 URL 恢复输入框、筛选与页码；
  // q/status 变化会由 useTaskSearch 自动发起对应查询。
  useEffect(() => {
    function onPopState() {
      const next = readQuery(window.location.search);
      setDraft(next.q);
      setQ(next.q);
      setStatus(next.status);
      setPage(next.page);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // 结果钳制：只有「当前查询成功」后才按结果页数纠正越界页码；
  // 加载中或出错时不动页码，避免用空列表/上一次结果提前把页码改成 1。
  // 规范化越界页码使用 replace，不新增历史项。
  useEffect(() => {
    if (!isCurrent || error || page <= view.pages) return;
    setPage(view.pages);
    writeQuery({ q, status, page: view.pages }, "replace");
  }, [isCurrent, error, page, view.pages, q, status]);

  return (
    <>
      <header>
        <div className="brand">
          TaskBoard<span>任务看板</span>
        </div>
      </header>
      <main>
        <h1>项目任务</h1>
        <p className="subtitle">搜索、筛选和查看团队任务。</p>
        <form className="toolbar" onSubmit={search}>
          <label className="search">
            搜索任务
            <input
              placeholder="搜索任务标题"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </label>
          <label>
            状态
            <select
              value={status}
              onChange={(e) => changeStatus(e.target.value as StatusFilter)}
            >
              <option value="ALL">全部状态</option>
              <option value="TODO">待办</option>
              <option value="DOING">进行中</option>
              <option value="DONE">已完成</option>
            </select>
          </label>
          <button className="primary">查询</button>
        </form>
        <p className="count muted" aria-live="polite">
          {tasks.length}项任务
        </p>
        <section className="panel" aria-label="任务列表" aria-busy={loading}>
          <div className="table-row table-head">
            <span>任务</span>
            <span>状态</span>
            <span className="owner">负责人</span>
          </div>
          {error ? (
            <div role="alert" className="error">
              {error}
            </div>
          ) : loading ? (
            <div role="status" className="state">
              正在查询…
            </div>
          ) : tasks.length === 0 ? (
            <div className="state">没有匹配的任务</div>
          ) : (
            view.items.map((t) => (
              <div className="table-row" key={t.id}>
                <div>
                  <div className="task-title">{t.title}</div>
                  <div className="task-detail">{t.description}</div>
                </div>
                <div>
                  <span className={"tag " + t.status}>{t.status}</span>
                </div>
                <span className="owner">{t.owner}</span>
              </div>
            ))
          )}
        </section>
        <nav className="pager" aria-label="分页">
          <button disabled={loading || view.current === 1} onClick={() => goToPage(view.current - 1)}>
            上一页
          </button>
          <span>
            第{view.current}页 共{view.pages}页
          </span>
          <button
            disabled={loading || view.current === view.pages}
            onClick={() => goToPage(view.current + 1)}
          >
            下一页
          </button>
        </nav>
      </main>
    </>
  );
}
