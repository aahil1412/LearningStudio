import { openDestination, openSubjectTab } from "./ui-navigation";
import { test, expect, _electron as electron } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sanitizeAppearance } from "../src/lib/themes";
import type { StudioData } from "../src/types";
test("subject, pathway, memory, search, textbook and document interfaces remain accessible in light, dark and custom themes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-v2-appearance-")),
    env = Object.fromEntries(
      Object.entries({ ...process.env, STUDIO_DATA_DIR: directory }).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.STUDIO_DEV_URL;
  const app = await electron.launch({ args: ["."], cwd: process.cwd(), env }),
    page = await app.firstWindow(),
    audits: { scheme: string; view: string; violations: unknown[] }[] = [];
  try {
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1550, 1000),
    );
    await expect(page.locator(".titlebar-center")).toHaveText("Saved locally");
    const subject = await page.evaluate(async () => {
      const api = window.studio!.invoke;
      const subject = await api<any>("subject:create", {
        name: "Appearance study",
        objective: "Connect explanations, evidence, and sources",
        depth: "comprehensive",
      });
      await api("subject:apply", {
        subjectId: subject.id,
        baseRevision: subject.revision,
        label: "Themed pathway",
        origin: "learner",
        operations: [
          {
            entity: "curriculum",
            op: "put",
            id: "theme-module",
            value: {
              kind: "module",
              title: "Foundations",
              description: "A flexible module",
              status: "introduced",
            },
          },
          {
            entity: "curriculum",
            op: "put",
            id: "theme-topic",
            value: {
              kind: "topic",
              parentId: "theme-module",
              title: "Systems",
              description: "Explore boundaries",
              status: "covered",
            },
          },
          {
            entity: "memory",
            op: "put",
            id: "theme-question",
            value: {
              kind: "question",
              title: "An unresolved question",
              content: "Which assumptions change the system boundary?",
              conceptIds: [],
            },
          },
        ],
      });
      await api("subject:record-put", {
        subjectId: subject.id,
        recordType: "chapter",
        id: "theme-chapter",
        title: "A connected explanation",
        data: {
          markdown:
            "# A connected explanation\n\nA **careful model** makes its *assumptions* explicit.\n\n$$\\Delta E=Q-W$$",
          blocks: [
            {
              type: "diagram",
              spec: {
                title: "From assumptions to evidence",
                nodes: [
                  { id: "a", label: "Assumptions" },
                  { id: "b", label: "Evidence" },
                ],
                edges: [{ from: "a", to: "b" }],
              },
            },
          ],
        },
      });
      const data = await api<StudioData>("data:load");
      data.activeSubjectId = subject.id;
      data.library.push({
        id: "theme-document",
        subjectId: subject.id,
        subject: subject.name,
        kind: "document",
        title: "A cited source",
        content: "A closed system exchanges no matter.",
        pages: [{ page: 1, text: "A closed system exchanges no matter." }],
        verified: false,
        createdAt: new Date().toISOString(),
      });
      await api("data:save", data);
      return subject;
    });
    const openSubject = async () => {
      await openDestination(page, "Subject workspaces: Subjects");
      await page
        .locator(".subject-tile")
        .filter({ hasText: "Appearance study" })
        .click();
      await expect(
        page.getByRole("heading", {
          name: "Appearance study",
          level: 1,
          exact: true,
        }),
      ).toBeVisible();
    };
    const scan = async (scheme: string, view: string) => {
      const results = await new AxeBuilder({ page })
        .setLegacyMode(true)
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const violations = results.violations
        .filter(
          (violation) =>
            violation.impact === "serious" || violation.impact === "critical",
        )
        .map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          targets: violation.nodes.map((node) => node.target),
        }));
      audits.push({ scheme, view, violations });
    };
    for (const scheme of ["light", "dark", "custom"]) {
      const data = await page.evaluate(() =>
          window.studio!.invoke<StudioData>("data:load"),
        ),
        appearance = sanitizeAppearance(data.appearance);
      appearance.mode = scheme === "dark" ? "dark" : "light";
      if (scheme === "custom") {
        appearance.light.colors.bg = "#dfe8dd";
        appearance.light.colors.reading = "#e4ecdf";
        appearance.light.colors.bold = "#284a33";
      }
      await page.evaluate(
        (value) => window.studio!.invoke("data:save", value),
        { ...data, appearance },
      );
      await page.reload();
      await openSubject();
      await scan(scheme, "Subject dashboard");
      await openSubjectTab(page, "Learning pathway");
      await scan(scheme, "Curriculum");
      await openSubjectTab(page, "Shared memory");
      await scan(scheme, "Shared memory");
      await openSubjectTab(page, "Search subject");
      await scan(scheme, "Subject search");
      await openDestination(page, "Textbook");
      await page
        .locator(".v2-chapter-list")
        .getByRole("button", { name: /A connected explanation/ })
        .click();
      await expect(page.locator(".v2-chapter-preview .katex")).toBeVisible();
      await scan(scheme, "Living textbook");
      await page.screenshot({
        path: "docs/screenshots/v2-textbook-" + scheme + ".png",
      });
      await openSubject();
      await openDestination(page, "Documents");
      await page
        .getByLabel("Study document", { exact: true })
        .selectOption("theme-document");
      await expect(page.locator(".v2-document-page-text")).toContainText(
        "exchanges no matter",
      );
      await scan(scheme, "Document study");
      expect(
        (
          await page.evaluate(
            (subjectId) =>
              window.studio!.invoke<any>("subject:get", {
                subjectId,
              }),
            subject.id,
          )
        ).subject.id,
      ).toBe(subject.id);
    }
    expect(audits.filter((audit) => audit.violations.length)).toEqual([]);
  } finally {
    await writeFile(
      "docs/v2-workspace-accessibility-results.json",
      JSON.stringify(audits, null, 2),
    );
    await app.close();
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 200,
    });
  }
});
