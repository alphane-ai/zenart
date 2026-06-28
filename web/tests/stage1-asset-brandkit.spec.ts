import { expect, test } from "@playwright/test";

const operations =
  "listAssetLibrary,createAssetLibraryEntry,updateAssetLibraryEntry,listBrandKits,createBrandKit,updateBrandKit,getProjectDefaultBrandKit,setProjectDefaultBrandKit";
const operationContracts =
  "listAssetLibrary:GET:/assets/library:include:not-required:false|createAssetLibraryEntry:POST:/assets/library:include:required:true|updateAssetLibraryEntry:PATCH:/assets/library/{entry_id}:include:required:true|listBrandKits:GET:/brand-kits:include:not-required:false|createBrandKit:POST:/brand-kits:include:required:true|updateBrandKit:PATCH:/brand-kits/{brand_kit_id}:include:required:true|getProjectDefaultBrandKit:GET:/projects/{project_id}/brand-kit-default:include:not-required:false|setProjectDefaultBrandKit:PUT:/projects/{project_id}/brand-kit-default:include:required:true";

async function resetWorkspace(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
}

test("asset library and brand kit picker exposes Stage 1 local contract", async ({ page }) => {
  await resetWorkspace(page);

  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: "Launch Direction Board" })).toBeVisible();

  const panel = page.getByLabel("Asset Library and Brand Kit");
  await expect(panel).toHaveAttribute("data-asset-library-brandkit-ui", "stage1.asset-library-brandkit-user-picker");
  await expect(panel).toHaveAttribute("data-asset-library-sync-status", "local");
  await expect(panel).toHaveAttribute("data-asset-library-operation-count", "8");
  await expect(panel).toHaveAttribute("data-asset-library-operations", operations);
  await expect(panel).toHaveAttribute("data-asset-library-operation-contracts", operationContracts);
  await expect(panel).toHaveAttribute("data-asset-library-item-count", "2");
  await expect(panel).toHaveAttribute("data-asset-library-reusable-count", "2");
  await expect(panel).toHaveAttribute("data-asset-library-packaged-count", "0");
  await expect(panel).toHaveAttribute("data-brand-kit-count", "1");
  await expect(panel).toHaveAttribute("data-brand-kit-active-count", "1");
  await expect(panel).toHaveAttribute("data-brand-kit-default-id", "brand_kit_1");
  await expect(panel).toHaveAttribute("data-brand-kit-default-name", "Aurora Retail");
  await expect(panel).toHaveAttribute("data-brand-kit-default-palette-count", "3");
  await expect(panel).toHaveAttribute("data-brand-kit-default-guideline-count", "1");
  await expect(panel).toHaveAttribute("data-brand-kit-project-binding-count", "1");

  const heroAsset = page.locator("[data-asset-library-item='library_entry_1']");
  await expect(heroAsset).toHaveAttribute("data-asset-library-asset-id", "asset_hero_1");
  await expect(heroAsset).toHaveAttribute("data-asset-library-visibility", "tenant");
  await expect(heroAsset).toHaveAttribute("data-asset-library-reusable", "true");
  await expect(heroAsset).toHaveAttribute("data-asset-library-archived", "false");
  await expect(heroAsset).toHaveAttribute("data-asset-library-packaged", "false");
  await expect(heroAsset).toHaveAttribute("data-asset-library-lineage-kind", "batch_child_provider_result");
  await expect(heroAsset).toHaveAttribute("data-asset-library-trace-id", "trace_asset_hero_1");

  const logoAsset = page.locator("[data-asset-library-item='library_entry_2']");
  await expect(logoAsset).toHaveAttribute("data-asset-library-asset-id", "asset_logo_1");
  await expect(logoAsset).toHaveAttribute("data-asset-library-visibility", "project");
  await expect(logoAsset).toHaveAttribute("data-asset-library-lineage-kind", "asset_library");
  await expect(logoAsset).toHaveAttribute("data-asset-library-trace-id", "trace_asset_logo_1");

  await expect(page.getByRole("button", { name: "Refresh Assets" })).toHaveAttribute(
    "data-asset-library-refresh-contract",
    "listAssetLibrary:GET:not-required:false+listBrandKits:GET:not-required:false+getProjectDefaultBrandKit:GET:not-required:false"
  );
  await expect(page.getByRole("button", { name: "Refresh Assets" })).toHaveAttribute(
    "data-csrf-ux-guard-contracts",
    "listAssetLibrary:GET:/assets/library:include:not-required:false|listBrandKits:GET:/brand-kits:include:not-required:false|getProjectDefaultBrandKit:GET:/projects/{project_id}/brand-kit-default:include:not-required:false"
  );
  await expect(page.getByRole("button", { name: "Add Asset" })).toHaveAttribute(
    "data-asset-library-create-contract",
    "createAssetLibraryEntry:POST:required:true"
  );
  await expect(page.getByRole("button", { name: "Add Asset" })).toHaveAttribute(
    "data-csrf-ux-guard-contracts",
    "createAssetLibraryEntry:POST:/assets/library:include:X-Zenari-CSRF:true"
  );

  await heroAsset.getByRole("button", { name: "Package" }).click();
  await expect(panel).toHaveAttribute("data-asset-library-packaged-count", "1");
  await expect(heroAsset).toHaveAttribute("data-asset-library-packaged", "true");
  await expect(heroAsset.getByRole("button", { name: "Packaged" })).toBeDisabled();
  await expect(page.getByLabel("Package export safety state").getByText("Launch hero generated image")).toBeVisible();
});

