import { openDestination } from "./ui-navigation";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
  type Locator,
} from "@playwright/test";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
let app: ElectronApplication, page: Page;
let authoring: Locator;
test.beforeEach(async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "learning-studio-advanced-visuals-"),
  );
  const env = Object.fromEntries(
    Object.entries({ ...process.env, STUDIO_DATA_DIR: directory }).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.STUDIO_DEV_URL;
  app = await electron.launch({
    args: [".", "--start-hidden"],
    cwd: process.cwd(),
    env,
    timeout: 30000,
  });
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.webContents.setBackgroundThrottling(false);
    window.setContentSize(1500, 1100);
  });
  await expect(
    page.getByRole("heading", { name: "Your learning", exact: true }),
  ).toBeVisible();
  // Authoring remains available in a subject notebook. It does not open a
  // lesson side panel or create an unrelated preset figure at startup.
  const subject = await page.evaluate(async () =>
    window.studio!.invoke<{ id: string; name: string }>("subject:create", {
      name: "Advanced figure authoring",
      objective: "Inspect explicitly selected scientific rendering tools",
      depth: "overview",
    }),
  );
  await openDestination(page, "Subject workspaces: My learning");
  await page.locator(".subject-tile").filter({ hasText: subject.name }).click();
  await openDestination(page, "Visual notebook");
  await page
    .getByRole("button", { name: "Author a figure", exact: true })
    .click();
  authoring = page.getByRole("region", {
    name: "Figure authoring tools",
    exact: true,
  });
  await expect(authoring).toBeVisible();
  await expect(
    page.locator(".plot-canvas, .science-plot-canvas, .molecule-canvas"),
  ).toHaveCount(0);
});
test.afterEach(async () => {
  await app?.close();
});
test("custom formulas derive symbolically and reject executable source without losing the usable model", async () => {
  await page.getByRole("tab", { name: "Create", exact: true }).click();
  await expect(authoring.locator(".science-plot-canvas")).toHaveCount(0);
  await page
    .getByLabel("Scientific expressions", { exact: true })
    .fill("sin(x)*exp(-x^2)");
  await page.getByLabel("Scientific parameters", { exact: true }).fill("{}");
  await page
    .getByRole("button", { name: "Apply mathematical model", exact: true })
    .click();
  await expect(
    authoring.locator(".science-plot-canvas .main-svg").first(),
  ).toBeVisible();
  await expect(authoring.locator(".science-symbolic")).toContainText(
    "Symbolic derivative",
  );
  await expect
    .poll(() =>
      authoring
        .locator(".science-plot-canvas")
        .evaluate((element) => (element as any).data?.length),
    )
    .toBe(2);
  await page
    .getByLabel("Scientific expressions", { exact: true })
    .fill("globalThis.process.exit()");
  await page
    .getByRole("button", { name: "Apply mathematical model", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Invalid mathematical model",
  );
  await expect(
    authoring.locator(".science-plot-canvas .main-svg").first(),
  ).toBeVisible();
  await page.getByLabel("Scientific expressions", { exact: true }).fill("x^3");
  await page
    .getByRole("button", { name: "Apply mathematical model", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(authoring.locator(".science-symbolic code")).toContainText("3");
});
test("custom Three.js surfaces and vector fields render computed geometry and respond to camera interaction", async () => {
  await page.getByRole("tab", { name: "Create", exact: true }).click();
  await page
    .getByLabel("Custom scientific representation", { exact: true })
    .selectOption("surface");
  await page
    .getByRole("button", { name: "Apply mathematical model", exact: true })
    .click();
  await expect(authoring.locator(".science-three-canvas canvas")).toBeVisible();
  const box = await authoring
    .locator(".science-three-canvas canvas")
    .boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width / 2 + 40,
    box!.y + box!.height / 2 + 20,
    { steps: 5 },
  );
  await page.mouse.up();
  await page.getByRole("button", { name: "Reset camera", exact: true }).click();
  await mkdir("docs/screenshots", { recursive: true });
  await page.screenshot({ path: "docs/screenshots/advanced-surface.png" });
  await page
    .getByLabel("Custom scientific representation", { exact: true })
    .selectOption("vector");
  await page
    .getByRole("button", { name: "Apply mathematical model", exact: true })
    .click();
  await expect(authoring.locator(".science-three-canvas canvas")).toBeVisible();
  await expect(authoring.locator(".visual-error")).toHaveCount(0);
  await expect(authoring.locator(".science-axis-legend")).toContainText("Z");
});
test("a newly authored nonlinear ODE runs as validated derivatives with time playback", async () => {
  await page.getByRole("tab", { name: "Create", exact: true }).click();
  await page
    .getByLabel("Custom scientific representation", { exact: true })
    .selectOption("ode");
  await page.getByLabel("ODE variables", { exact: true }).fill("x,y,z");
  await page
    .getByLabel("Scientific expressions", { exact: true })
    .fill("sigma*(y-x)\nx*(rho-z)-y\nx*y-beta*z");
  await page.getByLabel("ODE initial state", { exact: true }).fill("1,1,1");
  await page
    .getByLabel("Scientific parameters", { exact: true })
    .fill('{"sigma":10,"rho":28,"beta":2.6666666667}');
  await page.getByLabel("Scientific domain", { exact: true }).fill("0,4");
  await page.getByLabel("ODE integration step", { exact: true }).fill("0.005");
  await page
    .getByRole("button", { name: "Apply mathematical model", exact: true })
    .click();
  await expect
    .poll(() =>
      authoring
        .locator(".science-plot-canvas")
        .evaluate((element) => (element as any).data?.length),
    )
    .toBe(3);
  await page
    .getByRole("button", { name: "Play simulation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Pause simulation", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Pause simulation", exact: true })
    .click();
  await expect(authoring.locator(".visual-error")).toHaveCount(0);
  await mkdir("docs/screenshots", { recursive: true });
  await page.screenshot({ path: "docs/screenshots/advanced-ode.png" });
});
test("a typed chemical block renders validated chemical connectivity locally through RDKit", async () => {
  await page.evaluate(async () => {
    const d: any = await window.studio!.invoke("data:load");
    const now = new Date().toISOString();
    d.lessons = [
      {
        id: "chemistry-acceptance",
        title: "Local chemistry verification",
        subject: "Chemistry",
        mode: "Explore",
        objective: "Inspect supplied chemical connectivity",
        position: "Beginning",
        notes: "",
        createdAt: now,
        updatedAt: now,
        messages: [
          {
            id: "chemical-message",
            role: "assistant",
            text: "This supplied SMILES is rendered locally.",
            createdAt: now,
            status: "complete",
            blocks: [
              {
                type: "chemical",
                input: "CC(=O)Oc1ccccc1C(=O)O",
                format: "smiles",
                caption: "Aspirin · local RDKit",
              },
            ],
          },
        ],
      },
    ];
    d.activeLessonId = "chemistry-acceptance";
    await window.studio!.invoke("data:save", d);
  });
  await page.reload();
  await openDestination(page, "Learning workspace: Lesson");
  await expect(page.locator(".local-chemical-svg")).toBeVisible({
    timeout: 30000,
  });
  await expect
    .poll(() =>
      page
        .locator(".local-chemical-svg")
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(page.locator(".local-chemistry")).toContainText("RDKit");
  await expect(page.locator(".visual-error")).toHaveCount(0);
  await mkdir("docs/screenshots", { recursive: true });
  await page.screenshot({ path: "docs/screenshots/local-rdkit-chemistry.png" });
  const lightSvg = await page
    .locator(".local-chemical-svg")
    .getAttribute("src");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .locator(".appearance-modes")
    .getByRole("button", { name: "Dark", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  await expect
    .poll(() => page.locator(".local-chemical-svg").getAttribute("src"))
    .not.toBe(lightSvg);
  await expect
    .poll(() =>
      page
        .locator(".local-chemical-svg")
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.screenshot({
    path: "docs/screenshots/local-rdkit-chemistry-dark.png",
  });
});
test("real molecular comparison aligns, reports RMSD and measures angles and torsions @network", async () => {
  test.skip(
    !process.env.STUDIO_NETWORK_TESTS,
    "Enable real scientific resource verification with STUDIO_NETWORK_TESTS=1.",
  );
  await page.getByRole("tab", { name: "Molecules", exact: true }).click();
  await expect(authoring.locator(".molecule-canvas canvas")).toBeVisible({
    timeout: 30000,
  });
  await page
    .getByRole("button", { name: "Compare with identifier", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Remove comparison", exact: true }),
  ).toBeVisible();
  await page
    .getByText("Alignment, selection & trajectory tools", { exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Align comparison & calculate RMSD",
      exact: true,
    })
    .click();
  await expect(authoring.locator(".molecular-alignment")).toContainText(
    "RMSD = 0.00000 Å",
  );
  await page
    .getByLabel("Residue expression", { exact: true })
    .fill("chain:A resi:1-3 atom:CA");
  await page
    .getByRole("button", { name: "Apply molecular selection", exact: true })
    .click();
  await expect(authoring.locator(".molecular-advanced").first()).toContainText(
    "6 atoms selected.",
  );
  await page
    .getByLabel("Molecular selection mode", { exact: true })
    .selectOption("angle");
  for (const serial of ["1", "2", "3"]) {
    await page.getByLabel("Atom serial number", { exact: true }).fill(serial);
    await page
      .getByRole("button", { name: "Select source atom", exact: true })
      .click();
  }
  await expect(authoring.locator(".molecule-selection")).toContainText("Angle");
  await page
    .getByLabel("Molecular selection mode", { exact: true })
    .selectOption("torsion");
  for (const serial of ["1", "2", "3", "4"]) {
    await page.getByLabel("Atom serial number", { exact: true }).fill(serial);
    await page
      .getByRole("button", { name: "Select source atom", exact: true })
      .click();
  }
  await expect(authoring.locator(".molecule-selection")).toContainText(
    "Torsion",
  );
  await expect(authoring.locator(".visual-error")).toHaveCount(0);
  await page.getByLabel("Structure identifier", { exact: true }).fill("1D3Z");
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await expect(page.getByText(/Compatible PDB trajectory/)).toBeVisible({
    timeout: 30000,
  });
  await page
    .getByRole("button", { name: "Play trajectory", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Pause trajectory", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByLabel("Molecular trajectory frame", { exact: true })
        .inputValue(),
    )
    .not.toBe("0");
  await page
    .getByRole("button", { name: "Pause trajectory", exact: true })
    .click();
  await expect(authoring.locator(".visual-error")).toHaveCount(0);
});
