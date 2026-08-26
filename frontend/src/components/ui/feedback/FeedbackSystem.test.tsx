import {act, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, expect, test, vi} from "vitest";
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
      <button type="button" onClick={() => feedback.success("Saved", {id: "one", durationMs: 1000})}>success</button>
      <button type="button" onClick={() => feedback.info("Info", {id: "two", durationMs: null})}>info</button>
      <button type="button" onClick={() => feedback.warning("Warning", {id: "three", durationMs: null})}>warning</button>
      <button type="button" onClick={() => feedback.error("Error", {id: "four", durationMs: null})}>error</button>
    </div>
  );
}

afterEach(() => {
  vi.useRealTimers();
});

test("toast uses an accessible live role and auto-dismisses", () => {
  vi.useFakeTimers();
  render(
    <FeedbackProvider locale="en">
      <ToastHarness />
    </FeedbackProvider>,
  );

  fireEvent.click(screen.getByRole("button", {name: "success"}));
  expect(screen.getByRole("status")).toHaveTextContent("Saved");

  act(() => { vi.advanceTimersByTime(1100); });
  expect(screen.queryByText("Saved")).not.toBeInTheDocument();
});

test("toast stack keeps at most three visible items and Escape dismisses the newest", () => {
  render(
    <FeedbackProvider locale="en" maxVisible={3}>
      <ToastHarness />
    </FeedbackProvider>,
  );

  fireEvent.click(screen.getByRole("button", {name: "success"}));
  fireEvent.click(screen.getByRole("button", {name: "info"}));
  fireEvent.click(screen.getByRole("button", {name: "warning"}));
  fireEvent.click(screen.getByRole("button", {name: "error"}));

  expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  expect(screen.getByText("Info")).toBeInTheDocument();
  expect(screen.getByText("Warning")).toBeInTheDocument();
  expect(screen.getByText("Error")).toBeInTheDocument();

  fireEvent.keyDown(document, {key: "Escape"});
  expect(screen.queryByText("Error")).not.toBeInTheDocument();
});

test("inline error is announced as an alert", () => {
  render(<InlineAlert tone="error" title="Error">Connection failed.</InlineAlert>);
  expect(screen.getByRole("alert")).toHaveTextContent("Connection failed.");
});

test("confirmation strip calls confirm and cancel explicitly", async () => {
  const confirm = vi.fn(async () => undefined);
  const cancel = vi.fn();
  render(
    <ConfirmationStrip
      message="Delete this attempt?"
      confirmLabel="Delete"
      cancelLabel="Cancel"
      onConfirm={confirm}
      onCancel={cancel}
    />,
  );

  fireEvent.click(screen.getByRole("button", {name: "Cancel"}));
  expect(cancel).toHaveBeenCalledTimes(1);

  await act(async () => {
    fireEvent.click(screen.getByRole("button", {name: "Delete"}));
  });
  expect(confirm).toHaveBeenCalledTimes(1);
});
