import {act, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, test, vi} from "vitest";
import {
  ConfirmationStrip,
  FeedbackProvider,
  InlineAlert,
  useFeedback,
} from "./FeedbackSystem";

function ToastHarness() {
  const feedback = useFeedback();
  return (
    <div>
      <button type="button" onClick={() => feedback.toast({tone: "success", message: "تنظیمات ذخیره شد."})}>success</button>
      <button type="button" onClick={() => feedback.toast({tone: "info", message: "جلسه مرور آماده است."})}>info</button>
      <button type="button" onClick={() => feedback.toast({tone: "warning", message: "فقط ۲ دقیقه باقی مانده."})}>warning</button>
      <button type="button" onClick={() => feedback.toast({tone: "error", message: "ارسال پاسخ ناموفق بود.", durationMs: null})}>error</button>
    </div>
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("FeedbackSystem", () => {
  test("renders accessible success toast and dismisses it with Escape", () => {
    render(<FeedbackProvider locale="fa"><ToastHarness /></FeedbackProvider>);
    fireEvent.click(screen.getByRole("button", {name: "success"}));
    expect(screen.getByRole("status")).toHaveTextContent("تنظیمات ذخیره شد.");
    fireEvent.keyDown(document, {key: "Escape"});
    expect(screen.queryByText("تنظیمات ذخیره شد.")).not.toBeInTheDocument();
  });

  test("shows at most three stacked toasts", () => {
    render(<FeedbackProvider locale="fa"><ToastHarness /></FeedbackProvider>);
    fireEvent.click(screen.getByRole("button", {name: "success"}));
    fireEvent.click(screen.getByRole("button", {name: "info"}));
    fireEvent.click(screen.getByRole("button", {name: "warning"}));
    fireEvent.click(screen.getByRole("button", {name: "error"}));
    expect(screen.queryByText("تنظیمات ذخیره شد.")).not.toBeInTheDocument();
    expect(screen.getByText("جلسه مرور آماده است.")).toBeInTheDocument();
    expect(screen.getByText("فقط ۲ دقیقه باقی مانده.")).toBeInTheDocument();
    expect(screen.getByText("ارسال پاسخ ناموفق بود.")).toBeInTheDocument();
  });

  test("auto dismisses timed toast in the designed 4-6 second window", () => {
    vi.useFakeTimers();
    render(<FeedbackProvider locale="fa"><ToastHarness /></FeedbackProvider>);
    fireEvent.click(screen.getByRole("button", {name: "success"}));
    expect(screen.getByText("تنظیمات ذخیره شد.")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByText("تنظیمات ذخیره شد.")).not.toBeInTheDocument();
  });

  test("inline error alert uses assertive alert semantics", () => {
    render(<InlineAlert locale="fa" tone="error">اتصال به سرویس قطع شد.</InlineAlert>);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("خطا");
    expect(alert).toHaveTextContent("اتصال به سرویس قطع شد.");
  });

  test("destructive confirmation calls explicit cancel and confirm actions", async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn(async () => undefined);
    render(
      <ConfirmationStrip
        message="آیا مطمئن هستید این تلاش حذف شود؟"
        cancelLabel="لغو"
        confirmLabel="حذف"
        onCancel={onCancel}
        onConfirm={onConfirm}
        destructive
        ariaLabel="تأیید حذف تلاش"
      />,
    );
    fireEvent.click(screen.getByRole("button", {name: "لغو"}));
    expect(onCancel).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", {name: "حذف"}));
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
