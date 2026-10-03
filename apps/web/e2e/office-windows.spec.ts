import { expect, test } from "@playwright/test";
import { aConfirmedCharacter, enterTheWorld, waitForTheOffice } from "./fixture";
import { seededWorlds } from "./paths";

test.describe("the office workspace", () => {
  test("opens the office without waiting for the map", async ({ page }) => {
    let requested = false;
    await page.route("**/map?v=*", async (route) => { requested = true; await route.abort(); });
    await enterTheWorld(page);
    await waitForTheOffice(page);
    expect(requested).toBe(false);
    await expect(page.locator('[data-object="council"]')).toBeVisible();
  });

  test("preserves an order and its time span across documents and a reload", async ({ page }) => {
    await enterTheWorld(page);
    await waitForTheOffice(page);
    await page.locator('[data-object="council"]').click();
    const words = "Keep the legion at Rhegium until its provisions arrive.";
    await page.locator("#sim-order").fill(words);
    await page.locator("#sim-order-span").selectOption("7");
    await page.getByRole("navigation", { name: "Office documents" }).getByRole("button", { name: "Orders under way", exact: true }).click();
    await page.getByRole("tab", { name: "History", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.locator(".office-room-status").getByRole("button", { name: /Orders under way/ }).click();
    await expect(page.getByRole("tab", { name: "History", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("navigation", { name: "Office documents" }).getByRole("button", { name: "Writing desk", exact: true }).click();
    await expect(page.locator("#sim-order")).toHaveValue(words);
    await expect(page.locator("#sim-order-span")).toHaveValue("7");
    await page.reload();
    await waitForTheOffice(page);
    await page.locator('[data-object="council"]').click();
    await expect(page.locator("#sim-order")).toHaveValue(words);
    await expect(page.locator("#sim-order-span")).toHaveValue("7");
  });

  test("keeps the written instruction when sending fails", async ({ page }) => {
    await page.route("**/simulate", async (route) => {
      if (route.request().method() === "POST") return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "The order could not be sent. Try again." }) });
      return route.continue();
    });
    await enterTheWorld(page);
    await waitForTheOffice(page);
    await page.locator('[data-object="council"]').click();
    const words = "Send provisions to the army.";
    await page.locator("#sim-order").fill(words);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByRole("dialog", { name: /council/i }).getByRole("alert")).toContainText("could not be sent");
    await expect(page.locator("#sim-order")).toHaveValue(words);
  });

  test("opens linked references beside the document, with back navigation", async ({ page }) => {
    await enterTheWorld(page);
    await waitForTheOffice(page);
    await page.locator('[data-object="standing"]').click();
    const sheet = page.getByRole("dialog", { name: "your standing", exact: true });
    await sheet.getByRole("tab", { name: "The state", exact: true }).click();
    const name = sheet.locator(".sheet__body .entity-link").first();
    const label = await name.innerText();
    await name.click();
    const reference = sheet.locator(".entity-reference");
    await expect(reference).toContainText(label);
    await expect(sheet.getByRole("tab", { name: "The state", exact: true })).toHaveAttribute("aria-selected", "true");
    await reference.locator(".entity-link").first().click();
    await reference.getByRole("button", { name: "Back", exact: true }).click();
    await expect(reference).toContainText(label);
    await page.screenshot({ path: "shots/windows/linked-reference.png" });
    await reference.getByRole("button", { name: "Close reference", exact: true }).click();
    await expect(sheet).toBeVisible();
    await expect(reference).toHaveCount(0);
  });

  test("opens matters in hand as a document and remembers the selected section", async ({ page }) => {
    await enterTheWorld(page);
    await waitForTheOffice(page);
    await page.locator(".calendar-line__next").click();
    const agenda = page.getByRole("dialog", { name: "matters in hand", exact: true });
    await agenda.getByRole("tab", { name: "Coming soon", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.locator(".calendar-line__next").click();
    await expect(agenda.getByRole("tab", { name: "Coming soon", exact: true })).toHaveAttribute("aria-selected", "true");
  });

  test("acknowledges a sent letter without waiting for background reads", async ({ page }) => {
    await aConfirmedCharacter(seededWorlds().consul, "gaius-genucius", "Gaius Genucius Clepsina", "Roman");
    await enterTheWorld(page);
    await waitForTheOffice(page);
    await page.locator('[data-object="people"]').click();
    const tray = page.getByRole("dialog", { name: "your letters", exact: true });
    await expect(tray.locator(".letters__person").first()).toBeVisible({ timeout: 60_000 });
    await tray.locator("#letters-search").fill("Hanno");
    await tray.locator(".letters__person", { hasText: "Hanno" }).first().click();
    await tray.locator("#letters-write").fill("Send me an account of your intentions.");
    let reads = 0;
    await page.route("**/letters", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "sent" }) }));
    for (const endpoint of ["directory", "simulate"]) await page.route(`**/${endpoint}`, async (route) => {
      reads++;
      await new Promise((resolve) => setTimeout(resolve, 8_000));
      await route.abort();
    });
    await tray.getByRole("button", { name: "Send the letter", exact: true }).click();
    await expect(tray.getByRole("status")).toContainText("on its way", { timeout: 3_000 });
    await expect(tray.locator("#letters-write")).toBeEnabled({ timeout: 3_000 });
    await expect(tray.locator("#letters-write")).toHaveValue("");
    expect(reads).toBeGreaterThan(0);
    await tray.locator("#letters-write").fill("A second letter, still unwritten.");
    await tray.locator(".sheet__navigation").getByRole("button", { name: "Writing desk", exact: true }).click();
    await page.getByRole("dialog", { name: "the council", exact: true }).getByRole("navigation", { name: "Office documents" }).getByRole("button", { name: "Letters", exact: true }).click();
    await expect(tray.locator("#letters-write")).toHaveValue("A second letter, still unwritten.");
    await expect(tray.locator("#letters-search")).toHaveValue("Hanno");
  });
});
