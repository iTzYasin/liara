import { describe, expect, it } from "vitest";
import { advanceWorkflow, workflowContext } from "@/modules/agent/workflow-state";

describe("agent workflow state", () => {
  it("creates an explicit multi-step plan without claiming completion", () => {
    const state = advanceWorkflow(undefined, {
      message: "دامنه را اضافه کنم و SSL را فعال کنم",
      intent: "guided-setup",
      outcome: "answer",
      proposedSteps: ["دامنه را در پنل ثبت کنید. [[1]]", "SSL را فعال کنید. [[2]]"],
    });

    expect(state).toMatchObject({
      phase: "active",
      goal: "دامنه را اضافه کنم و SSL را فعال کنم",
      turnCount: 1,
      steps: [
        { label: "دامنه را در پنل ثبت کنید.", status: "current" },
        { label: "SSL را فعال کنید.", status: "pending" },
      ],
    });
  });

  it("never persists provider-specific citation markers in workflow labels", () => {
    const state = advanceWorkflow(undefined, {
      message: "دامنه را وصل کنم",
      intent: "guided-setup",
      outcome: "answer",
      proposedSteps: ["دامنه را ثبت کنید. [[منبع 3]] [[1]]"],
    });

    expect(state?.steps[0]?.label).toBe("دامنه را ثبت کنید.");
  });

  it("only confirms a current action after explicit user confirmation", () => {
    const initial = advanceWorkflow(undefined, {
      message: "دامنه و SSL",
      intent: "guided-setup",
      outcome: "answer",
      proposedSteps: ["ثبت دامنه", "فعال‌سازی SSL"],
    });
    const continued = advanceWorkflow(initial, {
      message: "مرحله اول انجام شد، بعدی چیه؟",
      intent: "follow-up",
      outcome: "answer",
      proposedSteps: [],
    });

    expect(continued?.steps).toEqual([
      expect.objectContaining({ label: "ثبت دامنه", status: "confirmed" }),
      expect.objectContaining({ label: "فعال‌سازی SSL", status: "current" }),
    ]);
    expect(workflowContext(continued)).toMatch(/تأییدشده توسط کاربر.*ثبت دامنه/);
  });

  it("marks the flow resolved only when the user says the issue is solved", () => {
    const initial = advanceWorkflow(undefined, {
      message: "رفع خطا",
      intent: "troubleshooting",
      outcome: "answer",
      proposedSteps: ["بررسی لاگ", "اجرای مجدد"],
    });
    const resolved = advanceWorkflow(initial, {
      message: "مشکل حل شد، ممنون",
      intent: "follow-up",
      outcome: "answer",
      proposedSteps: [],
    });

    expect(resolved?.phase).toBe("resolved");
    expect(resolved?.steps.every((step) => step.status === "confirmed")).toBe(true);
  });

  it("reconciles unconfirmed steps when a better grounded plan replaces them", () => {
    const mistaken = advanceWorkflow(undefined, {
      message: "دامنه و SSL",
      intent: "guided-setup",
      outcome: "answer",
      proposedSteps: ["اتصال دامنه به باکت", "اتصال دامنه به برنامه"],
    });
    const corrected = advanceWorkflow(mistaken, {
      message: "منظورم برنامه پلتفرمی و SSL است",
      intent: "guided-setup",
      outcome: "answer",
      proposedSteps: ["اتصال دامنه به برنامه", "فعال‌سازی SSL"],
    });

    expect(corrected?.steps.map((step) => step.label)).toEqual([
      "اتصال دامنه به برنامه",
      "فعال‌سازی SSL",
    ]);
    expect(corrected?.steps[0].status).toBe("current");
  });
});
