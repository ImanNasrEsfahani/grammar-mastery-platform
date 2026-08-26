import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import {describe, expect, it, vi} from "vitest";
import {useState} from "react";
import {
  ConfirmModal,
  DestructiveModal,
  FilterDrawer,
  MobileBottomDrawer,
} from "./ModalDrawerSystem";

function ConfirmHarness({onConfirm = () => undefined}: {onConfirm?: () => void}) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button">Trigger</button>
      <ConfirmModal
        open={open}
        onOpenChange={setOpen}
        title="تأیید شروع تمرین"
        description="۲۰ سؤال از درس‌های انتخاب‌شده"
        confirmLabel="شروع تمرین"
        cancelLabel="انصراف"
        onConfirm={onConfirm}
        closeLabel="بستن"
        testId="confirm-modal"
      />
    </>
  );
}

describe("ModalDrawerSystem", () => {
  it("renders an accessible modal and closes it with Escape", async () => {
    render(<ConfirmHarness />);
    const dialog = await screen.findByRole("dialog", {name: "تأیید شروع تمرین"});
    expect(dialog).toHaveAttribute("aria-modal", "true");
    fireEvent.keyDown(document, {key: "Escape"});
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("does not dismiss a confirmation modal from a backdrop click by default", async () => {
    render(<ConfirmHarness />);
    const backdrop = await screen.findByTestId("confirm-modal-backdrop");
    fireEvent.pointerDown(backdrop);
    expect(screen.getByRole("dialog", {name: "تأیید شروع تمرین"})).toBeInTheDocument();
  });

  it("keeps destructive confirmation explicit and focuses the safe action first", async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <DestructiveModal
        open
        onOpenChange={onOpenChange}
        title="خروج از جلسه؟"
        description="پاسخ ثبت‌نشده از بین می‌رود."
        confirmLabel="خروج"
        cancelLabel="ادامه جلسه"
        onConfirm={onConfirm}
        testId="destructive-modal"
      />,
    );

    const cancel = await screen.findByRole("button", {name: "ادامه جلسه"});
    await waitFor(() => expect(cancel).toHaveFocus());
    fireEvent.click(screen.getByRole("button", {name: "خروج"}));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalledWith(false, "backdrop");
  });

  it("traps keyboard focus inside the top overlay", async () => {
    render(<ConfirmHarness />);
    const cancel = await screen.findByRole("button", {name: "انصراف"});
    const confirm = screen.getByRole("button", {name: "شروع تمرین"});
    await waitFor(() => expect(confirm).toHaveFocus());

    confirm.focus();
    fireEvent.keyDown(screen.getByRole("dialog"), {key: "Tab"});
    expect(cancel).toHaveFocus();

    cancel.focus();
    fireEvent.keyDown(screen.getByRole("dialog"), {key: "Tab", shiftKey: true});
    expect(confirm).toHaveFocus();
  });

  it("renders a right filter drawer and a mobile bottom drawer", async () => {
    const {rerender} = render(
      <FilterDrawer open onOpenChange={() => undefined} title="فیلترها" testId="filter-drawer">
        <label htmlFor="mastery">Mastery</label>
        <select id="mastery"><option>همه</option></select>
      </FilterDrawer>,
    );
    expect(await screen.findByRole("dialog", {name: "فیلترها"})).toBeInTheDocument();

    rerender(
      <MobileBottomDrawer open onOpenChange={() => undefined} title="تعداد سؤال" testId="bottom-drawer">
        <button type="button">۱۰ سؤال</button>
      </MobileBottomDrawer>,
    );
    expect(await screen.findByRole("dialog", {name: "تعداد سؤال"})).toBeInTheDocument();
  });

  it("locks background scrolling while an overlay is mounted and restores it after close", async () => {
    const {unmount} = render(<ConfirmHarness />);
    await screen.findByRole("dialog");
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });
});
