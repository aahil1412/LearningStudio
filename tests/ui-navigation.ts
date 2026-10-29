import { expect, type Locator, type Page } from "@playwright/test";

const learningTools = [
  ["Highlights & annotations", "Annotations"],
  ["Research & sources", "Research"],
  ["Living textbook", "Textbook"],
  ["Visual notebook", "Visuals"],
  ["Document study", "Documents"],
  ["Learning canvas", "Canvas"],
] as const;

async function expandDetails(details: Locator) {
  if ((await details.getAttribute("open")) === null)
    await details.locator(":scope > summary").click();
  await expect(details).toHaveAttribute("open", "");
}

/** Follow the same global navigation and tools menu used by a learner. */
export async function openDestination(page: Page, name: string | RegExp) {
  const destinations = [
    {
      aliases: [
        "Knowledge graph",
        "Knowledge graph: Map",
        "Knowledge graph: Connections",
      ],
      names: ["Knowledge graph: Connections", "Knowledge graph: Map"],
    },
    {
      aliases: [
        "Subject workspaces",
        "Subject workspaces: Subjects",
        "Subject workspaces: My learning",
      ],
      names: [
        "Subject workspaces: My learning",
        "Subject workspaces: Subjects",
      ],
    },
    {
      aliases: [
        "Learning workspace",
        "Learning workspace: Study",
        "Learning workspace: Lesson",
      ],
      names: ["Learning workspace: Lesson", "Learning workspace: Study"],
    },
  ];
  const destination = destinations.find(
    (item) => typeof name === "string" && item.aliases.includes(name),
  );
  if (destination) {
    const navigation = page.getByRole("navigation", {
      name: "Main navigation",
      exact: true,
    });
    for (const label of destination.names) {
      const control = navigation.getByRole("button", {
        name: label,
        exact: true,
      });
      if (await control.count()) {
        await control.click();
        return;
      }
    }
  }
  const tool = learningTools.find((labels) =>
    labels.some((label) =>
      typeof name === "string" ? label === name : name.test(label),
    ),
  );
  if (tool) {
    await expandDetails(page.locator("details.studio-tools-menu"));
    await page.getByRole("menuitem", { name: tool[0], exact: true }).click();
    return;
  }
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name, exact: typeof name === "string" })
    .click();
}

/** Subject controls use their visible learning-oriented names in the new UI. */
export async function openSubjectTab(page: Page, name: string | RegExp) {
  const names = [
    ["Overview", "Dashboard"],
    ["Your pathway", "Learning pathway"],
    ["Sessions", "Conversations"],
    ["Study material", "Resources"],
    ["Learning record", "Shared memory"],
    ["Search", "Search subject"],
  ].find((labels) =>
    labels.some((label) =>
      typeof name === "string" ? label === name : name.test(label),
    ),
  );
  const navigation = page.getByRole("navigation", {
    name: "Subject tools",
    exact: true,
  });
  for (const label of names || []) {
    const button = navigation.getByRole("button", { name: label, exact: true });
    if (await button.count()) {
      await button.click();
      return;
    }
  }
  await navigation
    .getByRole("button", { name, exact: typeof name === "string" })
    .click();
}

/** This is the subject's lesson action, distinct from the app breadcrumb plus. */
export async function startSubjectLesson(page: Page) {
  await page
    .locator(".subject-header-actions")
    .getByRole("button", { name: /^(Start a lesson|New subject chat)$/ })
    .click();
}

export async function openMessageActions(message: Locator) {
  await expandDetails(message.locator("details.studio-message-actions"));
}

export async function openReadingControls(page: Page) {
  await expandDetails(page.locator("details.folio-reading-menu"));
}

/** The tutor is a deliberate in-lesson action in the learning-first layout. */
export async function openTutor(page: Page) {
  const input = page.getByLabel("Message the tutor", { exact: true });
  if (await input.isVisible()) return;
  if (!(await page.getByTestId("learning-player").isVisible()))
    await openDestination(page, "Learning workspace");
  const ask = page.getByRole("button", {
    name: "Ask about this page",
    exact: true,
  });
  if (!(await ask.isVisible())) {
    const returnToLesson = page.getByRole("button", {
      name: "Return to lesson",
      exact: true,
    });
    if (await returnToLesson.isVisible()) await returnToLesson.click();
  }
  if (await ask.isVisible()) await ask.click();
  await expect(input).toBeVisible();
}

/** History is secondary, but the original messages and actions remain usable. */
export async function openConversationRecord(page: Page) {
  if (!(await page.getByTestId("learning-player").isVisible()))
    await openDestination(page, "Learning workspace");
  const returnToLesson = page.getByRole("button", {
    name: "Return to lesson",
    exact: true,
  });
  if (await returnToLesson.isVisible()) return;
  await page.getByTestId("learning-player-history").click();
  await expect(returnToLesson).toBeVisible();
}

export async function openLessonOutline(page: Page) {
  // The original per-conversation outline is retained in the secondary record;
  // focused study uses the subject path and section navigator instead.
  await openConversationRecord(page);
  await expandDetails(page.locator("details.studio-lesson-context"));
}

export async function openRoadmap(page: Page) {
  await openLessonOutline(page);
  await expandDetails(page.locator("details.roadmap"));
}

export async function openConversation(page: Page, title: string) {
  const browser = page.getByRole("dialog", {
    name: "Conversation browser",
    exact: true,
  });
  if (!(await browser.isVisible())) await page.keyboard.press("Control+k");
  await expect(browser).toBeVisible();
  await browser.getByLabel("Search sessions", { exact: true }).fill(title);
  await browser.locator(".session-item").filter({ hasText: title }).click();
  await expect(browser).toHaveCount(0);
}
