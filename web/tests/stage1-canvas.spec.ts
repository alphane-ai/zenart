import { expect, test } from "@playwright/test";

const applyEditContract =
  "createUpload:POST:/uploads:include:X-Zenari-CSRF:true|createCanvasNode:POST:/workspaces/{workspace_id}/canvas/nodes:include:X-Zenari-CSRF:true|createCanvasVersion:POST:/workspaces/{workspace_id}/canvas/versions:include:X-Zenari-CSRF:true";
const restoreVersionContract = "createCanvasVersion:POST:/workspaces/{workspace_id}/canvas/versions:include:X-Zenari-CSRF:true";

test("canvas toolbar, layers, keyboard, edit tools, and versions remain locally covered", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });

  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: "Launch Direction Board" })).toBeVisible();

  const canvas = page.getByLabel("Stage 1 canvas editor");
  await expect(canvas).toHaveAttribute("data-canvas-interaction-contract", "stage1.canvas-interaction-user-contract");
  await expect(canvas).toHaveAttribute("data-canvas-interaction-status", "local");
  await expect(canvas).toHaveAttribute("data-canvas-tool", "select");
  await expect(canvas).toHaveAttribute("data-canvas-zoom", "1.00");
  await expect(canvas).toHaveAttribute("data-canvas-toolbar-tools", "select,hand,frame,text,shape,upload");
  await expect(canvas).toHaveAttribute(
    "data-canvas-keyboard-shortcuts",
    "delete,duplicate,undo,redo,zoom_in,zoom_out,space_hand,shift_multi_select"
  );
  await expect(canvas).toHaveAttribute("data-canvas-layers-panel", "enabled");

  const toolbar = page.getByLabel("Canvas toolbar");
  await expect(toolbar).toHaveAttribute("data-canvas-toolbar", "stage1.canvas-toolbar");
  await expect(page.getByLabel("Canvas layers")).toHaveAttribute("data-canvas-layers-panel", "stage1.canvas-layers-panel");

  const versionHistory = page.getByLabel("Canvas version history");
  await expect(versionHistory).toHaveAttribute("data-canvas-version-history", "stage1.canvas-version-history");
  await expect(versionHistory).toHaveAttribute("data-canvas-version-active-id", "version-001");
  await expect(page.getByRole("button", { name: "Initial brief" })).toHaveAttribute("data-canvas-version-entry", "version-001");

  const editTools = page.getByLabel("Edit tools and mask");
  await expect(editTools).toHaveAttribute("data-edit-tools-contract", "stage1.edit-tools-mask-local-contract");
  await expect(editTools).toHaveAttribute("data-edit-tools-active-tool", "erase");
  await expect(editTools).toHaveAttribute("data-edit-tools-mask-width", "1024");
  await expect(editTools).toHaveAttribute("data-edit-tools-mask-height", "768");
  await expect(editTools).toHaveAttribute("data-edit-tools-mask-aligned", "true");
  await expect(page.getByRole("button", { name: "Apply Edit" })).toHaveAttribute("data-csrf-ux-guard-contracts", applyEditContract);

  await page.getByRole("button", { name: "Canvas tool hand" }).click();
  await expect(canvas).toHaveAttribute("data-canvas-tool", "hand");

  await page.getByRole("button", { name: "Zoom in canvas" }).click();
  await expect(canvas).toHaveAttribute("data-canvas-zoom", "1.10");

  await page.getByRole("button", { name: "Fit" }).click();
  await expect(canvas).toHaveAttribute("data-canvas-last-action", "fit");
  await expect(canvas).toHaveAttribute("data-canvas-zoom", "1.00");

  await page.getByRole("button", { name: "Select Studio System" }).click();
  await expect(canvas).toHaveAttribute("data-canvas-selected-node-ids", "node-cand-studio");
  await expect(versionHistory).toHaveAttribute("data-canvas-version-active-id", "version-002");

  const studioNode = page.locator("[data-canvas-node='node-cand-studio']");
  await expect(studioNode).toHaveAttribute("data-canvas-node-selected", "true");
  await expect(page.getByRole("button", { name: "Selected Studio System" })).toHaveAttribute(
    "data-canvas-version-diff-added",
    "node-cand-studio"
  );

  await page.getByRole("button", { name: "Move Studio System" }).click();
  await expect(canvas).toHaveAttribute("data-canvas-last-action", "drag");
  await expect(page.getByRole("button", { name: "Canvas move" })).toHaveAttribute(
    "data-canvas-version-diff-changed",
    "node-cand-studio"
  );

  await page.getByRole("button", { name: "Lock Studio System" }).click();
  await expect(canvas).toHaveAttribute("data-canvas-locked-node-count", "1");
  await expect(page.locator("[data-canvas-layer-row='node-cand-studio']")).toHaveAttribute("data-canvas-layer-locked", "true");

  await page.getByRole("button", { name: "Unlock Studio System" }).click();
  await expect(canvas).toHaveAttribute("data-canvas-locked-node-count", "0");

  await canvas.press("Meta+D");
  await expect(canvas).toHaveAttribute("data-canvas-selected-node-ids", /node-cand-studio-copy-/);
  await expect(page.getByRole("button", { name: "Canvas duplicate" })).toHaveAttribute(
    "data-canvas-version-diff-added",
    /node-cand-studio-copy-/
  );

  await canvas.press("Delete");
  await expect(canvas).toHaveAttribute("data-canvas-selected-node-count", "0");
  await expect(page.getByRole("button", { name: "Canvas delete" })).toHaveAttribute(
    "data-canvas-version-diff-removed",
    /node-cand-studio-copy-/
  );

  await page.getByRole("button", { name: "Hide Studio System" }).click();
  await expect(canvas).toHaveAttribute("data-canvas-hidden-node-count", "1");
  await expect(page.locator("[data-canvas-layer-row='node-cand-studio']")).toHaveAttribute("data-canvas-layer-hidden", "true");

  await page.getByRole("button", { name: "Show Studio System" }).click();
  await expect(canvas).toHaveAttribute("data-canvas-hidden-node-count", "0");

  await page.getByRole("button", { name: "Edit tool remove_background" }).click();
  await expect(editTools).toHaveAttribute("data-edit-tools-active-tool", "remove_background");

  await page.getByRole("button", { name: "Apply Edit" }).click();
  await expect(editTools).toHaveAttribute("data-edit-tools-last-action", "apply");
  await expect(editTools).toHaveAttribute("data-edit-tools-derived-asset-id", "asset-edit-001");
  await expect(editTools).toHaveAttribute("data-edit-tools-derived-node-id", "node-edit-001");
  await expect(editTools).toHaveAttribute("data-edit-tools-original-retained", "true");
  await expect(editTools).toHaveAttribute("data-edit-tools-raw-payload-persisted", "false");
  await expect(page.locator("[data-canvas-node='node-edit-001']")).toBeVisible();

  await page.getByRole("button", { name: "Select Utility Kit" }).click();
  await expect(canvas).toHaveAttribute("data-canvas-selected-node-ids", "node-cand-utility");

  const selectedStudioVersion = page.getByRole("button", { name: "Selected Studio System" });
  await expect(selectedStudioVersion).toHaveAttribute("data-csrf-ux-guard-contracts", restoreVersionContract);
  await selectedStudioVersion.click();
  await expect(versionHistory).toHaveAttribute("data-canvas-version-active-id", "version-002");
  await expect(selectedStudioVersion).toHaveAttribute("data-canvas-version-restore-preserves", /node-cand-utility/);
  await expect(page.locator("[data-canvas-node='node-cand-utility']")).toBeVisible();
});
