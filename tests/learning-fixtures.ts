import { expect, type Page } from "@playwright/test";
import { makeExampleLesson } from "../src/lib/teaching";
import type { StudioData } from "../src/types";
import { openDestination } from "./ui-navigation";

/** Keep legacy renderer coverage independent of which examples the home features. */
export async function seedReferenceLesson(page: Page) {
  const lesson = await page.evaluate(async (fixture) => {
    const subjects =
      await window.studio!.invoke<{ id: string; name: string }[]>(
        "subject:list",
      );
    const subject =
      subjects.find((item) => item.name === fixture.subject) ||
      (await window.studio!.invoke<{ id: string }>("subject:create", {
        name: fixture.subject,
        objective: fixture.objective,
        depth: "comprehensive",
      }));
    const data = await window.studio!.invoke<StudioData>("data:load");
    const existing = data.lessons.find(
      (item) =>
        item.subjectId === subject.id &&
        item.example &&
        item.title === fixture.title,
    );
    const selected = existing || { ...fixture, subjectId: subject.id };
    await window.studio!.invoke("data:save", {
      ...data,
      activeSubjectId: subject.id,
      activeLessonId: selected.id,
      lessons: existing ? data.lessons : [selected, ...data.lessons],
    });
    return selected;
  }, makeExampleLesson());
  await page.reload();
  await openDestination(page, "Learning workspace: Lesson");
  await expect(page.locator(".lesson-top h1")).toHaveText(lesson.title);
  return lesson;
}

/** Use the supported keyboard route to the actual new-session form. */
export async function createLearningSession(page: Page, goal: string) {
  await page.keyboard.press("Control+n");
  const form = page.getByRole("dialog", {
    name: "New learning session",
    exact: true,
  });
  await expect(form).toBeVisible();
  await form.getByLabel("Learning goal", { exact: true }).fill(goal);
  await form
    .getByRole("button", { name: "Create learning session", exact: true })
    .click();
  await expect(form).toHaveCount(0);
  await expect(page.locator(".lesson-top h1")).toHaveText(goal);
}