test("asset library writes and brand kit actions remain locally covered", async ({ page }) => {
  await resetWorkspace(page);

  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: "Launch Direction Board" })).toBeVisible();

  const panel = page.getByLabel("Asset Library and Brand Kit");
  await page.getByRole("button", { name: "Select Studio System" }).click();
  await page.getByRole("button", { name: "Add Asset" }).click();

  const studioAsset = page.locator("[data-asset-library-item='library_entry_canvas-node-cand-studio']");
  await expect(panel).toHaveAttribute("data-asset-library-item-count", "3");
  await expect(panel).toHaveAttribute("data-asset-library-reusable-count", "3");
  await expect(studioAsset).toHaveAttribute("data-asset-library-asset-id", "canvas-node-cand-studio");
  await expect(studioAsset).toHaveAttribute("data-asset-library-visibility", "project");
  await expect(studioAsset).toHaveAttribute("data-asset-library-reusable", "true");
  await expect(studioAsset).toHaveAttribute("data-asset-library-lineage-kind", "canvas_selection");
  await expect(studioAsset).toHaveAttribute("data-asset-library-trace-id", "");

  await expect(studioAsset.getByRole("button", { name: "Favorite Asset" })).toHaveAttribute(
    "data-asset-library-favorite-contract",
    "updateAssetLibraryEntry:PATCH:required:true"
  );
  await expect(studioAsset.getByRole("button", { name: "Favorite Asset" })).toHaveAttribute(
    "data-csrf-ux-guard-contracts",
    "updateAssetLibraryEntry:PATCH:/assets/library/{entry_id}:include:X-Zenari-CSRF:true"
  );
  await studioAsset.getByRole("button", { name: "Favorite Asset" }).click();
  await expect(studioAsset.getByRole("button", { name: "Unfavorite Asset" })).toBeVisible();

  await expect(studioAsset.getByRole("button", { name: "Kit" })).toHaveAttribute(
    "data-brand-kit-create-contract",
    "createBrandKit:POST:required:true"
  );
  await expect(studioAsset.getByRole("button", { name: "Kit" })).toHaveAttribute(
    "data-csrf-ux-guard-contracts",
    "createBrandKit:POST:/brand-kits:include:X-Zenari-CSRF:true"
  );
  await studioAsset.getByRole("button", { name: "Kit" }).click();
  await expect(panel).toHaveAttribute("data-brand-kit-count", "2");
  await expect(panel).toHaveAttribute("data-brand-kit-active-count", "2");
  await expect(panel).toHaveAttribute("data-brand-kit-default-id", "brand_kit_canvas-node-cand-studio");
  await expect(panel).toHaveAttribute("data-brand-kit-default-name", "Studio System Brand Kit");
  await expect(panel).toHaveAttribute("data-brand-kit-default-palette-count", "2");
  await expect(panel).toHaveAttribute("data-brand-kit-default-guideline-count", "1");

  const studioKit = page.locator("[data-brand-kit-id='brand_kit_canvas-node-cand-studio']");
  await expect(studioKit.getByRole("button", { name: "Update Kit" })).toHaveAttribute(
    "data-brand-kit-update-contract",
    "updateBrandKit:PATCH:required:true"
  );
  await expect(studioKit.getByRole("button", { name: "Update Kit" })).toHaveAttribute(
    "data-csrf-ux-guard-contracts",
    "updateBrandKit:PATCH:/brand-kits/{brand_kit_id}:include:X-Zenari-CSRF:true"
  );
  await studioKit.getByRole("button", { name: "Update Kit" }).click();
  await expect(panel).toHaveAttribute("data-brand-kit-default-guideline-count", "2");

  const auroraKit = page.locator("[data-brand-kit-id='brand_kit_1']");
  await expect(auroraKit.getByRole("button", { name: "Set Default" })).toHaveAttribute(
    "data-brand-kit-default-contract",
    "setProjectDefaultBrandKit:PUT:required:true"
  );
  await expect(auroraKit.getByRole("button", { name: "Set Default" })).toHaveAttribute(
    "data-csrf-ux-guard-contracts",
    "setProjectDefaultBrandKit:PUT:/projects/{project_id}/brand-kit-default:include:X-Zenari-CSRF:true"
  );
  await auroraKit.getByRole("button", { name: "Set Default" }).click();
  await expect(panel).toHaveAttribute("data-brand-kit-default-id", "brand_kit_1");
  await expect(panel).toHaveAttribute("data-brand-kit-default-name", "Aurora Retail");
  await expect(panel).toHaveAttribute("data-brand-kit-default-palette-count", "3");

  await expect(studioAsset.getByRole("button", { name: "Archive Asset" })).toHaveAttribute(
    "data-asset-library-archive-contract",
    "updateAssetLibraryEntry:PATCH:required:true"
  );
  await expect(studioAsset.getByRole("button", { name: "Archive Asset" })).toHaveAttribute(
    "data-csrf-ux-guard-contracts",
    "updateAssetLibraryEntry:PATCH:/assets/library/{entry_id}:include:X-Zenari-CSRF:true"
  );
  await studioAsset.getByRole("button", { name: "Archive Asset" }).click();
  await expect(studioAsset).toHaveAttribute("data-asset-library-archived", "true");
  await expect(panel).toHaveAttribute("data-asset-library-reusable-count", "2");
});
