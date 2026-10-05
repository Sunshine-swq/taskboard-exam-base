import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { Task } from "../src/types";

interface Deferred {
  promise: Promise<Task[]>;
  resolve: (value: Task[]) => void;
  reject: (reason: unknown) => void;
}

/**
 * 受控 Promise：searchTasks 每次被调用都返回一个「由测试决定何时完成」的 promise，
 * 从而精确编排旧请求/新请求的完成先后，避免依赖固定 sleep。
 */
const h = vi.hoisted(() => {
  const calls: Deferred[] = [];
  function makeDeferred(): Deferred {
    let resolve!: (value: Task[]) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<Task[]>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }
  const searchMock = vi.fn((..._args: unknown[]) => {
    const d = makeDeferred();
    calls.push(d);
    return d.promise;
  });
  return { calls, makeDeferred, searchMock };
});

vi.mock("../src/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api")>();
  return {
    ...actual,
    searchTasks: (...args: unknown[]) => h.searchMock(...args),
  };
});

import App from "../src/App";
import { selectTasks } from "../src/api";

const input = () => screen.getByPlaceholderText("搜索任务标题");
const submit = () =>
  fireEvent.click(screen.getByRole("button", { name: "查询" }));

async function settle(d: Deferred, value: Task[]) {
  await act(async () => {
    d.resolve(value);
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function failWith(d: Deferred, reason: unknown) {
  await act(async () => {
    d.reject(reason);
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  h.calls.length = 0;
  h.searchMock.mockClear();
  window.history.replaceState({}, "", "/");
});

describe("T1 异步竞态：只有当前有效查询能提交结果/错误/loading", () => {
  it("较晚结束的旧成功不会覆盖新查询结果", async () => {
    render(<App />);
    expect(h.calls).toHaveLength(1); // 挂载时的初始查询

    fireEvent.change(input(), { target: { value: "登录" } });
    submit();
    const slow = h.calls[1]; // 登录：较慢

    fireEvent.change(input(), { target: { value: "接口" } });
    submit();
    const fast = h.calls[2]; // 接口：较快，在旧请求结束前发起

    expect(h.calls).toHaveLength(3);

    // 新查询先成功
    await settle(fast, selectTasks("接口", "ALL"));
    expect(await screen.findByText("任务列表接口对接")).toBeInTheDocument();

    // 旧查询随后才成功，必须被丢弃
    await settle(slow, selectTasks("登录", "ALL"));
    expect(screen.queryByText("登录功能开发")).toBeNull();
    expect(screen.getByText("任务列表接口对接")).toBeInTheDocument();
    expect(screen.getByText("4项任务")).toBeInTheDocument();
  });

  it("旧请求先结束不会提前关闭新查询的 loading（旧请求同时被中止）", async () => {
    render(<App />);

    fireEvent.change(input(), { target: { value: "登录" } });
    submit();
    const slow = h.calls[1];
    const slowSignal = h.searchMock.mock.calls[1][2] as AbortSignal;

    fireEvent.change(input(), { target: { value: "接口" } });
    submit();
    const fast = h.calls[2];

    // 新查询发起后，旧请求应被立即中止
    expect(slowSignal.aborted).toBe(true);

    // 旧请求先结束
    await settle(slow, selectTasks("登录", "ALL"));
    expect(screen.getByText("正在查询…")).toBeInTheDocument();
    expect(screen.queryByText("登录功能开发")).toBeNull();

    // 只有新请求结束后才关闭 loading
    await settle(fast, selectTasks("接口", "ALL"));
    expect(await screen.findByText("任务列表接口对接")).toBeInTheDocument();
    expect(screen.queryByText("正在查询…")).toBeNull();
  });

  it("较晚结束的旧失败不会污染新查询的错误状态", async () => {
    render(<App />);

    fireEvent.change(input(), { target: { value: "登录" } });
    submit();
    const slow = h.calls[1];

    fireEvent.change(input(), { target: { value: "接口" } });
    submit();
    const fast = h.calls[2];

    await settle(fast, selectTasks("接口", "ALL"));
    expect(await screen.findByText("任务列表接口对接")).toBeInTheDocument();

    // 旧请求随后失败，不应出现错误提示，也不应清掉新结果
    await failWith(slow, new Error("旧请求失败"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("任务列表接口对接")).toBeInTheDocument();
  });

  it("最新查询失败时显示错误，失败后重试可正常成功", async () => {
    render(<App />);

    fireEvent.change(input(), { target: { value: "失败" } });
    submit();
    const failing = h.calls[1];

    await failWith(failing, new Error("模拟查询失败"));
    expect(await screen.findByRole("alert")).toHaveTextContent("模拟查询失败");
    expect(screen.queryByText("正在查询…")).toBeNull();

    fireEvent.change(input(), { target: { value: "登录" } });
    submit();
    await settle(h.calls[2], selectTasks("登录", "ALL"));

    expect(await screen.findByText("登录功能开发")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("最新查询空结果正常展示空态", async () => {
    render(<App />);

    fireEvent.change(input(), { target: { value: "不存在" } });
    submit();
    await settle(h.calls[1], selectTasks("不存在", "ALL"));

    expect(await screen.findByText("没有匹配的任务")).toBeInTheDocument();
    expect(screen.getByText("第1页 共1页")).toBeInTheDocument();
  });

  it("组件卸载时中止在途请求并忽略其结果", async () => {
    const { unmount } = render(<App />);
    const signal = h.searchMock.mock.calls[0][2] as AbortSignal;
    const inflight = h.calls[0];

    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);

    // 卸载后再完成也不应抛错或提交状态
    await act(async () => {
      inflight.resolve(selectTasks("", "ALL"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByText("登录功能开发")).toBeNull();
  });
});
