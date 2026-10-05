import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import App from "../src/App";
import { readQuery, writeQuery } from "../src/query";

const go = (url: string) => window.history.replaceState({}, "", url);
const input = () => screen.getByPlaceholderText("搜索任务标题");
const submit = () =>
  fireEvent.click(screen.getByRole("button", { name: "查询" }));
const select = () => screen.getByRole("combobox");

beforeEach(() => {
  go("/");
});

describe("T2 URL 参数规范", () => {
  it("缺省与非法参数回退（状态与页码）", () => {
    expect(readQuery("")).toEqual({ q: "", status: "ALL", page: 1 });
    expect(readQuery("?status=BAD&page=abc")).toEqual({
      q: "",
      status: "ALL",
      page: 1,
    });
    // 非正、非整数、非数值、非安全整数一律回退为 1
    expect(readQuery("?page=0").page).toBe(1);
    expect(readQuery("?page=-2").page).toBe(1);
    expect(readQuery("?page=2.5").page).toBe(1);
    expect(readQuery("?page=1e3").page).toBe(1);
    expect(readQuery("?page=99999999999999999999").page).toBe(1);
    // 状态只认 ALL/TODO/DOING/DONE
    expect(readQuery("?status=doing").status).toBe("ALL");
    expect(readQuery("?status=DONE").status).toBe("DONE");
    // 正常参数原样读出
    expect(readQuery("?q=%E6%8E%A5%E5%8F%A3&status=DOING&page=2")).toEqual({
      q: "接口",
      status: "DOING",
      page: 2,
    });
  });

  it("writeQuery 省略默认参数、保留无关参数与 hash", () => {
    go("/?foo=1&q=旧&status=TODO&page=5#top");
    writeQuery({ q: "", status: "ALL", page: 1 }, "replace");
    expect(window.location.search).toBe("?foo=1");
    expect(window.location.hash).toBe("#top");
  });
});

describe("T2 首次进入 / 刷新恢复", () => {
  it("恢复已提交搜索词并同步输入框", async () => {
    go("/?q=%E6%8E%A5%E5%8F%A3");
    render(<App />);

    expect(await screen.findByText("任务列表接口对接")).toBeInTheDocument();
    expect(input()).toHaveValue("接口");
    expect(select()).toHaveValue("ALL");
    expect(screen.getByText("第1页 共1页")).toBeInTheDocument();
  });

  it("恢复筛选与页码", async () => {
    go("/?status=DOING&page=2");
    render(<App />);

    expect(await screen.findByText("第2页 共2页")).toBeInTheDocument();
    expect(select()).toHaveValue("DOING");
    expect(screen.getByText("接口权限回归")).toBeInTheDocument();
  });

  it("未提交的输入不写入 URL", async () => {
    render(<App />);
    await screen.findByText("登录功能开发");

    fireEvent.change(input(), { target: { value: "接口" } });
    expect(window.location.search).toBe("");
  });
});

describe("T2 写入与浏览器历史", () => {
  it("提交查询：trim、页码回 1、replace 当前历史项", async () => {
    go("/?page=2");
    render(<App />);
    await screen.findByText("第2页 共4页");

    const length = window.history.length;
    fireEvent.change(input(), { target: { value: "  登录  " } });
    submit();

    expect(
      await screen.findByText("登录功能开发", {}, { timeout: 2000 }),
    ).toBeInTheDocument();
    expect(screen.getByText("第1页 共1页")).toBeInTheDocument();
    expect(window.location.search).toBe("?q=%E7%99%BB%E5%BD%95");
    expect(window.history.length).toBe(length); // replace，不新增历史项
  });

  it("筛选变化：页码回 1 且 push 新历史项", async () => {
    go("/?page=2");
    render(<App />);
    await screen.findByText("第2页 共4页");

    const length = window.history.length;
    fireEvent.change(select(), { target: { value: "DOING" } });

    expect(await screen.findByText("第1页 共2页")).toBeInTheDocument();
    expect(window.location.search).toBe("?status=DOING");
    expect(window.history.length).toBe(length + 1); // push
  });

  it("翻页 push 新历史项并写入 page", async () => {
    render(<App />);
    await screen.findByText("第1页 共4页");

    const length = window.history.length;
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));

    expect(await screen.findByText("第2页 共4页")).toBeInTheDocument();
    expect(window.location.search).toBe("?page=2");
    expect(window.history.length).toBe(length + 1); // push
  });

  it("保留无关参数与 hash", async () => {
    go("/?foo=bar&page=2#top");
    render(<App />);
    await screen.findByText("第2页 共4页");

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));

    expect(await screen.findByText("第3页 共4页")).toBeInTheDocument();
    expect(window.location.search).toBe("?foo=bar&page=3");
    expect(window.location.hash).toBe("#top");
  });

  it("popstate 恢复输入、筛选与页码并重新查询", async () => {
    render(<App />);
    await screen.findByText("第1页 共4页");

    await act(async () => {
      window.history.pushState({}, "", "/?q=%E7%99%BB%E5%BD%95&page=1");
      window.dispatchEvent(new Event("popstate"));
    });
    expect(input()).toHaveValue("登录");
    // 等待该次恢复触发的查询完成：全部 24 项收敛为 4 项、共 1 页
    expect(
      await screen.findByText("第1页 共1页", {}, { timeout: 2000 }),
    ).toBeInTheDocument();
    expect(screen.getByText("4项任务")).toBeInTheDocument();
    expect(screen.getByText("登录功能开发")).toBeInTheDocument();

    await act(async () => {
      window.history.pushState({}, "", "/?status=DOING&page=2");
      window.dispatchEvent(new Event("popstate"));
    });
    expect(
      await screen.findByText("第2页 共2页", {}, { timeout: 2000 }),
    ).toBeInTheDocument();
    expect(select()).toHaveValue("DOING");
    expect(screen.getByText("接口权限回归")).toBeInTheDocument();
  });

  it("中文与 & 等特殊字符编码后仍可还原", async () => {
    render(<App />);
    await screen.findByText("登录功能开发");

    fireEvent.change(input(), { target: { value: "a&b 中文" } });
    submit();

    await waitFor(() => expect(window.location.search).toContain("q=a%26b"));
    expect(readQuery(window.location.search).q).toBe("a&b 中文");
  });
});

describe("T2 结果钳制与错误", () => {
  it("越界页码在查询成功后才被规范为结果页数（replace）", async () => {
    go("/?page=99");
    const length = window.history.length;
    render(<App />);

    await waitFor(() => expect(window.location.search).toBe("?page=4"));
    expect(screen.getByText("第4页 共4页")).toBeInTheDocument();
    expect(window.history.length).toBe(length); // replace
  });

  it("空结果保持第 1 页并移除越界页码", async () => {
    go("/?q=%E4%B8%8D%E5%AD%98%E5%9C%A8&page=3");
    render(<App />);

    expect(await screen.findByText("没有匹配的任务")).toBeInTheDocument();
    expect(screen.getByText("第1页 共1页")).toBeInTheDocument();
    await waitFor(() =>
      expect(window.location.search).toBe("?q=%E4%B8%8D%E5%AD%98%E5%9C%A8"),
    );
  });

  it("模拟失败查询展示错误，且不误改 URL", async () => {
    go("/?q=%E5%A4%B1%E8%B4%A5");
    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("模拟查询失败");
    expect(window.location.search).toBe("?q=%E5%A4%B1%E8%B4%A5");
  });
});
